/**
 * `npm run test:integration` 的前置检查。
 *
 * 集成测试连独立的 contract_test 库。变量缺失时 vitest 会按配置跳过集成文件，
 * 那样「跑完了」其实什么都没测；这里先把话说清楚再退出，避免假绿。
 */
import "dotenv/config";

if (!process.env.TEST_MIGRATE_DATABASE_URL) {
  console.error(`
[test:integration] 缺少 TEST_MIGRATE_DATABASE_URL。

集成测试跑在独立的 contract_test 库上，不碰开发库。补齐步骤：
  1) docker compose up -d
  2) 在 .env 里填 TEST_DATABASE_URL 与 TEST_MIGRATE_DATABASE_URL
     （取值见 .env.example，两个库名都是 contract_test）
  3) 重新执行 npm run test:integration
`);
  process.exit(1);
}
