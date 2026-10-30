import type { Prisma } from "@/generated/prisma/client";
import type { AccessContext } from "@/server/auth/access";
import { buildContractScope } from "@/server/auth/access";
import { prisma } from "@/server/db/client";
import { AppError, ERROR_CODES } from "@/shared/errors";

export type AuditEntry = {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  entity: string;
  entityId: string;
  before: string;
  after: string;
  ip: string | null;
  ua: string | null;
  createdAt: Date;
};

export type FlowEventEntry = {
  id: string;
  instanceId: string;
  contractNo: string;
  contractTitle: string;
  taskId: string | null;
  actorId: string;
  actorName: string;
  action: string;
  from: string | null;
  to: string | null;
  detail: string;
  createdAt: Date;
};

export type Paged<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function requireAuditAccess(access: AccessContext): void {
  if (!access.permissions.has("audit.read")) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "没有查看审计日志的权限");
  }
}

function preview(value: Prisma.JsonValue): string {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value === null ? "—" : String(value);
  }
  const json = JSON.stringify(value);
  return json.length > 160 ? `${json.slice(0, 160)}…` : json;
}

async function actorNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id) => id !== "" && id !== "system"))];
  if (unique.length === 0) {
    return new Map();
  }
  const rows = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  const map = new Map(rows.map((row) => [row.id, row.name]));
  map.set("system", "系统");
  return map;
}

function nameOf(map: Map<string, string>, id: string): string {
  return map.get(id) ?? `${id.slice(0, 8)}（已删除）`;
}

function dateRange(from?: Date, to?: Date): Prisma.AuditLogWhereInput {
  if (!from && !to) {
    return {};
  }
  return {
    createdAt: {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    },
  };
}

export async function listAuditLogs(
  access: AccessContext,
  input: {
    page: number;
    pageSize: number;
    entity?: string;
    action?: string;
    actorId?: string;
    q?: string;
    from?: Date;
    to?: Date;
  },
): Promise<Paged<AuditEntry>> {
  requireAuditAccess(access);

  const where: Prisma.AuditLogWhereInput = {
    ...(input.entity ? { entity: input.entity } : {}),
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.action
      ? { action: { contains: input.action, mode: "insensitive" } }
      : {}),
    ...(input.q ? { entityId: { contains: input.q, mode: "insensitive" } } : {}),
    ...dateRange(input.from, input.to),
  };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  const names = await actorNames(rows.map((row) => row.actorId));

  return {
    rows: rows.map((row) => ({
      id: row.id,
      actorId: row.actorId,
      actorName: nameOf(names, row.actorId),
      action: row.action,
      entity: row.entity,
      entityId: row.entityId,
      before: preview(row.before),
      after: preview(row.after),
      ip: row.ip,
      ua: row.ua,
      createdAt: row.createdAt,
    })),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
  };
}

export async function listFlowEvents(
  access: AccessContext,
  input: {
    page: number;
    pageSize: number;
    action?: string;
    actorId?: string;
    instanceId?: string;
    q?: string;
    from?: Date;
    to?: Date;
  },
): Promise<Paged<FlowEventEntry>> {
  requireAuditAccess(access);
  const scope = await buildContractScope(access);

  const keyword = input.q?.trim() ?? "";
  const keywordFilter: Prisma.ContractWhereInput[] =
    keyword === ""
      ? []
      : [
          {
            OR: [
              { no: { contains: keyword, mode: "insensitive" } },
              { title: { contains: keyword, mode: "insensitive" } },
            ],
          },
        ];
  const contractFilter: Prisma.ContractWhereInput = {
    AND: [scope, { deletedAt: null }, ...keywordFilter],
  };

  const where: Prisma.FlowEventLogWhereInput = {
    instance: {
      deletedAt: null,
      ...(input.instanceId ? { id: input.instanceId } : {}),
      contract: contractFilter,
    },
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.action
      ? { action: { contains: input.action, mode: "insensitive" } }
      : {}),
    ...(input.from || input.to
      ? {
          createdAt: {
            ...(input.from ? { gte: input.from } : {}),
            ...(input.to ? { lte: input.to } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.flowEventLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true,
        instanceId: true,
        taskId: true,
        actorId: true,
        action: true,
        from: true,
        to: true,
        detail: true,
        createdAt: true,
        instance: {
          select: { contract: { select: { no: true, title: true } } },
        },
      },
    }),
    prisma.flowEventLog.count({ where }),
  ]);

  const names = await actorNames(rows.map((row) => row.actorId));

  return {
    rows: rows.map((row) => ({
      id: row.id,
      instanceId: row.instanceId,
      contractNo: row.instance.contract.no,
      contractTitle: row.instance.contract.title,
      taskId: row.taskId,
      actorId: row.actorId,
      actorName: nameOf(names, row.actorId),
      action: row.action,
      from: row.from,
      to: row.to,
      detail: preview(row.detail),
      createdAt: row.createdAt,
    })),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
  };
}

export async function listAuditActorOptions(access: AccessContext): Promise<
  { id: string; name: string }[]
> {
  requireAuditAccess(access);
  const grouped = await prisma.auditLog.groupBy({
    by: ["actorId"],
    where: { actorId: { not: "system" } },
    orderBy: { actorId: "asc" },
    take: 200,
  });
  const names = await actorNames(grouped.map((row) => row.actorId));
  return grouped
    .map((row) => ({ id: row.actorId, name: nameOf(names, row.actorId) }))
    .filter((row) => row.id !== "");
}
