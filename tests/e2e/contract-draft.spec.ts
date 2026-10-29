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

const PDF_BYTES = Buffer.from(
  [
    "%PDF-1.4",
    "1 0 obj",
    "<< /Type /Catalog /Pages 2 0 R >>",
    "endobj",
    "2 0 obj",
    "<< /Type /Pages /Kids [] /Count 0 >>",
    "endobj",
    "trailer",
    "<< /Root 1 0 R >>",
    "%%EOF",
    "",
  ].join("\n"),
);

test.describe("合同起草与附件", () => {
  test("起草、编辑动态字段并上传下载附件", async ({ page, request }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const suffix = uniqueSuffix();
    const title = `E2E采购合同${suffix}`;
    const editedTitle = `${title}（修订）`;

    await page.goto("/contracts/new");
    await expect(page.getByRole("heading", { name: "新建合同" })).toBeVisible();

    await page.getByLabel("合同模板").selectOption({ label: "采购合同（PURCHASE）" });
    await page.getByLabel("合同标题").fill(title);
    await page
      .getByLabel("甲方")
      .selectOption({ label: "上海华信科技有限公司（91310000MA1FL0XX1A）" });
    await page
      .getByLabel("乙方")
      .selectOption({ label: "杭州云诚供应链有限公司（91330100MA2GL1YY2B）" });
    await page.getByLabel("合同金额").fill("128000.50");
    await page.getByLabel("签署日期").fill("2026-10-29");
    await page.getByLabel("开始日期").fill("2026-11-01");
    await page.getByLabel("结束日期").fill("2027-10-31");

    await page.getByLabel("采购标的").fill("办公用品年度采购");
    await page.getByLabel("交付周期（天）").fill("15");
    await page.getByLabel("首批交付日期").fill("2026-11-15");
    await page.getByLabel("付款方式").selectOption("月结30天");
    await expect(page.getByLabel("现结验收说明")).toHaveCount(0);

    await page.locator("#bodyMarkdown").fill("## 第一条\n\n供方按约定交付办公用品。");

    await page.getByRole("button", { name: "保存草稿" }).click();
    await expect(page).toHaveURL(/\/contracts\/(?!new$)[a-z0-9]+$/i, {
      timeout: 30_000,
    });

    const contractId = new URL(page.url()).pathname.split("/").pop();
    expect(contractId).toBeTruthy();

    await expect(
      page.getByRole("heading", { name: title }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/HT-PURCHASE-\d{6}-\d{4} · 采购合同（PURCHASE）/),
    ).toBeVisible();
    await expect(page.getByText("草稿", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText("128,000.50", { exact: false }).first(),
    ).toBeVisible();
    await expect(page.getByText("办公用品年度采购")).toBeVisible();
    await expect(page.getByText("供方按约定交付办公用品。")).toBeVisible();

    await page.getByRole("link", { name: "编辑草稿" }).click();
    await expect(page).toHaveURL(/\/contracts\/[a-z0-9]+\/edit$/i);

    await page.getByLabel("合同标题").fill(editedTitle);
    await page.getByLabel("付款方式").selectOption("现结");
    await expect(page.getByLabel("现结验收说明")).toBeVisible();
    await page.getByLabel("现结验收说明").fill("到货验收后 3 日内付清全款");
    await page.getByRole("button", { name: "保存修改" }).click();

    await expect(page).toHaveURL(
      new RegExp(`/contracts/${contractId}$`),
      { timeout: 20_000 },
    );
    await expect(page.getByRole("heading", { name: editedTitle })).toBeVisible();
    await expect(page.getByText(/版本 v1（共 1 个版本）/)).toBeVisible();
    await expect(page.getByText("到货验收后 3 日内付清全款")).toBeVisible();

    const pdfName = `采购合同正文-${suffix}.pdf`;
    await page.locator('input[type="file"]').setInputFiles({
      name: pdfName,
      mimeType: "application/pdf",
      buffer: PDF_BYTES,
    });
    await page.getByRole("button", { name: "上传", exact: true }).click();
    const pdfLink = page.getByRole("link", { name: pdfName });
    await expect(pdfLink).toBeVisible({ timeout: 20_000 });

    const href = await pdfLink.getAttribute("href");
    expect(href).toBeTruthy();
    const download = await page.request.get(href as string);
    expect(download.status()).toBe(200);
    expect(download.headers()["content-type"]).toContain("application/pdf");
    expect(download.headers()["x-content-type-options"]).toBe("nosniff");
    expect((await download.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const anonymous = await request.get(href as string);
    expect(anonymous.status()).toBe(401);

    await page.goto(`/contracts?q=${encodeURIComponent(editedTitle)}`);
    await expect(page.getByRole("link", { name: editedTitle })).toBeVisible();
  });
});
