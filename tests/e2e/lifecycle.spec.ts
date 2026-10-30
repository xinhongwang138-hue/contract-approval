import { expect, test, type Browser, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Admin@12345";

test.describe.configure({ timeout: 240_000 });

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

async function openContext(browser: Browser, email: string, password: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page, email, password);
  return page;
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
  // 部门是 Radix Select；「部门」子串会撞上「部门主管」角色复选框，必须 exact
  await dialog.getByRole("combobox", { name: "部门", exact: true }).click();
  await admin.getByRole("option", { name: /总公司/ }).click();
  await dialog.getByRole("checkbox", { name: /部门主管/ }).click();
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(admin.getByText(user.email, { exact: true })).toBeVisible();
}

async function assignTo(page: Page, displayName: string, searchTerm: string): Promise<void> {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("审批人来源").click();
  await page.getByRole("option", { name: "指定人员" }).click();
  await dialog.getByPlaceholder("输入姓名或邮箱，回车搜索").fill(searchTerm);
  await dialog.getByRole("button", { name: "搜索" }).click();
  const row = dialog.locator("label").filter({ hasText: displayName }).first();
  await expect(row).toBeVisible();
  await row.getByRole("checkbox").check();
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
  await page.getByLabel("合同金额").fill("180000.00");
  await page.getByLabel("签署日期").fill("2026-10-30");
  await page.getByLabel("开始日期").fill("2026-11-01");
  await page.getByLabel("结束日期").fill("2027-10-31");
  await page.getByLabel("采购标的").fill("机房巡检服务");
  await page.getByLabel("交付周期（天）").fill("15");
  await page.getByLabel("首批交付日期").fill("2026-12-05");
  await page.getByLabel("付款方式").selectOption("月结30天");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page).toHaveURL(/\/contracts\/(?!new$)[a-z0-9]+$/i, { timeout: 30_000 });
  return new URL(page.url()).pathname.split("/").pop() as string;
}

/**
 * 建一条「审批 → 自动动作(create_seal_record)」的流程并发布，然后绑定到采购合同模板。
 * 动作节点 payload 留空即可：engine.ts 里 sealType 默认 company、copies 默认 1。
 */
async function buildFlowWithSealAction(
  admin: Page,
  flowName: string,
  flowCode: string,
  approverName: string,
  approverEmail: string,
): Promise<void> {
  await admin.goto("/admin/flows");
  await admin.getByRole("button", { name: "新建流程" }).click();
  const flowDialog = admin.getByRole("dialog");
  await flowDialog.getByLabel("流程编码").fill(flowCode);
  await flowDialog.getByLabel("流程名称").fill(flowName);
  await flowDialog.getByLabel("分类").fill("通用");
  await flowDialog.getByRole("button", { name: "保存" }).click();

  const flowRow = admin.getByRole("row", { name: new RegExp(flowName) });
  await flowRow.getByRole("link", { name: "配置" }).click();
  await expect(
    admin.getByRole("heading", { name: `流程配置 · ${flowName}` }),
  ).toBeVisible({ timeout: 30_000 });

  // 第一个节点：审批
  await admin.locator('button[aria-label="在此处添加节点"]').first().click();
  await admin.getByRole("menuitem", { name: "审批" }).click();
  await assignTo(admin, approverName, approverEmail);
  // 第二个节点：自动动作，插在审批之后（此时应有 2 个连接点）
  const connectors = admin.locator('button[aria-label="在此处添加节点"]');
  await expect(connectors).toHaveCount(2);
  await connectors.nth(1).click();
  await admin.getByRole("menuitem", { name: "自动动作" }).click();

  // 动作类型是 Radix Select：必须等面板打开动画结束再点，否则 pointerdown 会被吞
  const actionKind = admin.getByRole("combobox", { name: "动作类型" });
  await expect(actionKind).toBeVisible({ timeout: 30_000 });
  await admin.waitForTimeout(600);
  await actionKind.click();
  await expect(admin.getByRole("listbox")).toBeVisible({ timeout: 10_000 });
  await admin.getByRole("option", { name: /创建用印申请/ }).click();
  await expect(actionKind).toHaveText(/创建用印申请/);

  // 抽屉不关掉会挡住工具栏的「保存草稿」
  await admin.getByRole("button", { name: "应用属性" }).click();
  await admin.getByRole("button", { name: "保存草稿" }).click();
  await expect(admin.getByText("草稿已保存")).toBeVisible();
  await admin.getByRole("button", { name: "发布新版本" }).click();
  await expect(admin.getByText(/已发布为 v1/)).toBeVisible({ timeout: 30_000 });

  // 绑到采购合同模板
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
  // 绑定必须落库，否则后面提交会派给别人的待办
  await expect(
    templateRow.getByRole("cell", { name: flowName, exact: true }),
  ).toBeVisible();
}

