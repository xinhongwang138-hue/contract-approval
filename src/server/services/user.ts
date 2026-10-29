import { AppError, ERROR_CODES } from "@/shared/errors";
import type {
  UserCreateInput,
  UserUpdateInput,
} from "@/shared/schemas/user";
import { recordAudit } from "@/server/audit";
import { hashPassword } from "@/server/auth/password";
import { prisma } from "@/server/db/client";

export const USERS_PAGE_SIZE = 20;

export type UserListItem = {
  id: string;
  name: string;
  email: string;
  status: "active" | "disabled";
  department: { id: string; name: string } | null;
  manager: { id: string; name: string } | null;
  roles: { id: string; key: string; name: string }[];
  createdAt: Date;
};

export type UserListResult = {
  items: UserListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export async function listUsers(params: {
  search?: string;
  departmentId?: string;
  status?: "active" | "disabled";
  page: number;
}): Promise<UserListResult> {
  const where = {
    deletedAt: null,
    ...(params.departmentId ? { departmentId: params.departmentId } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.search
      ? {
          OR: [
            { name: { contains: params.search, mode: "insensitive" as const } },
            { email: { contains: params.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * USERS_PAGE_SIZE,
      take: USERS_PAGE_SIZE,
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        createdAt: true,
        department: { select: { id: true, name: true } },
        manager: { select: { id: true, name: true } },
        userRoles: {
          where: { deletedAt: null, role: { deletedAt: null } },
          select: { role: { select: { id: true, key: true, name: true } } },
        },
      },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      status: row.status,
      department: row.department,
      manager: row.manager,
      roles: row.userRoles.map((userRole) => userRole.role),
      createdAt: row.createdAt,
    })),
    total,
    page: params.page,
    pageSize: USERS_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / USERS_PAGE_SIZE)),
  };
}

export async function listRoleOptions(): Promise<
  { id: string; key: string; name: string; isSystem: boolean }[]
> {
  return prisma.role.findMany({
    where: { deletedAt: null },
    select: { id: true, key: true, name: true, isSystem: true },
    orderBy: [{ isSystem: "desc" }, { key: "asc" }],
  });
}

async function assertDepartment(departmentId: string): Promise<void> {
  const department = await prisma.department.findFirst({
    where: { id: departmentId, deletedAt: null },
    select: { id: true },
  });
  if (!department) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, "所选部门不存在");
  }
}

async function assertManager(managerUserId: string, userId?: string): Promise<void> {
  if (userId && managerUserId === userId) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, "直属上级不能是本人");
  }
  const manager = await prisma.user.findFirst({
    where: { id: managerUserId, deletedAt: null, status: "active" },
    select: { id: true },
  });
  if (!manager) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, "直属上级必须是启用状态的用户");
  }
}

async function resolveRoles(roleIds: string[]): Promise<
  { id: string; key: string; name: string }[]
> {
  const uniqueIds = [...new Set(roleIds)];
  const roles = await prisma.role.findMany({
    where: { id: { in: uniqueIds }, deletedAt: null },
    select: { id: true, key: true, name: true },
  });
  if (roles.length !== uniqueIds.length) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, "包含无效的角色");
  }
  return roles;
}

export async function createUser(
  input: UserCreateInput,
  actorId: string,
): Promise<{ id: string }> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) {
    throw new AppError(ERROR_CODES.CONFLICT, "该邮箱已被使用");
  }

  if (input.departmentId) {
    await assertDepartment(input.departmentId);
  }
  if (input.managerUserId) {
    await assertManager(input.managerUserId);
  }
  const roles = await resolveRoles(input.roleIds);
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        emailVerified: true,
        departmentId: input.departmentId ?? null,
        managerUserId: input.managerUserId ?? null,
        status: input.status,
        createdBy: actorId,
        updatedBy: actorId,
      },
      select: { id: true, name: true, email: true },
    });

    await tx.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: passwordHash,
      },
    });

    await tx.userRole.createMany({
      data: roles.map((role) => ({
        userId: user.id,
        roleId: role.id,
        createdBy: actorId,
        updatedBy: actorId,
      })),
    });

    await recordAudit(tx, {
      actorId,
      action: "user.create",
      entity: "User",
      entityId: user.id,
      after: {
        name: user.name,
        email: user.email,
        departmentId: input.departmentId ?? null,
        managerUserId: input.managerUserId ?? null,
        status: input.status,
        roles: roles.map((role) => role.key),
      },
    });

    return { id: user.id };
  });
}

