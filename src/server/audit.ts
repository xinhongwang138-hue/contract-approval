import { headers } from "next/headers";
import type { Prisma } from "@/generated/prisma/client";
import type { prisma } from "@/server/db/client";

type AuditDb = Prisma.TransactionClient | typeof prisma;

export type AuditInput = {
  actorId: string;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
};

async function requestMeta(): Promise<{ ip: string | null; ua: string | null }> {
  try {
    const requestHeaders = await headers();
    const forwarded = requestHeaders.get("x-forwarded-for");
    return {
      ip: forwarded?.split(",")[0]?.trim() || requestHeaders.get("x-real-ip") || null,
      ua: requestHeaders.get("user-agent"),
    };
  } catch {
    // Workers and tests run outside a request scope.
    return { ip: null, ua: null };
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function recordAudit(db: AuditDb, input: AuditInput): Promise<void> {
  const meta = await requestMeta();
  await db.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      before: toJson(input.before),
      after: toJson(input.after),
      ip: meta.ip,
      ua: meta.ua,
    },
  });
}
