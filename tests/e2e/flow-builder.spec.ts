import { expect, test, type Page } from "@playwright/test";

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

async function assignToAdmin(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("审批人来源").click();
  await page.getByRole("option", { name: "指定人员" }).click();
  await dialog.getByPlaceholder("搜索姓名或部门").fill("系统管理员");
  await dialog
    .locator("label")
    .filter({ hasText: "系统管理员" })
    .first()
    .getByRole("checkbox")
    .check();
  await dialog.getByRole("button", { name: "应用属性" }).click();
}

test.describe("审批流程配置器", () => {
  test("新建流程 → 配置两个审批节点 → 发布 v1 → 关联模板", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const suffix = uniqueSuffix();
    const code = `E2E_FLOW_${suffix}`;
    const name = `E2E标准流程${suffix}`;

    await page.goto("/admin/flows");
    await expect(page.getByRole("heading", { name: "审批流程" })).toBeVisible();

    await page.getByRole("button", { name: "新建流程" }).click();
    const createDialog = page.getByRole("dialog");
    await createDialog.getByLabel("流程编码").fill(code);
    await createDialog.getByLabel("流程名称").fill(name);
    await createDialog.getByLabel("分类").fill("通用");
    await createDialog.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("流程已创建，请配置节点后发布")).toBeVisible();

    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row.getByText("未发布")).toBeVisible();
    await row.getByRole("link", { name: "配置" }).click();
    await expect(
      page.getByRole("heading", { name: `流程配置 · ${name}` }),
    ).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText("校验通过")).toBeVisible();
    await expect(page.getByText("流程入口")).toBeVisible();

    await page.locator('button[aria-label="在此处添加节点"]').first().click();
    await page.getByRole("menuitem", { name: "审批" }).click();
    await assignToAdmin(page);
    const deptCard = page.getByText("审批节点", { exact: true }).first();
    await expect(deptCard).toBeVisible();

    await page.locator('button[aria-label="在此处添加节点"]').first().click();
    await page.getByRole("menuitem", { name: "审批" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("节点名称").fill("法务复核");
    await assignToAdmin(page);

    await expect(
      page.getByRole("button", { name: "JSON 视图" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "JSON 视图" }).click();
    const json = await page.locator("textarea").first().inputValue();
    expect(json).toContain("法务复核");
    expect(json).toContain("\"type\": \"approval\"");

    await page.getByRole("button", { name: "树形配置" }).click();
    await expect(page.getByText("法务复核").first()).toBeVisible();

    await page.getByRole("button", { name: "保存草稿" }).click();
    await expect(page.getByText("草稿已保存")).toBeVisible();

    await page.getByRole("button", { name: "发布新版本" }).click();
    await expect(page.getByText(/已发布为 v1/)).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "发布新版本" }).click();
    await expect(page.getByText(/已发布为 v2/)).toBeVisible({ timeout: 30_000 });

    await page.goto(`/admin/flows`);
    const publishedRow = page.getByRole("row", { name: new RegExp(name) });
    await expect(publishedRow.getByText("v2", { exact: true })).toBeVisible();
    await publishedRow.getByRole("link", { name: "版本" }).click();
    await expect(
      page.getByRole("heading", { name: `版本历史 · ${name}` }),
    ).toBeVisible();
    const versionRows = page.getByRole("table").getByRole("row");
    await expect(versionRows).toHaveCount(3);
    await expect(versionRows.nth(1).getByText("在用")).toBeVisible();
    await expect(versionRows.nth(2).getByText("已归档")).toBeVisible();

    await page.goto("/admin/templates");
    const templateRow = page
      .getByRole("row", { name: /采购合同/ })
      .filter({ hasText: "PURCHASE" });
    await templateRow.getByRole("button", { name: "编辑" }).click();
    const bindDialog = page.getByRole("dialog");
    await bindDialog.getByLabel("关联审批流").click();
    await page.getByRole("option", { name: new RegExp(name) }).click();
    await bindDialog.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("模板已更新")).toBeVisible();
    await expect(templateRow.getByText(name, { exact: true })).toBeVisible();

    await templateRow.getByRole("button", { name: "编辑" }).click();
    const unbindDialog = page.getByRole("dialog");
    await unbindDialog.getByLabel("关联审批流").click();
    await page.getByRole("option", { name: "暂不关联" }).click();
    await unbindDialog.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("模板已更新")).toBeVisible();
    await expect(templateRow.getByText("未关联")).toBeVisible();
  });

  test("审批人解析不到时发布被阻断", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const suffix = uniqueSuffix();
    const name = `E2E空审批${suffix}`;

    await page.goto("/admin/flows");
    await page.getByRole("button", { name: "新建流程" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("流程编码").fill(`E2E_EMPTY_${suffix}`);
    await dialog.getByLabel("流程名称").fill(name);
    await dialog.getByLabel("分类").fill("通用");
    await dialog.getByRole("button", { name: "保存" }).click();

    const row = page.getByRole("row", { name: new RegExp(name) });
    await row.getByRole("link", { name: "配置" }).click();
    await expect(
      page.getByRole("heading", { name: `流程配置 · ${name}` }),
    ).toBeVisible();

    await page.getByRole("button", { name: "JSON 视图" }).click();
    await page.locator("textarea").first().fill(
      JSON.stringify(
        {
          schemaVersion: 1,
          entry: "start",
          nodes: [
            { id: "start", type: "start", name: "发起", next: "legal" },
            {
              id: "legal",
              type: "approval",
              name: "法务审核",
              assignee: { kind: "role", key: `ghost_role_${suffix}` },
              mode: "any",
              next: "end",
            },
            { id: "end", type: "end", name: "结束", result: "approved" },
          ],
        },
        null,
        2,
      ),
    );
    await page.getByRole("button", { name: "校验并同步到树形" }).click();
    await expect(page.getByText(/角色 .* 不存在|ghost_role/).first()).toBeVisible();

    await page.getByRole("button", { name: "发布新版本" }).click();
    await expect(
      page.getByText(/没有可用成员|无法发布|校验未通过/).first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});
