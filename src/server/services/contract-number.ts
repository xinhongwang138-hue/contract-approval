import type { Prisma } from "@/generated/prisma/client";
import { shanghaiYearMonth } from "@/shared/datetime";

type SequenceRow = { seq: number };

export async function allocateContractNo(
  tx: Prisma.TransactionClient,
  templateCode: string,
  at: Date = new Date(),
): Promise<string> {
  const ym = shanghaiYearMonth(at);

  // 先确保序列行存在，再用行锁串行化同一模板同一月份的发号，避免并发跳号或重号。
  await tx.$executeRaw`
    INSERT INTO "ContractNoSequence" ("templateCode", "ym", "seq", "updatedAt")
    VALUES (${templateCode}, ${ym}, 0, NOW())
    ON CONFLICT ("templateCode", "ym") DO NOTHING
  `;

  const rows = await tx.$queryRaw<SequenceRow[]>`
    SELECT "seq" FROM "ContractNoSequence"
    WHERE "templateCode" = ${templateCode} AND "ym" = ${ym}
    FOR UPDATE
  `;
  const current = rows[0]?.seq;
  if (current === undefined) {
    throw new Error("合同编号序列初始化失败");
  }

  const next = current + 1;
  await tx.$executeRaw`
    UPDATE "ContractNoSequence"
    SET "seq" = ${next}, "updatedAt" = NOW()
    WHERE "templateCode" = ${templateCode} AND "ym" = ${ym}
  `;

  return `HT-${templateCode}-${ym}-${String(next).padStart(4, "0")}`;
}
