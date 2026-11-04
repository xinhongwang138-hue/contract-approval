import "dotenv/config";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 集成测试连的是独立的 contract_test 库（TEST_MIGRATE_DATABASE_URL 指向它）。
// 没配这个变量时只跑单元测试，并明确说出跳过了什么 —— 既不静默略过，
// 也不把「环境没配」呈现成十几个失败文件。上面必须先 dotenv，否则 .env 里的值读不到。
const hasTestDatabase = Boolean(process.env.TEST_MIGRATE_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "\n[vitest] 未配置 TEST_MIGRATE_DATABASE_URL：本次只跑单元测试，tests/integration 已跳过。\n" +
      "         要跑集成测试：docker compose up -d，把 .env.example 里的 TEST_DATABASE_URL 与\n" +
      "         TEST_MIGRATE_DATABASE_URL 填进 .env，再执行 npm run test:integration。\n",
  );
}

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/unit/**/*.test.ts",
      ...(hasTestDatabase ? ["tests/integration/**/*.test.ts"] : []),
    ],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
