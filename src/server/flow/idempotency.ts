import { randomUUID } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client";

type IdempotencyDb = Pick<Prisma.TransactionClient, "$executeRaw">;

/**
 * 用 ON CONFLICT DO NOTHING 抢占幂等键，而不是 try/catch P2002：
 * Postgres 里唯一键冲突会把整个事务标记为 aborted，之后每条语句都报 25P02，
 * worker 的整轮扫描会因此永久失败。返回 false 表示这一轮已经处理过。
 */
export async function claimOnce(
  db: IdempotencyDb,
  input: { key: string; scope: string; response: Record<string, unknown> },
): Promise<boolean> {
  const inserted = await db.$executeRaw`
    INSERT INTO "IdempotencyKey" ("id", "key", "scope", "response")
    VALUES (${randomUUID()}, ${input.key}, ${input.scope}, ${JSON.stringify(input.response)}::jsonb)
    ON CONFLICT ("key", "scope") DO NOTHING
  `;
  return inserted === 1;
}
