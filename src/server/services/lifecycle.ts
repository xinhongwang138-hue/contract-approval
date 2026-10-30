import type { Prisma } from "@/generated/prisma/client";
import type { AccessContext } from "@/server/auth/access";
import { buildContractScope, requirePermission } from "@/server/auth/access";
import { recordAudit } from "@/server/audit";
import { prisma } from "@/server/db/client";
import { claimOnce } from "@/server/flow/idempotency";
import {
  CONTRACT_TRANSITIONS,
  assertTransition,
  type ContractStatus,
} from "@/shared/state-machines";
import { AppError, ERROR_CODES } from "@/shared/errors";
import { addDays } from "@/shared/datetime";
import {
  ARCHIVABLE_CONTRACT_STATUSES,
  SEAL_TYPE_LABELS,
  sealStateOf,
  type SealState,
  type SealType,
} from "@/shared/lifecycle";

type LifecycleDb = Prisma.TransactionClient | typeof prisma;

const SYSTEM_ACTOR = "system";

export type SealRow = {
  id: string;
  contractId: string;
  contractNo: string;
  contractTitle: string;
  contractStatus: ContractStatus;
  sealType: SealType;
  copies: number;
  applicantId: string;
  applicantName: string;
  appliedAt: Date;
  pickedAt: Date | null;
  returnedAt: Date | null;
  notaryNo: string | null;
  state: SealState;
};

export type SealList = {
  rows: SealRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  counts: Record<SealState, number>;
};

const SEAL_SELECT = {
  id: true,
  contractId: true,
  sealType: true,
  copies: true,
  applicantId: true,
  appliedAt: true,
  pickedAt: true,
  returnedAt: true,
  notaryNo: true,
  contract: {
    select: {
      no: true,
      title: true,
      status: true,
    },
  },
} satisfies Prisma.SealRecordSelect;

type SealRecordRow = Prisma.SealRecordGetPayload<{ select: typeof SEAL_SELECT }>;

// SealRecord.applicantId / ContractMilestone.operatorId 只存 id，不建关系，按需批量取名。
async function resolveNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id) => id !== ""))];
  if (unique.length === 0) {
    return new Map();
  }
  const rows = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

function toSealRow(row: SealRecordRow, applicantName: string): SealRow {
  return {
    id: row.id,
    contractId: row.contractId,
    contractNo: row.contract.no,
    contractTitle: row.contract.title,
    contractStatus: row.contract.status as ContractStatus,
    sealType: row.sealType as SealType,
    copies: row.copies,
    applicantId: row.applicantId,
    applicantName,
    appliedAt: row.appliedAt,
    pickedAt: row.pickedAt,
    returnedAt: row.returnedAt,
    notaryNo: row.notaryNo,
    state: sealStateOf({ pickedAt: row.pickedAt, returnedAt: row.returnedAt }),
  };
}

async function toSealRows(rows: SealRecordRow[]): Promise<SealRow[]> {
  const names = await resolveNames(rows.map((row) => row.applicantId));
  return rows.map((row) => toSealRow(row, names.get(row.applicantId) ?? "已删除用户"));
}

function stateWhere(state: SealState): Prisma.SealRecordWhereInput {
  if (state === "pending_pick") {
    return { pickedAt: null };
  }
  if (state === "pending_return") {
    return { pickedAt: { not: null }, returnedAt: null };
  }
  return { returnedAt: { not: null } };
}

