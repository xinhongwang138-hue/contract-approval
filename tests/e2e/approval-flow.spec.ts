import { expect, test, type Browser, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Admin@12345";

test.describe.configure({ timeout: 420_000 });

function uniqueSuffix(): string {
  return `${Date.now()}`.slice(-7);
}

function shanghaiDate(offsetDays: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL("/", { timeout: 30_000 });
}

async function openContext(browser: Browser, email: string, password: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page, email, password);
  return page;
}

async function assignTo(
  page: Page,
  displayName: string,
  searchTerm: string,
): Promise<void> {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("审批人来源").click();
  await page.getByRole("option", { name: "指定人员" }).click();
  await dialog.getByPlaceholder("输入姓名或邮箱，回车搜索").fill(searchTerm);
  await dialog.getByRole("button", { name: "搜索" }).click();
  const checkbox = dialog.getByRole("checkbox", {
    name: new RegExp(displayName),
  }).first();
  await expect(checkbox).toBeVisible();
  await checkbox.check();
  await dialog.getByRole("button", { name: "应用属性" }).click();
}

async function createDraftContract(page: Page, title: string): Promise<string> {
  await page.goto("/contracts/new");
  await page.getByLabel("合同模板").selectOption({ label: "采购合同（PURCHASE）" });
  await page.getByLabel("合同标题").fill(title);
  await page
    .getByLabel("甲方")
    .selectOption({ label: "上海华信科技有限公司（91310000MA1FL0XX1A）" });
  await page
    .getByLabel("乙方")
    .selectOption({ label: "杭州云诚供应链有限公司（91330100MA2GL1YY2B）" });
  await page.getByLabel("合同金额").fill("300000.00");
  await page.getByLabel("签署日期").fill("2026-10-29");
  await page.getByLabel("开始日期").fill("2026-11-01");
  await page.getByLabel("结束日期").fill("2027-10-31");
  await page.getByLabel("采购标的").fill("服务器扩容采购");
  await page.getByLabel("交付周期（天）").fill("20");
  await page.getByLabel("首批交付日期").fill("2026-12-01");
  await page.getByLabel("付款方式").selectOption("月结30天");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page).toHaveURL(/\/contracts\/(?!new$)[a-z0-9]+$/i, { timeout: 30_000 });
  return new URL(page.url()).pathname.split("/").pop() as string;
}

async function createApproverUser(
  admin: Page,
  user: { name: string; email: string; password: string },
): Promise<void> {
  await admin.goto("/admin/users");
  await admin.getByRole("button", { name: "新建用户" }).click();
  const dialog = admin.getByRole("dialog");
  await dialog.getByLabel("姓名").fill(user.name);
  await dialog.getByLabel("邮箱").fill(user.email);
  await dialog.getByLabel("初始密码").fill(user.password);
  // 部门是 Radix Select（button role=combobox），selectOption 无效；
  // 且「部门」子串会同时命中「部门主管」角色复选框，必须 exact。
  await dialog.getByRole("combobox", { name: "部门", exact: true }).click();
  await admin.getByRole("option", { name: /总公司/ }).click();
  await dialog.getByRole("checkbox", { name: /部门主管/ }).click();
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(admin.getByText(user.email, { exact: true })).toBeVisible();
}

