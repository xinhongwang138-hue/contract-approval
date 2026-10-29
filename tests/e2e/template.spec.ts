import { expect, test, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Admin@12345";

test.describe.configure({ timeout: 180_000 });

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

test.describe("合同模板与字段设计", () => {
  test("创建模板并配置数字字段与必填校验", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const suffix = uniqueSuffix();
    const code = `E2E${suffix}`;
    const name = `E2E模板${suffix}`;

    await page.goto("/admin/templates");
    await expect(page.getByRole("heading", { name: "合同模板" })).toBeVisible();

    await page.getByRole("button", { name: "新建模板" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("模板编码").fill(code);
    await dialog.getByLabel("模板名称").fill(name);
    await dialog.getByLabel("分类").fill("测试");
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("模板已创建，请继续配置字段")).toBeVisible();

    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await row.getByRole("link", { name: "字段设计" }).click();
    await expect(
      page.getByRole("heading", { name: `字段设计 · ${name}` }),
    ).toBeVisible();

    await page.getByRole("button", { name: "添加字段" }).click();
    await page.getByLabel("字段标识").fill("threshold");
    await page.getByLabel("字段名称").fill("阈值");
    await page.getByLabel("字段类型").click();
    await page.getByRole("option", { name: "数字", exact: true }).click();
    await page.getByLabel("最小值").fill("0");
    await page.getByLabel("最大值").fill("100");

    await page.getByRole("button", { name: "添加字段" }).click();
    await page.getByLabel("字段标识").nth(1).fill("remark");
    await page.getByLabel("字段名称").nth(1).fill("备注");
    await page.getByLabel("是否必填").nth(1).click();

    await page.getByRole("button", { name: "保存字段" }).first().click();
    await expect(page.getByText("字段已保存")).toBeVisible();
    await expect(page.getByText("共 2 / 30 个字段")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("字段标识").first()).toHaveValue("threshold");
    await expect(page.getByLabel("字段名称").first()).toHaveValue("阈值");
    await expect(page.getByLabel("最小值")).toHaveValue("0");
    await expect(page.getByLabel("最大值")).toHaveValue("100");
    await expect(page.getByLabel("字段标识").nth(1)).toHaveValue("remark");
    await expect(page.getByText("共 2 / 30 个字段")).toBeVisible();
  });

  test("模板字段配置错误时前端拦截", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/admin/templates");

    const row = page
      .getByRole("row", { name: /采购合同/ })
      .filter({ hasText: "PURCHASE" });
    await row.getByRole("link", { name: "字段设计" }).click();
    await expect(
      page.getByRole("heading", { name: /字段设计 · 采购合同/ }),
    ).toBeVisible();

    await page.getByRole("button", { name: "添加字段" }).click();
    await page.getByLabel("字段标识").last().fill("Bad-Key");
    await page.getByLabel("字段名称").last().fill("非法标识");
    await page.getByRole("button", { name: "保存字段" }).first().click();
    await expect(page.getByText(/字段标识需以小写字母开头/).first()).toBeVisible();

    await page.getByRole("button", { name: "删除字段" }).last().click();
    await expect(page.getByRole("button", { name: "保存字段" }).first()).toBeEnabled();
  });
});