export async function listSealRecords(
  access: AccessContext,
  input: { page: number; pageSize: number; state: SealState | null; q: string },
): Promise<SealList> {
  const scope = await buildContractScope(access);
  const base: Prisma.SealRecordWhereInput = {
    deletedAt: null,
    contract: { AND: [scope, { deletedAt: null }] },
  };
  const keyword = input.q.trim();
  if (keyword !== "") {
    base.contract = {
      AND: [
        scope,
        { deletedAt: null },
        {
          OR: [
            { no: { contains: keyword, mode: "insensitive" } },
            { title: { contains: keyword, mode: "insensitive" } },
          ],
        },
      ],
    };
  }

  const [rows, total, pendingPick, pendingReturn, returned] = await Promise.all([
    prisma.sealRecord.findMany({
      where: {
        AND: [base, ...(input.state ? [stateWhere(input.state)] : [])],
      },
      orderBy: { appliedAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: SEAL_SELECT,
    }),
    prisma.sealRecord.count({ where: base }),
    prisma.sealRecord.count({ where: { AND: [base, stateWhere("pending_pick")] } }),
    prisma.sealRecord.count({ where: { AND: [base, stateWhere("pending_return")] } }),
    prisma.sealRecord.count({ where: { AND: [base, stateWhere("returned")] } }),
  ]);

  return {
    rows: await toSealRows(rows),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
    counts: {
      pending_pick: pendingPick,
      pending_return: pendingReturn,
      returned,
    },
  };
}

async function loadSealRecord(db: LifecycleDb, id: string) {
  const row = await db.sealRecord.findFirst({
    where: { id, deletedAt: null },
    select: SEAL_SELECT,
  });
  if (!row) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "用印申请不存在");
  }
  return row;
}

/**
 * 状态迁移用 updateMany 的 status 条件当乐观锁：并发下只有一个请求能推进合同，
 * 其余拿到 0 行后按「已被别人处理」报错，而不是把合同改回旧状态。
 */
async function moveContract(
  db: LifecycleDb,
  input: {
    contractId: string;
    from: ContractStatus;
    to: ContractStatus;
    actorId: string;
    at: Date;
    milestone: "sealed" | "effective" | "archived" | "expired";
    note?: string | null;
  },
): Promise<boolean> {
  assertTransition("Contract", CONTRACT_TRANSITIONS, input.from, input.to);
  const moved = await db.contract.updateMany({
    where: { id: input.contractId, status: input.from, deletedAt: null },
    data: { status: input.to, updatedBy: input.actorId },
  });
  if (moved.count === 0) {
    return false;
  }
  await db.contractMilestone.create({
    data: {
      contractId: input.contractId,
      kind: input.milestone,
      at: input.at,
      note: input.note ?? null,
      operatorId: input.actorId,
      createdBy: input.actorId,
    },
  });
  return true;
}

async function notifyUsers(
  db: LifecycleDb,
  userIds: string[],
  message: { kind: string; title: string; body: string; link: string },
): Promise<void> {
  const unique = [...new Set(userIds)].filter((id) => id !== "");
  if (unique.length === 0) {
    return;
  }
  await db.notification.createMany({
    data: unique.map((userId) => ({ userId, ...message })),
  });
}

async function assertSealScope(access: AccessContext, contractId: string): Promise<void> {
  const scope = await buildContractScope(access);
  const inScope = await prisma.contract.count({
    where: { AND: [{ id: contractId, deletedAt: null }, scope] },
  });
  if (inScope === 0) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "无权处理该合同的用印");
  }
}

export async function pickSealRecord(
  access: AccessContext,
  id: string,
  now: Date = new Date(),
): Promise<{ id: string; contractId: string; contractStatus: ContractStatus }> {
  await requirePermission(access.userId, "contract.seal");
  const record = await loadSealRecord(prisma, id);
  await assertSealScope(access, record.contractId);

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.sealRecord.updateMany({
      where: { id, pickedAt: null, deletedAt: null },
      data: { pickedAt: now, updatedBy: access.userId },
    });
    if (claimed.count === 0) {
      throw new AppError(ERROR_CODES.CONFLICT, "该用印申请已登记取件");
    }

    const moved =
      record.contract.status === "to_seal"
        ? await moveContract(tx, {
            contractId: record.contractId,
            from: "to_seal",
            to: "sealed",
            actorId: access.userId,
            at: now,
            milestone: "sealed",
          })
        : false;

    const contract = await tx.contract.findUniqueOrThrow({
      where: { id: record.contractId },
      select: { status: true, no: true },
    });

    await notifyUsers(
      tx,
      [record.applicantId],
      {
        kind: "seal",
        title: "印章已取件",
        body: `合同 ${contract.no} 的${SEAL_TYPE_LABELS[record.sealType as SealType]}已取件${moved ? "，合同进入已用印" : ""}`,
        link: `/contracts/${record.contractId}`,
      },
    );

    await recordAudit(tx, {
      actorId: access.userId,
      action: "seal.pick",
      entity: "SealRecord",
      entityId: id,
      before: { pickedAt: null, contractStatus: record.contract.status },
      after: { pickedAt: now.toISOString(), contractStatus: contract.status },
    });

    return { id, contractId: record.contractId, contractStatus: contract.status as ContractStatus };
  });
}