test.describe("审批落地全链路", () => {
  test("提交 → 驳回 → 修改后重提 → 同意", async ({ browser }) => {
    const suffix = uniqueSuffix();
    const approverName = `E2E审批员${suffix}`;
    const approverEmail = `e2e.approver.${suffix}@example.com`;
    const approverPassword = `Approver${suffix}`;
    const flowName = `E2E审批链路${suffix}`;
    const contractTitle = `E2E链路合同${suffix}`;

    const admin = await openContext(browser, ADMIN_EMAIL, ADMIN_PASSWORD);

    await createApproverUser(admin, {
      name: approverName,
      email: approverEmail,
      password: approverPassword,
    });

    await admin.goto("/admin/flows");
    await admin.getByRole("button", { name: "新建流程" }).click();
    const flowDialog = admin.getByRole("dialog");
    await flowDialog.getByLabel("流程编码").fill(`E2E_CHAIN_${suffix}`);
    await flowDialog.getByLabel("流程名称").fill(flowName);
    await flowDialog.getByLabel("分类").fill("通用");
    await flowDialog.getByRole("button", { name: "保存" }).click();
    const flowRow = admin.getByRole("row", { name: new RegExp(flowName) });
    await flowRow.getByRole("link", { name: "配置" }).click();
    await expect(
      admin.getByRole("heading", { name: `流程配置 · ${flowName}` }),
    ).toBeVisible({ timeout: 30_000 });

    await admin.locator('button[aria-label="在此处添加节点"]').first().click();
    await admin.getByRole("menuitem", { name: "审批" }).click();
    await assignTo(admin, approverName, approverEmail);
    await admin.getByRole("button", { name: "保存草稿" }).click();
    await expect(admin.getByText("草稿已保存")).toBeVisible();
    await admin.getByRole("button", { name: "发布新版本" }).click();
    await expect(admin.getByText(/已发布为 v1/)).toBeVisible({ timeout: 30_000 });

    await admin.goto("/admin/templates");
    const templateRow = admin
      .getByRole("row", { name: /采购合同/ })
      .filter({ hasText: "PURCHASE" });
    await templateRow.getByRole("button", { name: "编辑" }).click();
    const bindDialog = admin.getByRole("dialog");
    await bindDialog.getByLabel("关联审批流").click();
    await admin.getByRole("option", { name: new RegExp(flowName) }).click();
    await bindDialog.getByRole("button", { name: "保存" }).click();
    await expect(admin.getByText("模板已更新")).toBeVisible();

    const contractId = await createDraftContract(admin, contractTitle);
    await expect(admin.getByText("草稿", { exact: true }).first()).toBeVisible();

    await admin.getByRole("button", { name: "提交审批" }).click();
    const previewDialog = admin.getByRole("dialog");
    await expect(previewDialog.getByText(flowName)).toBeVisible();
    await expect(previewDialog.getByText(approverName)).toBeVisible();
    await previewDialog.getByRole("button", { name: "确认提交" }).click();
    await expect(admin.getByText("已提交审批")).toBeVisible();
    await expect(admin.getByText("审批中", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });

    const approver = await openContext(browser, approverEmail, approverPassword);
    await expect(approver.getByRole("heading", { name: /你好/ })).toBeVisible();
    await expect(approver.getByText("待我审批").first()).toBeVisible();
    await approver
      .getByRole("link", { name: new RegExp(contractTitle) })
      .first()
      .click();
    await expect(
      approver.getByRole("heading", { name: contractTitle }),
    ).toBeVisible({ timeout: 30_000 });

    await approver.getByRole("button", { name: "驳回" }).click();
    const rejectDialog = approver.getByRole("dialog");
    await rejectDialog.getByLabel(/审批意见/).fill("预算超限，请调整金额后重报");
    await rejectDialog.getByRole("button", { name: "确认提交" }).click();
    await expect(approver.getByText("已驳回")).toBeVisible();
    await expect(
      approver.getByText("预算超限，请调整金额后重报"),
    ).toBeVisible();

    await admin.goto(`/contracts/${contractId}`);
    // 驳回发生在审批员那个浏览器上下文，admin 侧仍持有该 URL 的 RSC 缓存，
    // goto 同一 URL 不会拿到新 payload，必须硬刷新。
    await admin.reload();
    await expect(admin.getByText("已驳回", { exact: true }).first()).toBeVisible();
    await admin.getByRole("link", { name: "修改后重提" }).click();
    await admin.getByLabel("合同金额").fill("260000.00");
    await admin.getByRole("button", { name: "保存修改" }).click();
    await admin.waitForURL(new RegExp(`/contracts/${contractId}$`), { timeout: 30_000 });

    await admin.getByRole("button", { name: "提交审批" }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "确认提交" }).click();
    await expect(admin.getByText("已提交审批")).toBeVisible();

    // approver 此时停在合同详情页（刚驳回完），reload 它拿不到待办列表，
    // 必须先回工作台再刷新。
    await approver.goto("/");
    await expect(approver.getByText("待我审批").first()).toBeVisible();
    await approver
      .getByRole("link", { name: new RegExp(contractTitle) })
      .first()
      .click();
    await approver.getByRole("button", { name: "同意" }).click();
    const approveDialog = approver.getByRole("dialog");
    await approveDialog.getByLabel(/审批意见/).fill("金额已调整，同意");
    await approveDialog.getByRole("button", { name: "确认提交" }).click();
    await expect(approver.getByText("已同意")).toBeVisible();
    await expect(
      approver.getByText("审批通过", { exact: true }).first(),
    ).toBeVisible({ timeout: 30_000 });

    await admin.goto(`/contracts/${contractId}/timeline`);
    await expect(
      admin.getByRole("heading", { name: `审批轨迹 · ${contractTitle}` }),
    ).toBeVisible();
    await expect(admin.getByText(`${flowName} v1`).first()).toBeVisible();
    await expect(admin.getByText(/金额已调整，同意/)).toBeVisible();
    await expect(admin.getByText(/预算超限，请调整金额后重报/)).toBeVisible();
  });

  test("无人处理时可撤回，已处理后拒绝", async ({ browser }) => {
    const suffix = uniqueSuffix();
    const flowName = `E2E撤回${suffix}`;
    const contractTitle = `E2E撤回合同${suffix}`;
    // 自建审批人，不隐式依赖其它用例创建的用户（否则全新库上必超时）
    const approverName = `E2E撤回审批员${suffix}`;
    const approverEmail = `e2e.withdraw.${suffix}@example.com`;
    const approverPassword = `Withdraw${suffix}`;

    const admin = await openContext(browser, ADMIN_EMAIL, ADMIN_PASSWORD);

    await createApproverUser(admin, {
      name: approverName,
      email: approverEmail,
      password: approverPassword,
    });

    await admin.goto("/admin/flows");
    await admin.getByRole("button", { name: "新建流程" }).click();
    const flowDialog = admin.getByRole("dialog");
    await flowDialog.getByLabel("流程编码").fill(`E2E_WITHDRAW_${suffix}`.slice(0, 30));
    await flowDialog.getByLabel("流程名称").fill(flowName);
    await flowDialog.getByLabel("分类").fill("通用");
    await flowDialog.getByRole("button", { name: "保存" }).click();
    const flowRow = admin.getByRole("row", { name: new RegExp(flowName) });
    await flowRow.getByRole("link", { name: "配置" }).click();
    await expect(
      admin.getByRole("heading", { name: `流程配置 · ${flowName}` }),
    ).toBeVisible({ timeout: 30_000 });

    await admin.locator('button[aria-label="在此处添加节点"]').first().click();
    await admin.getByRole("menuitem", { name: "审批" }).click();
    await assignTo(admin, approverName, approverEmail);
    await admin.getByRole("button", { name: "发布新版本" }).click();
    await expect(admin.getByText(/已发布为 v1/)).toBeVisible({ timeout: 30_000 });

    await admin.goto("/admin/templates");
    const templateRow = admin
      .getByRole("row", { name: /采购合同/ })
      .filter({ hasText: "PURCHASE" });
    await templateRow.getByRole("button", { name: "编辑" }).click();
    const bindDialog = admin.getByRole("dialog");
    await bindDialog.getByLabel("关联审批流").click();
    await admin.getByRole("option", { name: new RegExp(flowName) }).click();
    await bindDialog.getByRole("button", { name: "保存" }).click();
    await expect(admin.getByText("模板已更新")).toBeVisible();
    await expect(
      templateRow.getByRole("cell", { name: flowName, exact: true }),
    ).toBeVisible();

    const contractId = await createDraftContract(admin, contractTitle);
    await admin.getByRole("button", { name: "提交审批" }).click();
    const submitDialog = admin.getByRole("dialog");
    // 预览必须落在本用例自己的流程与审批人上，否则后续断言会指向别人的待办
    await expect(submitDialog.getByText(flowName)).toBeVisible();
    await expect(submitDialog.getByText(approverName)).toBeVisible();
    await submitDialog.getByRole("button", { name: "确认提交" }).click();
    await expect(admin.getByText("已提交审批")).toBeVisible();

    // 「撤回提交」按钮在审批详情页，合同详情页没有，需经审批轨迹进入
    await admin.goto(`/contracts/${contractId}/timeline`);
    await admin.getByRole("link", { name: "查看审批详情" }).click();
    await expect(admin).toHaveURL(/\/approvals\//, { timeout: 30_000 });
    await admin.getByRole("button", { name: "撤回提交" }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "确认撤回" }).click();
    await expect(admin.getByText("已撤回提交")).toBeVisible();

    await admin.goto(`/contracts/${contractId}`);
    await admin.reload();
    await expect(admin.getByText("草稿", { exact: true }).first()).toBeVisible();

    // 已处理后拒绝：重提并由审批人处理，发起人侧不再有撤回入口
    await admin.getByRole("button", { name: "提交审批" }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "确认提交" }).click();
    await expect(admin.getByText("已提交审批")).toBeVisible();

    const approver = await openContext(browser, approverEmail, approverPassword);
    await approver
      .getByRole("link", { name: new RegExp(contractTitle) })
      .first()
      .click();
    await approver.getByRole("button", { name: "同意" }).click();
    await approver.getByRole("dialog").getByRole("button", { name: "确认提交" }).click();
    await expect(approver.getByText("已同意")).toBeVisible();

    await admin.goto(`/contracts/${contractId}/timeline`);
    // 撤回后又重提，轨迹页会有两个实例；按 startedAt 升序渲染，取 last 即最新一次
    await admin.getByRole("link", { name: "查看审批详情" }).last().click();
    await expect(admin).toHaveURL(/\/approvals\//, { timeout: 30_000 });
    await expect(admin.getByRole("button", { name: "撤回提交" })).toHaveCount(0);
  });

  test("审批委托：服务端搜索选人、创建与删除", async ({ browser }) => {
    const suffix = uniqueSuffix();
    const principalName = `E2E委托方${suffix}`;
    const principalEmail = `e2e.delegate.from.${suffix}@example.com`;
    const delegateName = `E2E受托方${suffix}`;
    const delegateEmail = `e2e.delegate.to.${suffix}@example.com`;

    const admin = await openContext(browser, ADMIN_EMAIL, ADMIN_PASSWORD);
    await createApproverUser(admin, {
      name: principalName,
      email: principalEmail,
      password: `Deleg${suffix}`,
    });
    await createApproverUser(admin, {
      name: delegateName,
      email: delegateEmail,
      password: `Deleg${suffix}`,
    });

    async function pick(inputId: string, email: string, name: string): Promise<void> {
      const input = admin.locator(`#${inputId}`);
      await input.fill(email);
      await input.press("Enter");
      const radio = admin.getByRole("radio", { name: new RegExp(name) }).first();
      await expect(radio).toBeVisible({ timeout: 30_000 });
      await radio.click();
      await expect(admin.getByRole("button", { name: `移除 ${name}` })).toBeVisible();
    }

    await admin.goto("/admin/delegates");
    await admin.getByRole("button", { name: "新建委托" }).click();
    const dialog = admin.getByRole("dialog");
    // 未搜索时不预置全量名单，避免 200 人列表挤爆弹窗
    await expect(dialog.getByText("输入姓名或邮箱后回车搜索。")).toBeVisible();
    await expect(dialog.getByRole("radio")).toHaveCount(1);

    await pick("delegate-from", principalEmail, principalName);
    await pick("delegate-to", delegateEmail, delegateName);
    await dialog.getByLabel("开始日期").fill(shanghaiDate(0));
    await dialog.getByLabel("结束日期").fill(shanghaiDate(7));
    await dialog.getByLabel("委托原因").fill("年假期间由同事代审");
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(admin.getByText("委托已创建")).toBeVisible();

    const row = admin
      .getByRole("row")
      .filter({ hasText: principalName })
      .filter({ hasText: delegateName });
    await expect(row.getByText("生效中")).toBeVisible();
    await expect(row.getByText("审批合同")).toBeVisible();

    await row.getByRole("button", { name: /^删除/ }).click();
    await expect(admin.getByText("委托已删除")).toBeVisible();
    await expect(row).toHaveCount(0);
  });
});