export async function updateUser(
  input: UserUpdateInput,
  actorId: string,
): Promise<{ id: string }> {
  const current = await prisma.user.findFirst({
    where: { id: input.id, deletedAt: null },
    select: {
      id: true,
      name: true,
      departmentId: true,
      managerUserId: true,
      status: true,
      userRoles: {
        where: { deletedAt: null, role: { deletedAt: null } },
        select: { role: { select: { id: true, key: true } } },
      },
    },
  });
  if (!current) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "用户不存在");
  }

  if (input.departmentId) {
    await assertDepartment(input.departmentId);
  }
  if (input.managerUserId) {
    await assertManager(input.managerUserId, input.id);
  }
  const roles = await resolveRoles(input.roleIds);

  if (input.id === actorId && input.status === "disabled") {
    throw new AppError(ERROR_CODES.CONFLICT, "不能停用当前登录账号");
  }

  const currentRoleKeys = current.userRoles.map((userRole) => userRole.role.key);
  const nextRoleKeys = roles.map((role) => role.key);
  if (
    input.id === actorId &&
    currentRoleKeys.includes("admin") &&
    !nextRoleKeys.includes("admin")
  ) {
    throw new AppError(ERROR_CODES.CONFLICT, "不能移除自己的管理员角色");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: input.id },
      data: {
        name: input.name,
        departmentId: input.departmentId ?? null,
        managerUserId: input.managerUserId ?? null,
        status: input.status,
        updatedBy: actorId,
      },
      select: {
        id: true,
        name: true,
        departmentId: true,
        managerUserId: true,
        status: true,
      },
    });

    await tx.userRole.updateMany({
      where: { userId: input.id, roleId: { notIn: roles.map((role) => role.id) } },
      data: { deletedAt: new Date(), updatedBy: actorId },
    });

    for (const role of roles) {
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: input.id, roleId: role.id } },
        update: { deletedAt: null, updatedBy: actorId },
        create: {
          userId: input.id,
          roleId: role.id,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
    }

    if (input.status === "disabled") {
      await tx.session.deleteMany({ where: { userId: input.id } });
    }

    await recordAudit(tx, {
      actorId,
      action: "user.update",
      entity: "User",
      entityId: input.id,
      before: {
        name: current.name,
        departmentId: current.departmentId,
        managerUserId: current.managerUserId,
        status: current.status,
        roles: currentRoleKeys,
      },
      after: {
        ...updated,
        roles: nextRoleKeys,
      },
    });

    return { id: updated.id };
  });
}

export async function deleteUser(
  userId: string,
  actorId: string,
): Promise<{ id: string }> {
  if (userId === actorId) {
    throw new AppError(ERROR_CODES.CONFLICT, "不能删除当前登录账号");
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, name: true, email: true },
  });
  if (!user) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "用户不存在");
  }

  const pendingTasks = await prisma.flowTask.count({
    where: { assigneeId: userId, status: "pending", deletedAt: null },
  });
  if (pendingTasks > 0) {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      `该用户还有 ${pendingTasks} 条待处理审批任务，请先转签后再删除`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { deletedAt: new Date(), status: "disabled", updatedBy: actorId },
    });
    await tx.session.deleteMany({ where: { userId } });
    await tx.userRole.updateMany({
      where: { userId, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: actorId },
    });
    await recordAudit(tx, {
      actorId,
      action: "user.delete",
      entity: "User",
      entityId: userId,
      before: { name: user.name, email: user.email },
    });
  });

  return { id: userId };
}

export async function resetUserPassword(
  userId: string,
  password: string,
  actorId: string,
): Promise<{ id: string }> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, email: true },
  });
  if (!user) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "用户不存在");
  }

  const passwordHash = await hashPassword(password);

  await prisma.$transaction(async (tx) => {
    await tx.account.upsert({
      where: {
        providerId_accountId: { providerId: "credential", accountId: userId },
      },
      update: { password: passwordHash },
      create: {
        userId,
        accountId: userId,
        providerId: "credential",
        password: passwordHash,
      },
    });
    await tx.session.deleteMany({ where: { userId } });
    await recordAudit(tx, {
      actorId,
      action: "user.reset_password",
      entity: "User",
      entityId: userId,
      after: { email: user.email, sessionsRevoked: true },
    });
  });

  return { id: userId };
}
