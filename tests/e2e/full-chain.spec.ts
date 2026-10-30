import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Admin@12345";

test.describe.configure({ timeout: 600_000 });

function uniqueSuffix(): string {
  return `${Date.now()}`.slice(-7);
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL("/", { timeout: 30_000 });
}

// 每个账号必须独立 context：同一 context 共享会话 cookie，换账号登录会直接被跳回首页
async function openAs(
  browser: Browser,
  email: string,
  password: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page, email, password);
  return { context, page };
}

async function createStaffUser(
  admin: Page,
  user: { name: string; email: string; password: string },
): Promise<void> {
  await admin.goto("/admin/users");
  await admin.getByRole("button", { name: "新建用户" }).click();
  const dialog = admin.getByRole("dialog");
  await dialog.getByLabel("姓名").fill(user.name);
  await dialog.getByLabel("邮箱").fill(user.email);
  await dialog.getByLabel("初始密码").fill(user.password);
  // 部门是 Radix Select；「部门」子串会撞上「部门主管」角色复选框，必须 exact
  await dialog.getByRole("combobox", { name: "部门", exact: true }).click();
  await admin.getByRole("option", { name: /总公司/ }).click();
  await dialog.getByRole("checkbox", { name: /部门主管/ }).click();
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(admin.getByText(user.email, { exact: true })).toBeVisible();
}

async function addApprovalNode(
  admin: Page,
  connectorIndex: number,
  nodeName: string,
  approver: { name: string; email: string },
): Promise<void> {
  const connectors = admin.locator('button[aria-label="在此处添加节点"]');
  await expect(connectors).toHaveCount(connectorIndex + 1, { timeout: 30_000 });
  await connectors.nth(connectorIndex).click();
  await admin.getByRole("menuitem", { name: "审批" }).click();

  const sheet = admin.getByRole("dialog");
  await sheet.getByLabel("节点名称").fill(nodeName);
  await sheet.getByLabel("审批人来源").click();
  await admin.getByRole("option", { name: "指定人员" }).click();
  await sheet.getByPlaceholder("输入姓名或邮箱，回车搜索").fill(approver.email);
  await sheet.getByRole("button", { name: "搜索" }).click();
  const candidate = sheet.locator("label").filter({ hasText: approver.name }).first();
  await expect(candidate).toBeVisible({ timeout: 30_000 });
  await candidate.getByRole("checkbox").check();
  await sheet.getByRole("button", { name: "应用属性" }).click();
  await expect(sheet).toHaveCount(0);
}

async function addSealActionNode(admin: Page, connectorIndex: number): Promise<void> {
  const connectors = admin.locator('button[aria-label="在此处添加节点"]');
  await expect(connectors).toHaveCount(connectorIndex + 1, { timeout: 30_000 });
  await connectors.nth(connectorIndex).click();
  await admin.getByRole("menuitem", { name: "自动动作" }).click();

  const sheet = admin.getByRole("dialog");
  await sheet.getByLabel("节点名称").fill("生成用印申请");
  const actionKind = sheet.getByRole("combobox", { name: "动作类型" });
  await expect(actionKind).toBeVisible({ timeout: 30_000 });
  await actionKind.click();
  await expect(admin.getByRole("listbox")).toBeVisible({ timeout: 10_000 });
  await admin.getByRole("option", { name: /创建用印申请/ }).click();
  await sheet.getByRole("button", { name: "应用属性" }).click();
  await expect(sheet).toHaveCount(0);
}

async function createDraftContract(page: Page, title: string, amount: string): Promise<string> {
  await page.goto("/contracts/new");
  await page.getByLabel("合同模板").selectOption({ label: "采购合同（PURCHASE）" });
  await page.getByLabel("合同标题").fill(title);
  await page
    .getByLabel("甲方")
    .selectOption({ label: "上海华信科技有限公司（91310000MA1FL0XX1A）" });
  await page
    .getByLabel("乙方")
    .selectOption({ label: "杭州云诚供应链有限公司（91330100MA2GL1YY2B）" });
  await page.getByLabel("合同金额").fill(amount);
  await page.getByLabel("签署日期").fill("2026-10-30");
  await page.getByLabel("开始日期").fill("2026-11-01");
  await page.getByLabel("结束日期").fill("2027-10-31");
  await page.getByLabel("采购标的").fill("全链路验收采购");
  await page.getByLabel("交付周期（天）").fill("20");
  await page.getByLabel("首批交付日期").fill("2026-12-01");
  await page.getByLabel("付款方式").selectOption("月结30天");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page).toHaveURL(/\/contracts\/(?!new$)[a-z0-9]+$/i, { timeout: 30_000 });
  return new URL(page.url()).pathname.split("/").pop() as string;
}

async function openFresh(page: Page, target: string): Promise<void> {
  // 跨用户观察状态必须绕开浏览器缓存：goto 命中缓存时会给出上一份渲染结果，
  // 而 revalidatePath 只作用于写入方自己的会话。
  await page.goto(target);
  await page.reload();
}

