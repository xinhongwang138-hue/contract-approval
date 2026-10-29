import { expect, test, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Admin@12345";

function uniqueSuffix(): string {
  return `${Date.now()}`.slice(-7);
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL("/");
}

test.describe("部门管理", () => {
  test("创建部门树、重挂载子树并受删除守卫约束", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/admin/departments");
    await expect(page.getByRole("heading", { name: "部门管理" })).toBeVisible();

    const suffix = uniqueSuffix();
    const parentName = `E2E部门${suffix}`;
    const childName = `E2E子部门${suffix}`;
    const siblingName = `E2E另一部门${suffix}`;
    const table = page.getByRole("table");

    await page.getByRole("button", { name: "新建部门" }).click();
    await page.getByLabel("部门名称").fill(parentName);
    await page.getByRole("button", { name: "保存" }).click();
    await expect(table.getByText(parentName, { exact: true })).toBeVisible();

    await page
      .getByRole("button", { name: `在 ${parentName} 下新建子部门` })
      .click();
    await page.getByLabel("部门名称").fill(childName);
    await page.getByRole("button", { name: "保存" }).click();
    await expect(table.getByText(childName, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: `删除 ${parentName}` }).click();
    await page.getByRole("button", { name: "确认删除" }).click();
    await expect(page.getByText("请先删除或移走下级部门")).toBeVisible();
    await expect(table.getByText(parentName, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: `删除 ${childName}` }).click();
    await page.getByRole("button", { name: "确认删除" }).click();
    await expect(table.getByText(childName, { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "新建部门" }).click();
    await page.getByLabel("部门名称").fill(siblingName);
    await page.getByRole("button", { name: "保存" }).click();
    await expect(table.getByText(siblingName, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: `编辑 ${parentName}` }).click();
    await page.getByRole("combobox", { name: "上级部门" }).click();
    await page.getByRole("option", { name: siblingName, exact: true }).click();
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("部门已更新")).toBeVisible();
    await expect(
      table.getByRole("row", { name: new RegExp(`└ ${parentName}`) }),
    ).toBeVisible();

    await page.getByRole("button", { name: `删除 ${siblingName}` }).click();
    await page.getByRole("button", { name: "确认删除" }).click();
    await expect(page.getByText("请先删除或移走下级部门")).toBeVisible();

    await page.getByRole("button", { name: `编辑 ${parentName}` }).click();
    await page.getByRole("combobox", { name: "上级部门" }).click();
    await page.getByRole("option", { name: "无（根部门）", exact: true }).click();
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("部门已更新")).toBeVisible();

    await page.getByRole("button", { name: `删除 ${parentName}` }).click();
    await page.getByRole("button", { name: "确认删除" }).click();
    await expect(table.getByText(parentName, { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: `删除 ${siblingName}` }).click();
    await page.getByRole("button", { name: "确认删除" }).click();
    await expect(table.getByText(siblingName, { exact: true })).toHaveCount(0);
  });
});

test.describe("用户与权限边界", () => {
  test("新用户登录后看不到管理入口且直连被拒绝", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/admin/users");

    const suffix = uniqueSuffix();
    const email = `e2e.${suffix}@example.com`;
    const password = `E2ePass${suffix}`;
    const name = `E2E员工${suffix}`;

    await page.getByRole("button", { name: "新建用户" }).click();
    await page.getByLabel("姓名").fill(name);
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("初始密码").fill(password);
    await page.getByRole("checkbox", { name: /普通员工/ }).click();
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText(email, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(page).toHaveURL(/\/login/);

    await login(page, email, password);
    await expect(page.getByRole("heading", { name: /你好/ })).toBeVisible();

    await expect(page.getByRole("link", { name: "用户", exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "角色权限", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "相对方", exact: true }),
    ).toBeVisible();

    await page.goto("/admin/users");
    await expect(page.getByText("无权访问")).toBeVisible();
    await expect(page.getByRole("button", { name: "新建用户" })).toHaveCount(0);

    await page.goto("/admin/roles");
    await expect(page.getByText("无权访问")).toBeVisible();
  });

  test("停用用户后其会话立即失效", async ({ page, browser }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/admin/users");

    const suffix = uniqueSuffix();
    const email = `e2e.disabled.${suffix}@example.com`;
    const password = `E2ePass${suffix}`;
    const name = `E2E停用${suffix}`;

    await page.getByRole("button", { name: "新建用户" }).click();
    await page.getByLabel("姓名").fill(name);
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("初始密码").fill(password);
    await page.getByRole("checkbox", { name: /普通员工/ }).click();
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText(email, { exact: true })).toBeVisible();

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await login(memberPage, email, password);
    await expect(memberPage.getByRole("heading", { name: /你好/ })).toBeVisible();

    await page.getByRole("button", { name: `编辑 ${name}` }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "状态" }).click();
    await page.getByRole("option", { name: "停用", exact: true }).click();
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("用户已更新")).toBeVisible();

    await memberPage.reload();
    await expect(memberPage).toHaveURL(/\/login/);
    await memberContext.close();
  });
});

