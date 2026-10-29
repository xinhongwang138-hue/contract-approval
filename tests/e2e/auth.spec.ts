import { expect, test } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Admin@12345";

test.describe("登录与会话", () => {
  test("未登录访问工作台跳转登录页", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("账号登录", { exact: true })).toBeVisible();
  });

  test("未登录访问 API 返回 401", async ({ request }) => {
    const response = await request.get("/api/files/not-exist");
    expect(response.status()).toBe(401);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  test("健康检查无需登录", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { ok: boolean; db: string };
    expect(body.ok).toBe(true);
    expect(body.db).toBe("up");
  });

  test("错误密码提示失败", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("邮箱").fill(ADMIN_EMAIL);
    await page.getByLabel("密码").fill("wrong-password");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.getByText("邮箱或密码错误")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("正确账号登录进入工作台并可以退出", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("邮箱").fill(ADMIN_EMAIL);
    await page.getByLabel("密码").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: /你好/ }),
    ).toBeVisible();
    await expect(page.getByText("待我审批")).toBeVisible();

    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("登录失败锁定", () => {
  const forwardedIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  test.use({ extraHTTPHeaders: { "x-forwarded-for": forwardedIp } });

  test("连续 5 次失败后第 6 次提示锁定", async ({ page }) => {
    const email = `missing-${Date.now()}@example.com`;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.goto("/login");
      await page.getByLabel("邮箱").fill(email);
      await page.getByLabel("密码").fill("wrong-password");
      await page.getByRole("button", { name: "登录" }).click();
      await expect(page.getByText("邮箱或密码错误")).toBeVisible();
    }

    await page.goto("/login");
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill("wrong-password");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(
      page.getByText("登录失败次数过多，请 15 分钟后再试"),
    ).toBeVisible();
  });
});