export async function returnSealRecord(
  access: AccessContext,
  input: { id: string; notaryNo?: string },
  now: Date = new Date(),
): Promise<{ id: string; contractId: string; contractStatus: ContractStatus }> {
  await requirePermission(access.userId, "contract.seal");
  const record = await loadSealRecord(prisma, input.id);
  await assertSealScope(access, record.contractId);

  if (record.pickedAt === null) {
    throw new AppError(ERROR_CODES.CONFLICT, "请先登记取件");
  }

  const notaryNo = (input.notaryNo ?? "").trim();
  if (notaryNo.length > 40) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, "用印编号不能超过 40 字");
  }

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.sealRecord.updateMany({
      where: { id: input.id, pickedAt: record.pickedAt, returnedAt: null, deletedAt: null },
      data: { returnedAt: now, notaryNo: notaryNo === "" ? null : notaryNo, updatedBy: access.userId },
    });
    if (claimed.count === 0) {
      throw new AppError(ERROR_CODES.CONFLICT, "该用印申请已登记归还");
    }

    const moved =
      record.contract.status === "sealed"
        ? await moveContract(tx, {
            contractId: record.contractId,
            from: "sealed",
            to: "active",
            actorId: access.userId,
            at: now,
            milestone: "effective",
          })
        : false;

    const contract = await tx.contract.findUniqueOrThrow({
      where: { id: record.contractId },
      select: { status: true, no: true },
    });

    await notifyUsers(
      tx,
      [record.applicantId],
      {
        kind: "seal",
        title: "印章已归还",
        body: `合同 ${contract.no} 用印完成并归还${moved ? "，合同已生效" : ""}`,
        link: `/contracts/${record.contractId}`,
      },
    );

    await recordAudit(tx, {
      actorId: access.userId,
      action: "seal.return",
      entity: "SealRecord",
      entityId: input.id,
      before: { returnedAt: null, contractStatus: record.contract.status },
      after: {
        returnedAt: now.toISOString(),
        notaryNo: notaryNo === "" ? null : notaryNo,
        contractStatus: contract.status,
      },
    });

    return { id: input.id, contractId: record.contractId, contractStatus: contract.status as ContractStatus };
  });
}

export type ArchiveRow = {
  id: string;
  no: string;
  title: string;
  amount: string;
  status: ContractStatus;
  endDate: Date;
  sealedAt: Date | null;
  effectiveAt: Date | null;
  archivedAt: Date | null;
};

export type ArchiveList = {
  rows: ArchiveRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  pendingTotal: number;
  archivedTotal: number;
};

const ARCHIVE_SELECT = {
  id: true,
  no: true,
  title: true,
  amount: true,
  status: true,
  endDate: true,
  milestones: { select: { kind: true, at: true } },
} satisfies Prisma.ContractSelect;

function toArchiveRow(
  row: Prisma.ContractGetPayload<{ select: typeof ARCHIVE_SELECT }>,
): ArchiveRow {
  const at = (kind: string): Date | null =>
    row.milestones.filter((milestone) => milestone.kind === kind).at(-1)?.at ?? null;
  return {
    id: row.id,
    no: row.no,
    title: row.title,
    amount: row.amount.toFixed(2),
    status: row.status as ContractStatus,
    endDate: row.endDate,
    sealedAt: at("sealed"),
    effectiveAt: at("effective"),
    archivedAt: at("archived"),
  };
}

