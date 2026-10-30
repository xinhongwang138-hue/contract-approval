import { execFileSync } from "node:child_process";
import path from "node:path";
import { Client } from "pg";

let migrated: Promise<void> | null = null;

async function migrateTestDatabase(): Promise<void> {
  const migrateUrl = process.env.TEST_MIGRATE_DATABASE_URL;
  if (!migrateUrl) {
    throw new Error("TEST_MIGRATE_DATABASE_URL 未配置，集成测试需要独立的 contract_test 数据库");
  }
  const cli = path.resolve(process.cwd(), "node_modules/prisma/build/index.js");
  execFileSync(process.execPath, [cli, "migrate", "deploy"], {
    env: { ...process.env, MIGRATE_DATABASE_URL: migrateUrl },
    stdio: "pipe",
  });
}

export function ensureTestDatabase(): Promise<void> {
  migrated ??= migrateTestDatabase();
  return migrated;
}

// 应用角色对 append-only 表只有 INSERT 权限，清空必须走 owner（迁移）角色。
export async function deleteAsOwner(sql: string, params?: unknown[]): Promise<void> {
  const url = process.env.TEST_MIGRATE_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_MIGRATE_DATABASE_URL 未配置，无法清理 append-only 表");
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql, params as unknown[] | undefined);
  } finally {
    await client.end();
  }
}