test.describe("用印与归档", () => {
  test("审批通过自动生成用印申请 → 取件 → 归还 → 履行中 → 归档", async ({ browser }) => {
    const suffix = uniqueSuffix();
    const approverName = `E2E用印审批员${suffix}`;
    const approverEmail = `e2e.seal.${suffix}@example.com`;
    const approverPassword = `Seal${suffix}`;
    const flowName = `E2E用印流程${suffix}`;
    const flowCode = `E2E_SEAL_${suffix}`.slice(0, 30);
    const contractTitle = `E2E用印合同${suffix}`;

    const admin = await openContext(browser, ADMIN_EMAIL, ADMIN_PASSWORD);

    await createApproverUser(admin, {
      name: approverName,
      email: approverEmail,
      password: approverPassword,
    });

    await buildFlowWithSealAction(admin, flowName, flowCode, approverName, approverEmail);

    const contractId = await createDraftContract(admin, contractTitle);
    await admin.getByRole("button", { name: "提交审批" }).click();
    const submitDialog = admin.getByRole("dialog");
    await expect(submitDialog.getByText(flowName)).toBeVisible();
    await expect(submitDialog.getByText(approverName)).toBeVisible();
    await submitDialog.getByRole("button", { name: "确认提交" }).click();
    await expect(admin.getByText("已提交审批")).toBeVisible();

    // 审批人同意
    const approver = await openContext(browser, approverEmail, approverPassword);
    await approver
      .getByRole("link", { name: new RegExp(contractTitle) })
      .first()
      .click();
    await approver.getByRole("button", { name: "同意" }).click();
    const approveDialog = approver.getByRole("dialog");
    await approveDialog.getByLabel(/审批意见/).fill("同意用印");
    await approveDialog.getByRole("button", { name: "确认提交" }).click();
    await expect(approver.getByText("已同意")).toBeVisible();

    // 动作节点应把合同推到「待用印」，并生成用印申请
    await admin.goto(`/contracts/${contractId}`);
    await admin.reload();
    await expect(admin.getByText("待用印", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });

    // 用印页：登记取件
    await admin.goto("/seals");
    const sealRow = admin.getByRole("row", { name: new RegExp(contractTitle) });
    await expect(sealRow).toBeVisible({ timeout: 30_000 });
    await expect(sealRow.getByText("待取件")).toBeVisible();
    await sealRow.getByRole("button", { name: "登记取件" }).click();
    await expect(admin.getByText("已登记取件")).toBeVisible();
    await admin.reload();
    await expect(sealRow.getByText("已取件待归还")).toBeVisible({ timeout: 30_000 });

    // 取件后合同应进入「已用印」
    await admin.goto(`/contracts/${contractId}`);
    await admin.reload();
    await expect(admin.getByText("已用印", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });

    // 用印页：登记归还并填用印编号
    await admin.goto("/seals");
    const returnRow = admin.getByRole("row", { name: new RegExp(contractTitle) });
    await returnRow.getByRole("button", { name: "登记归还" }).click();
    const returnDialog = admin.getByRole("dialog");
    await returnDialog.getByLabel(/用印编号/).fill("YZ-2026-0001");
    await returnDialog.getByRole("button", { name: "确认归还" }).click();
    await expect(admin.getByText("已登记归还")).toBeVisible();
    await admin.reload();
    await expect(returnRow.getByText("已归还")).toBeVisible({ timeout: 30_000 });
    await expect(returnRow.getByText("YZ-2026-0001")).toBeVisible();

    // 归还后合同应进入「履行中」
    await admin.goto(`/contracts/${contractId}`);
    await admin.reload();
    await expect(admin.getByText("履行中", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });

    // 归档
    await admin.goto("/archive");
    const archiveRow = admin.getByRole("row", { name: new RegExp(contractTitle) });
    await expect(archiveRow).toBeVisible({ timeout: 30_000 });
    await archiveRow.getByRole("button", { name: "归档" }).click();
    const archiveDialog = admin.getByRole("dialog");
    await archiveDialog.getByLabel(/归档备注/).fill("履行完毕，纸质件移交档案室 A-2026-118");
    await archiveDialog.getByRole("button", { name: "确认归档" }).click();
    await expect(admin.getByText("合同已归档")).toBeVisible();

    // 已归档 tab 应能查到
    await admin.goto("/archive?tab=archived");
    await expect(
      admin.getByRole("row", { name: new RegExp(contractTitle) }),
    ).toBeVisible({ timeout: 30_000 });

    // 通知中心：先证明页面能打开（RSC 边界），再证明 kind 被翻译成中文。
    // notifications/page.tsx:105 是 KIND_LABELS[item.kind] ?? item.kind，
    // 字典缺项不会报错，只会静默把原始英文漏到徽标上。
    await admin.goto("/notifications");
    await expect(admin.getByRole("heading", { name: "消息通知" })).toBeVisible({
      timeout: 30_000,
    });
    // 本轮链路给发起人（admin）产生了 seal（取件/归还）与 archive（归档）两类通知
    const noticeBadges = admin.getByRole("listitem").locator('[data-slot="badge"]');
    await expect(noticeBadges.filter({ hasText: /^用印$/ }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(noticeBadges.filter({ hasText: /^归档$/ }).first()).toBeVisible();
    // 兜底：任何未翻译的原始 kind 都不该出现在徽标上
    await expect(
      noticeBadges.filter({ hasText: /^(task|cc|flow|timeout|seal|archive|expiry)$/ }),
    ).toHaveCount(0);
  });

  test("报表与审计页对管理员可见且有数据", async ({ browser }) => {
    const admin = await openContext(browser, ADMIN_EMAIL, ADMIN_PASSWORD);

    await admin.goto("/reports/efficiency?days=90");
    await expect(
      admin.getByRole("heading", { name: "效率报表" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(admin.getByText("节点效率")).toBeVisible({ timeout: 30_000 });

    await admin.goto("/audit");
    await expect(admin.getByRole("heading", { name: "审计日志" })).toBeVisible();
    await expect(
      admin.getByRole("link", { name: /操作审计/ }),
    ).toBeVisible();
    await admin.getByRole("link", { name: /流程事件/ }).click();
    await expect(admin.getByRole("heading", { name: "审计日志" })).toBeVisible();

    // 报表里的流程汇总应能跳回过滤视图
    await admin.goto("/reports/efficiency?days=90");
    await expect(admin.getByText("流程汇总")).toBeVisible({ timeout: 30_000 });
  });

  test("台账导出 CSV 与 Excel 可下载且内容正确", async ({ browser }) => {
    const { readFileSync } = await import("node:fs");
    const suffix = uniqueSuffix();
    const contractTitle = `E2E台账导出${suffix}`;

    const admin = await openContext(browser, ADMIN_EMAIL, ADMIN_PASSWORD);
    await createDraftContract(admin, contractTitle);

    await admin.goto("/contracts");
    const csvDownload = admin.waitForEvent("download");
    await admin.getByRole("link", { name: "导出 CSV" }).click();
    const csv = await csvDownload;
    expect(csv.suggestedFilename()).toMatch(/\.csv$/);
    const csvPath = await csv.path();
    const text = readFileSync(csvPath!, "utf8");
    expect(text.startsWith(String.fromCharCode(0xfeff))).toBe(true);
    expect(text).toContain("合同编号");
    expect(text).toContain(contractTitle);

    const xlsxDownload = admin.waitForEvent("download");
    await admin.getByRole("link", { name: "导出 Excel" }).click();
    const xlsx = await xlsxDownload;
    expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
    const bytes = readFileSync(await xlsx.path());
    // zip 本地文件头 + OOXML 内容类型声明
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.subarray(0, 400).toString("latin1")).toContain("[Content_Types].xml");
  });

  test("列表分页翻页保留筛选参数", async ({ browser }) => {
    const admin = await openContext(browser, ADMIN_EMAIL, ADMIN_PASSWORD);

    // 用 pageSize=1 让现有数据产生多页，不依赖造数
    await admin.goto("/seals?pageSize=1");
    await expect(admin.getByRole("heading", { name: "用印管理" })).toBeVisible();
    await expect(admin.getByText(/第 1 \/ \d+ 页/)).toBeVisible({ timeout: 30_000 });
    await admin.getByRole("link", { name: "下一页" }).click();
    // 翻页后 page 递增，pageSize 必须跟着带过去（baseQuery 拼接）
    await expect(admin).toHaveURL(/[?&]page=2(&|$)/);
    await expect(admin).toHaveURL(/pageSize=1/);
    await expect(admin.getByText(/第 2 \/ \d+ 页/)).toBeVisible({ timeout: 30_000 });

    // 归档：已归档 tab 同样按 pageSize=1 分页，翻页后 tab 与 pageSize 都要保留
    await admin.goto("/archive?tab=archived&pageSize=1");
    await expect(admin.getByRole("heading", { name: "合同归档" })).toBeVisible();
    await expect(admin.getByText(/第 1 \/ \d+ 页/)).toBeVisible({ timeout: 30_000 });
    await admin.getByRole("link", { name: "下一页" }).click();
    await expect(admin).toHaveURL(/[?&]page=2(&|$)/);
    await expect(admin).toHaveURL(/tab=archived/);
    await expect(admin).toHaveURL(/pageSize=1/);
  });
});