export async function listArchive(
  access: AccessContext,
  input: { page: number; pageSize: number; tab: "pending" | "archived"; q: string },
): Promise<ArchiveList> {
  const scope = await buildContractScope(access);
  const keyword = input.q.trim();
  const statusFilter: Prisma.ContractWhereInput =
    input.tab === "archived"
      ? { status: "archived" }
      : { status: { in: [...ARCHIVABLE_CONTRACT_STATUSES] } };

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

  const where: Prisma.ContractWhereInput = {
    deletedAt: null,
    AND: [scope, statusFilter, ...keywordFilter],
  };

  const [rows, total, pendingTotal, archivedTotal] = await Promise.all([
    prisma.contract.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: ARCHIVE_SELECT,
    }),
    prisma.contract.count({ where }),
    prisma.contract.count({
      where: { AND: [scope, { deletedAt: null, status: { in: [...ARCHIVABLE_CONTRACT_STATUSES] } }] },
    }),
    prisma.contract.count({
      where: { AND: [scope, { deletedAt: null, status: "archived" }] },
    }),
  ]);

  return {
    rows: rows.map(toArchiveRow),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
    pendingTotal,
    archivedTotal,
  };
}

export async function archiveContract(
  access: AccessContext,
  contractId: string,
  note?: string,
  now: Date = new Date(),
): Promise<{ id: string }> {
  await requirePermission(access.userId, "contract.archive");
  const scope = await buildContractScope(access);
  const contract = await prisma.contract.findFirst({
    where: { AND: [{ id: contractId, deletedAt: null }, scope] },
    select: { id: true, status: true, no: true, createdBy: true },
  });
  if (!contract) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "无权归档该合同或合同不存在");
  }
  if (contract.status === "archived") {
    throw new AppError(ERROR_CODES.CONFLICT, "合同已归档");
  }
  if (!ARCHIVABLE_CONTRACT_STATUSES.includes(contract.status as ContractStatus)) {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      `当前状态「${contract.status}」不能归档，需先进入履行、变更、到期或终止`,
    );
  }

  const trimmed = (note ?? "").trim();
  if (trimmed.length > 200) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, "归档备注不能超过 200 字");
  }

  return prisma.$transaction(async (tx) => {
    const moved = await moveContract(tx, {
      contractId,
      from: contract.status as ContractStatus,
      to: "archived",
      actorId: access.userId,
      at: now,
      milestone: "archived",
      note: trimmed === "" ? null : trimmed,
    });
    if (!moved) {
      throw new AppError(ERROR_CODES.CONFLICT, "合同状态已变更，请刷新后重试");
    }

    await notifyUsers(
      tx,
      [contract.createdBy],
      {
        kind: "archive",
        title: "合同已归档",
        body: `合同 ${contract.no} 已归档，归档后不可再编辑`,
        link: `/contracts/${contractId}`,
      },
    );

    await recordAudit(tx, {
      actorId: access.userId,
      action: "contract.archive",
      entity: "Contract",
      entityId: contractId,
      before: { status: contract.status },
      after: { status: "archived", note: trimmed === "" ? null : trimmed },
    });

    return { id: contractId };
  });
}

export type ExpiryResult = { scanned: number; warned: number; expired: number };

export function parseWarningDays(raw: string | undefined): number[] {
  const days = (raw ?? "30,7")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0 && item <= 365);
  return [...new Set(days)].sort((a, b) => b - a);
}

