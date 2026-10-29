import type { AccessContext } from "@/server/auth/access";
import { recordAudit } from "@/server/audit";
import { prisma } from "@/server/db/client";
import { parseShanghaiDate } from "@/shared/datetime";
import { AppError, ERROR_CODES, ValidationError } from "@/shared/errors";
import type { DelegateFormInput } from "@/shared/schemas/delegate";

export type DelegateParty = {
  id: string;
  name: string;
  email: string;
  departmentName: string | null;
};

export type DelegateItem = {
  id: string;
  from: DelegateParty;
  to: DelegateParty;
  permissionKeys: string[];
  startAt: Date;
  endAt: Date;
  reason: string;
  state: "upcoming" | "active" | "expired";
  createdAt: Date;
};

const partySelect = {
  id: true,
  name: true,
  email: true,
  department: { select: { name: true } },
} as const;

function toParty(user: {
  id: string;
  name: string;
  email: string;
  department: { name: string } | null;
}): DelegateParty {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    departmentName: user.department?.name ?? null,
  };
}

function stateOf(startAt: Date, endAt: Date, now: Date): DelegateItem["state"] {
  if (endAt.getTime() < now.getTime()) {
    return "expired";
  }
  if (startAt.getTime() > now.getTime()) {
    return "upcoming";
  }
  return "active";
}

export async function listDelegates(
  access: AccessContext,
  now: Date = new Date(),
): Promise<DelegateItem[]> {
  const canManageAll = access.permissions.has("system.user.manage");
  const rows = await prisma.delegate.findMany({
    where: {
      deletedAt: null,
      ...(canManageAll ? {} : { OR: [{ fromUserId: access.userId }, { toUserId: access.userId }] }),
    },
    orderBy: { startAt: "desc" },
    select: {
      id: true,
      permissionKeys: true,
      startAt: true,
      endAt: true,
      reason: true,
      createdAt: true,
      fromUser: { select: partySelect },
      toUser: { select: partySelect },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    from: toParty(row.fromUser),
    to: toParty(row.toUser),
    permissionKeys: row.permissionKeys,
    startAt: row.startAt,
    endAt: row.endAt,
    reason: row.reason,
    state: stateOf(row.startAt, row.endAt, now),
    createdAt: row.createdAt,
  }));
}

async function assertActiveUser(userId: string, label: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, status: "active" },
    select: { id: true },
  });
  if (!user) {
    throw new ValidationError(`${label}不存在或已停用`, { toUserId: `${label}不可用` });
  }
}

export async function saveDelegate(
  access: AccessContext,
  input: DelegateFormInput,
): Promise<{ id: string }> {
  const isSelf = input.fromUserId === access.userId;
  if (!isSelf && !access.permissions.has("system.user.manage")) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "只能为本人设置审批委托");
  }

  await Promise.all([
    assertActiveUser(input.fromUserId, "委托人"),
    assertActiveUser(input.toUserId, "受托人"),
  ]);

  const startAt = parseShanghaiDate(input.startDate, false);
  const endAt = parseShanghaiDate(input.endDate, true);
  if (endAt.getTime() <= Date.now()) {
    throw new ValidationError("委托结束时间必须晚于当前时间", {
      endDate: "委托期已过期",
    });
  }

  const overlapping = await prisma.delegate.findFirst({
    where: {
      deletedAt: null,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      id: input.id ? { not: input.id } : undefined,
      startAt: { lte: endAt },
      endAt: { gte: startAt },
    },
    select: { id: true },
  });
  if (overlapping) {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      "同一对委托/受托人在该时间段内已有委托，请调整日期",
    );
  }

  const data = {
    fromUserId: input.fromUserId,
    toUserId: input.toUserId,
    permissionKeys: input.permissionKeys,
    startAt,
    endAt,
    reason: input.reason,
  };

  if (input.id) {
    const current = await prisma.delegate.findFirst({
      where: { id: input.id, deletedAt: null },
      select: { id: true, fromUserId: true, toUserId: true, startAt: true, endAt: true },
    });
    if (!current) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "委托记录不存在");
    }
    if (!isSelf && current.fromUserId !== access.userId) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "只能修改本人的委托");
    }

    const updated = await prisma.delegate.update({
      where: { id: input.id },
      data: { ...data, updatedBy: access.userId },
      select: { id: true },
    });
    await recordAudit(prisma, {
      actorId: access.userId,
      action: "delegate.update",
      entity: "Delegate",
      entityId: updated.id,
      before: {
        fromUserId: current.fromUserId,
        toUserId: current.toUserId,
        startAt: current.startAt.toISOString(),
        endAt: current.endAt.toISOString(),
      },
      after: {
        fromUserId: data.fromUserId,
        toUserId: data.toUserId,
        startAt: data.startAt.toISOString(),
        endAt: data.endAt.toISOString(),
      },
    });
    return updated;
  }

  const created = await prisma.delegate.create({
    data: { ...data, createdBy: access.userId },
    select: { id: true },
  });
  await recordAudit(prisma, {
    actorId: access.userId,
    action: "delegate.create",
    entity: "Delegate",
    entityId: created.id,
    after: {
      fromUserId: data.fromUserId,
      toUserId: data.toUserId,
      permissionKeys: data.permissionKeys,
      startAt: data.startAt.toISOString(),
      endAt: data.endAt.toISOString(),
    },
  });
  return created;
}

export async function deleteDelegate(
  access: AccessContext,
  id: string,
): Promise<{ id: string }> {
  const current = await prisma.delegate.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, fromUserId: true },
  });
  if (!current) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "委托记录不存在");
  }
  if (current.fromUserId !== access.userId && !access.permissions.has("system.user.manage")) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "只能删除本人的委托");
  }

  await prisma.delegate.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: access.userId },
  });
  await recordAudit(prisma, {
    actorId: access.userId,
    action: "delegate.delete",
    entity: "Delegate",
    entityId: id,
    before: { fromUserId: current.fromUserId },
    after: { deleted: true },
  });
  return { id };
}