async function submitFromDetail(page: Page, flowName: string): Promise<void> {
  await page.getByRole("button", { name: "提交审批" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(flowName)).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "确认提交" }).click();
  await expect(page.getByText("已提交审批")).toBeVisible({ timeout: 30_000 });
}

async function decide(
  page: Page,
  contractTitle: RegExp,
  action: "同意" | "驳回",
  opinion: string,
): Promise<void> {
  // 工作台在同一 context 里会被 router cache 命中，待办来自别人的提交时必须强刷
  await page.goto("/");
  await page.reload();
  const todo = page.getByRole("link", { name: contractTitle }).first();
  await expect(todo).toBeVisible({ timeout: 30_000 });
  await todo.click();
  await expect(page).toHaveURL(/\/approvals\//, { timeout: 30_000 });

  await page.getByRole("button", { name: action, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/审批意见/).fill(opinion);
  await dialog.getByRole("button", { name: "确认提交" }).click();
  // toast 文案会撞上轨迹里的同名条目，改断言决策面板确实失去了这条待办
  await expect(
    page.getByText(/你已处理该节点|你没有该节点的待办/),
  ).toBeVisible({ timeout: 30_000 });
}

test.describe("验收 19：合同全生命周期链路", () => {
  test("起草 → 提交 → 主管同意 → 法务驳回 → 改后再提 → 三级同意 → 用印 → 归档", async ({
    browser,
  }) => {
    const suffix = uniqueSuffix();
    const flowName = `E2E全链路${suffix}`;
    const flowCode = `E2E_FULL_${suffix}`.slice(0, 30);
    const contractTitle = `E2E全链路合同${suffix}`;
    const staff = {
      manager: {
        name: `E2E主管${suffix}`,
        email: `e2e.full.manager.${suffix}@example.com`,
        password: `Mgr${suffix}`,
      },
      legal: {
        name: `E2E法务${suffix}`,
        email: `e2e.full.legal.${suffix}@example.com`,
        password: `Lgl${suffix}`,
      },
      ceo: {
        name: `E2E总经理${suffix}`,
        email: `e2e.full.ceo.${suffix}@example.com`,
        password: `Ceo${suffix}`,
      },
    };

    const admin = await openAs(browser, ADMIN_EMAIL, ADMIN_PASSWORD);

    await createStaffUser(admin.page, staff.manager);
    await createStaffUser(admin.page, staff.legal);
    await createStaffUser(admin.page, staff.ceo);

    // 流程：部门主管审批 → 法务审核 → 总经理审批 → 生成用印申请 → 结束
    await admin.page.goto("/admin/flows");
    await admin.page.getByRole("button", { name: "新建流程" }).click();
    const flowDialog = admin.page.getByRole("dialog");
    await flowDialog.getByLabel("流程编码").fill(flowCode);
    await flowDialog.getByLabel("流程名称").fill(flowName);
    await flowDialog.getByLabel("分类").fill("通用");
    await flowDialog.getByRole("button", { name: "保存" }).click();
    await admin.page
      .getByRole("row", { name: new RegExp(flowName) })
      .getByRole("link", { name: "配置" })
      .click();
    await expect(
      admin.page.getByRole("heading", { name: `流程配置 · ${flowName}` }),
    ).toBeVisible({ timeout: 30_000 });

    await addApprovalNode(admin.page, 0, "部门主管审批", staff.manager);
    await addApprovalNode(admin.page, 1, "法务审核", staff.legal);
    await addApprovalNode(admin.page, 2, "总经理审批", staff.ceo);
    await addSealActionNode(admin.page, 3);

    await admin.page.getByRole("button", { name: "发布新版本" }).click();
    await expect(admin.page.getByText(/已发布为 v1/)).toBeVisible({ timeout: 30_000 });

    await admin.page.goto("/admin/templates");
    const templateRow = admin.page
      .getByRole("row", { name: /采购合同/ })
      .filter({ hasText: "PURCHASE" });
    await templateRow.getByRole("button", { name: "编辑" }).click();
    const bindDialog = admin.page.getByRole("dialog");
    await bindDialog.getByLabel("关联审批流").click();
    await admin.page.getByRole("option", { name: new RegExp(flowName) }).click();
    await bindDialog.getByRole("button", { name: "保存" }).click();
    await expect(admin.page.getByText("模板已更新")).toBeVisible();
    await expect(
      templateRow.getByRole("cell", { name: flowName, exact: true }),
    ).toBeVisible();

    // 起草并提交
    const contractId = await createDraftContract(admin.page, contractTitle, "300000.00");
    await submitFromDetail(admin.page, flowName);

    const manager = await openAs(browser, staff.manager.email, staff.manager.password);
    const legal = await openAs(browser, staff.legal.email, staff.legal.password);
    const ceo = await openAs(browser, staff.ceo.email, staff.ceo.password);

    const titlePattern = new RegExp(contractTitle);

    // 主管同意
    await decide(manager.page, titlePattern, "同意", "需求属实，同意");

    // 法务驳回 → 合同回到发起人手上
    await decide(legal.page, titlePattern, "驳回", "预算超限，请调低金额后重报");

    await admin.page.goto(`/contracts/${contractId}`);
    // admin 提交后一直停在这个 URL，同 context 的 router cache 会直接命中旧 payload；
    // 驳回发生在法务的 context，必须强制重取一次才能读到 rejected。
    await admin.page.reload();
    await expect(admin.page.getByText("已驳回", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    // 驳回理由不在合同详情页（那里只按 rejected 决定显示「修改后重提」按钮），
    // 而是在审批记录的「查看审批详情」里（approval-panel.tsx:401 渲染 task.opinion）。
    await admin.page.goto(`/contracts/${contractId}/timeline`);
    await admin.page.getByRole("link", { name: "查看审批详情" }).first().click();
    await expect(admin.page.getByText(/预算超限，请调低金额后重报/)).toBeVisible({
      timeout: 30_000,
    });
    await admin.page.goto(`/contracts/${contractId}`);

    // 发起人改金额后再提
    await admin.page.getByRole("link", { name: "修改后重提" }).click();
    await expect(admin.page).toHaveURL(/\/contracts\/[a-z0-9]+\/edit$/i, { timeout: 30_000 });
    await admin.page.getByLabel("合同金额").fill("150000.00");
    await admin.page.getByRole("button", { name: "保存修改" }).click();
    await expect(admin.page).toHaveURL(new RegExp(`/contracts/${contractId}$`), {
      timeout: 30_000,
    });
    await expect(admin.page.getByText("150,000.00")).toBeVisible();
    await submitFromDetail(admin.page, flowName);

    // 三级依次同意
    await decide(manager.page, titlePattern, "同意", "调整后金额合规");
    await decide(legal.page, titlePattern, "同意", "条款无异议");
    await decide(ceo.page, titlePattern, "同意", "同意签署");

    // 动作节点应生成用印申请并把合同推到待用印
    await admin.page.goto(`/contracts/${contractId}`);
    await expect(admin.page.getByText("待用印", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });

    await admin.page.goto("/seals");
    const sealRow = admin.page.getByRole("row").filter({ hasText: contractTitle }).first();
    await expect(sealRow.getByText("待取件")).toBeVisible({ timeout: 30_000 });
    await sealRow.getByRole("button", { name: "登记取件" }).click();
    await expect(admin.page.getByText("已登记取件")).toBeVisible();

    await admin.page.reload();
    await admin.page
      .getByRole("row")
      .filter({ hasText: contractTitle })
      .first()
      .getByRole("button", { name: "登记归还" })
      .click();
    const returnDialog = admin.page.getByRole("dialog");
    await returnDialog.getByLabel(/用印编号/).fill(`YZ-${suffix}`);
    await returnDialog.getByRole("button", { name: "确认归还" }).click();
    await expect(admin.page.getByText("已登记归还")).toBeVisible();

    await admin.page.goto(`/contracts/${contractId}`);
    await expect(admin.page.getByText("履行中", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(admin.page.getByText("用印与生命周期")).toBeVisible();
    await expect(admin.page.getByText(`YZ-${suffix}`)).toBeVisible();

    // 归档
    await admin.page.goto("/archive");
    const archiveRow = admin.page.getByRole("row").filter({ hasText: contractTitle }).first();
    await expect(archiveRow).toBeVisible({ timeout: 30_000 });
    await archiveRow.getByRole("button", { name: "归档" }).click();
    const archiveDialog = admin.page.getByRole("dialog");
    await archiveDialog.getByLabel(/归档备注/).fill("全链路验收：履行完毕");
    await archiveDialog.getByRole("button", { name: "确认归档" }).click();
    await expect(admin.page.getByText("合同已归档")).toBeVisible();

    // 归档后详情页只读，且轨迹留痕完整
    await openFresh(admin.page, `/contracts/${contractId}`);
    await expect(admin.page.getByText("已归档", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(admin.page.getByRole("button", { name: "提交审批" })).toHaveCount(0);
    await expect(admin.page.getByRole("link", { name: "编辑草稿" })).toHaveCount(0);

    // 两次提交都留痕：第一次停在法务驳回，第二次才走到总经理与用印
    await openFresh(admin.page, `/contracts/${contractId}/timeline`);
    await expect(admin.page.getByText("法务审核")).toHaveCount(2);
    await expect(admin.page.getByText("总经理审批")).toHaveCount(1);
    await expect(admin.page.getByText("生成用印申请")).toHaveCount(1);

    await manager.context.close();
    await legal.context.close();
    await ceo.context.close();
    await admin.context.close();
  });
});