export async function processContractExpiry(
  db: LifecycleDb,
  input: { now: Date; warningDays?: string; limit?: number },
): Promise<ExpiryResult> {
  const thresholds = parseWarningDays(input.warningDays);
  const horizon = thresholds.length > 0 ? thresholds[0] as number : 0;
  const limit = input.limit ?? 200;

  const [due, upcoming] = await Promise.all([
    db.contract.findMany({
      where: { deletedAt: null, status: "active", endDate: { lt: input.now } },
      orderBy: { endDate: "asc" },
      take: limit,
      select: { id: true, no: true, endDate: true, createdBy: true, ownerDepartmentId: true },
    }),
    thresholds.length === 0
      ? Promise.resolve([])
      : db.contract.findMany({
          where: {
            deletedAt: null,
            status: "active",
            endDate: { gte: input.now, lte: addDays(input.now, horizon) },
          },
          orderBy: { endDate: "asc" },
          take: limit,
          select: { id: true, no: true, endDate: true, createdBy: true, ownerDepartmentId: true },
        }),
  ]);

  let warned = 0;
  let expired = 0;

  for (const contract of due) {
    const claimed = await claimOnce(db, {
      key: `contract_expired:${contract.id}:${contract.endDate.toISOString()}`,
      scope: "contract_expiry",
      response: { contractId: contract.id, action: "expire" },
    });
    if (!claimed) {
      continue;
    }

    const moved = await moveContract(db, {
      contractId: contract.id,
      from: "active",
      to: "expired",
      actorId: SYSTEM_ACTOR,
      at: input.now,
      milestone: "expired",
    });
    if (!moved) {
      continue;
    }
    const recipients = await notifyRecipients(db, contract);
    await notifyUsers(
      db,
      recipients,
      {
        kind: "expiry",
        title: "合同已到期",
        body: `合同 ${contract.no} 已于 ${contract.endDate.toISOString().slice(0, 10)} 到期，可发起归档`,
        link: `/contracts/${contract.id}`,
      },
    );
    expired += 1;
  }

  for (const contract of upcoming) {
    for (const days of thresholds) {
      const triggerAt = addDays(contract.endDate, -days);
      if (input.now < triggerAt) {
        continue;
      }
      const claimed = await claimOnce(db, {
        key: `expiry_warning:${contract.id}:${contract.endDate.toISOString()}:${days}`,
        scope: "contract_expiry",
        response: { contractId: contract.id, days },
      });
      if (!claimed) {
        continue;
      }

      await db.contractMilestone.create({
        data: {
          contractId: contract.id,
          kind: "expiry_warning",
          at: input.now,
          note: `距到期还有 ${Math.max(0, days)} 天窗口`,
          operatorId: SYSTEM_ACTOR,
        },
      });
      const recipients = await notifyRecipients(db, contract);
      await notifyUsers(
        db,
        recipients,
        {
          kind: "expiry",
          title: "合同即将到期",
          body: `合同 ${contract.no} 将在 ${contract.endDate.toISOString().slice(0, 10)} 到期`,
          link: `/contracts/${contract.id}`,
        },
      );
      warned += 1;
    }
  }

  return { scanned: due.length + upcoming.length, warned, expired };
}

async function notifyRecipients(
  db: LifecycleDb,
  contract: { createdBy: string; ownerDepartmentId: string | null },
): Promise<string[]> {
  const ids = [contract.createdBy];
  if (contract.ownerDepartmentId) {
    const department = await db.department.findFirst({
      where: { id: contract.ownerDepartmentId, deletedAt: null },
      select: { managerUserId: true },
    });
    if (department?.managerUserId) {
      ids.push(department.managerUserId);
    }
  }
  return ids;
}

export type LifecycleView = {
  sealRecords: SealRow[];
  milestones: { kind: string; at: Date; note: string | null; operatorName: string | null }[];
};

export async function getContractLifecycle(contractId: string): Promise<LifecycleView> {
  const [sealRecords, milestones] = await Promise.all([
    prisma.sealRecord.findMany({
      where: { contractId, deletedAt: null },
      orderBy: { appliedAt: "asc" },
      select: SEAL_SELECT,
    }),
    prisma.contractMilestone.findMany({
      where: { contractId, deletedAt: null },
      orderBy: { at: "asc" },
      select: { kind: true, at: true, note: true, operatorId: true },
    }),
  ]);

  const names = await resolveNames(
    milestones.map((milestone) => milestone.operatorId).filter((id): id is string => id !== null),
  );

  return {
    sealRecords: await toSealRows(sealRecords),
    milestones: milestones.map((milestone) => ({
      kind: milestone.kind,
      at: milestone.at,
      note: milestone.note,
      operatorName:
        milestone.operatorId === null ? null : (names.get(milestone.operatorId) ?? "已删除用户"),
    })),
  };
}