test.describe("角色权限", () => {
  test("系统角色只读，可创建自定义角色并进入权限矩阵", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/admin/roles");
    await expect(page.getByRole("heading", { name: "角色权限" })).toBeVisible();

    await expect(
      page.getByRole("button", { name: "编辑 系统管理员" }),
    ).toBeDisabled();

    const suffix = uniqueSuffix();
    const roleName = `E2E审核${suffix}`;
    const roleKey = `e2e_role_${suffix}`;

    await page.getByRole("button", { name: "新建角色" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("角色名称").fill(roleName);
    await dialog.getByLabel("角色标识").fill(roleKey);
    await dialog.getByRole("combobox", { name: "数据范围" }).click();
    await page.getByRole("option", { name: "本部门", exact: true }).click();
    await dialog.getByRole("checkbox", { name: /查看合同/ }).click();
    await dialog.getByRole("checkbox", { name: /审批合同/ }).click();
    await dialog.getByRole("button", { name: "保存" }).click();

    await expect(page.getByText(roleName, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(roleKey, { exact: true })).toBeVisible();

    const matrix = page.getByRole("table").nth(1);
    await expect(matrix.getByRole("columnheader", { name: roleName })).toBeVisible();

    await page.getByRole("button", { name: `编辑 ${roleName}` }).click();
    const editDialog = page.getByRole("dialog");
    await editDialog.getByRole("combobox", { name: "数据范围" }).click();
    await page.getByRole("option", { name: "本部门及下级", exact: true }).click();
    await editDialog.getByRole("checkbox", { name: /查看合同/ }).click();
    await editDialog.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("角色已更新")).toBeVisible();
    const roleRow = page.getByRole("row", { name: new RegExp(roleName) });
    await expect(roleRow.getByText("本部门及下级")).toBeVisible();
    await expect(roleRow.getByText("1 项")).toBeVisible();

    await page.getByRole("button", { name: `删除 ${roleName}` }).click();
    await page.getByRole("button", { name: "确认删除" }).click();
    await expect(page.getByText(roleName, { exact: true })).toHaveCount(0);
  });
});

test.describe("相对方", () => {
  test("创建相对方并拦截重复与非法信用代码", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/admin/parties");

    const suffix = uniqueSuffix();
    const name = `E2E客户${suffix}`;
    const uscc = `91330106${suffix}12345`.slice(0, 18);

    await page.getByRole("button", { name: "新建相对方" }).click();
    await page.getByLabel("名称").fill(name);
    await page.getByLabel("统一社会信用代码").fill(uscc);
    await page.getByRole("button", { name: "添加联系人" }).click();
    await page.getByLabel("联系人 1 姓名").fill("E2E联系人");
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "新建相对方" }).click();
    await page.getByLabel("名称").fill(`${name}重复`);
    await page.getByLabel("统一社会信用代码").fill(uscc);
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("统一社会信用代码已存在")).toBeVisible();

    await page.getByLabel("统一社会信用代码").fill("123");
    await page.getByRole("button", { name: "保存" }).click();
    await expect(
      page.getByText("统一社会信用代码为 18 位").first(),
    ).toBeVisible();

    await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("管理页面访问控制", () => {
  test("未登录访问管理页重定向登录", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("账号登录", { exact: true })).toBeVisible();
  });
});
