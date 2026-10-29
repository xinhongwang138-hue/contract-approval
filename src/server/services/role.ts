import type { DataScopeType } from "@/generated/prisma/enums";
import { AppError, ERROR_CODES } from "@/shared/errors";
import type { PermissionKey } from "@/shared/permissions";
import type {
  RoleCreateInput,
  RoleUpdateInput,
} from "@/shared/schemas/role";
import { recordAudit } from "@/server/audit";
import { prisma } from "@/server/db/client";

export type RoleListItem = {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
  scope: DataScopeType;
  departmentId: string | null;
  departmentName: string | null;
  permissionKeys: PermissionKey[];
  userCount: number;
};

export async function listRoles(): Promise<RoleListItem[]> {
  const [roles, userCounts] = await Promise.all([
    prisma.role.findMany({
      where: { deletedAt: null },
      orderBy: [{ isSystem: "desc" }, { key: "asc" }],
      select: {
        id: true,
        key: true,
        name: true,
        isSystem: true,
        rolePermissions: {
          where: { deletedAt: null, permission: { deletedAt: null } },
          select: { permission: { select: { key: true } } },
        },
        dataScope: {
          select: {
            scope: true,
            departmentId: true,
            deletedAt: true,
            department: { select: { name: true } },
          },
        },
      },
    }),
    prisma.userRole.groupBy({
      by: ["roleId"],
      where: { deletedAt: null, user: { deletedAt: null } },
      _count: { _all: true },
    }),
  ]);

  const counts = new Map<string, number>();
  for (const row of userCounts) {
    counts.set(row.roleId, row._count._all);
  }

  return roles.map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    isSystem: role.isSystem,
    scope:
      role.dataScope && !role.dataScope.deletedAt
        ? role.dataScope.scope
        : "self",
    departmentId:
      role.dataScope && !role.dataScope.deletedAt
        ? role.dataScope.departmentId
        : null,
    departmentName:
      role.dataScope && !role.dataScope.deletedAt
        ? (role.dataScope.department?.name ?? null)
        : null,
    permissionKeys: role.rolePermissions.map(
      (rolePermission) => rolePermission.permission.key as PermissionKey,
    ),
    userCount: counts.get(role.id) ?? 0,
  }));
}

async function assertDepartment(departmentId: string): Promise<void> {
  const department = await prisma.department.findFirst({
    where: { id: departmentId, deletedAt: null },
    select: { id: true },
  });
  if (!department) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, "所选数据范围部门不存在");
  }
}

function normalizeDepartmentId(
  scope: DataScopeType,
  departmentId: string | null | undefined,
): string | null {
  if (scope === "all" || scope === "self") {
    return null;
  }
  return departmentId ?? null;
}

export async function createRole(
  input: RoleCreateInput,
  actorId: string,
): Promise<{ id: string }> {
  const existing = await prisma.role.findUnique({
    where: { key: input.key },
    select: { id: true },
  });
  if (existing) {
    throw new AppError(ERROR_CODES.CONFLICT, "角色标识已存在");
  }

  const departmentId = normalizeDepartmentId(input.scope, input.departmentId);
  if (departmentId) {
    await assertDepartment(departmentId);
  }

  return prisma.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: {
        key: input.key,
        name: input.name,
        isSystem: false,
        createdBy: actorId,
        updatedBy: actorId,
      },
      select: { id: true, key: true, name: true },
    });

    const permissions = await tx.permission.findMany({
      where: { key: { in: input.permissionKeys }, deletedAt: null },
      select: { id: true },
    });
    if (permissions.length !== new Set(input.permissionKeys).size) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "包含无效的权限项");
    }

    await tx.rolePermission.createMany({
      data: permissions.map((permission) => ({
        roleId: role.id,
        permissionId: permission.id,
        createdBy: actorId,
        updatedBy: actorId,
      })),
    });

    await tx.dataScope.create({
      data: {
        roleId: role.id,
        scope: input.scope,
        departmentId,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });

    await recordAudit(tx, {
      actorId,
      action: "role.create",
      entity: "Role",
      entityId: role.id,
      after: {
        key: role.key,
        name: role.name,
        scope: input.scope,
        departmentId,
        permissions: input.permissionKeys,
      },
    });

    return { id: role.id };
  });
}

export async function updateRole(
  input: RoleUpdateInput,
  actorId: string,
): Promise<{ id: string }> {
  const current = await prisma.role.findFirst({
    where: { id: input.id, deletedAt: null },
    select: {
      id: true,
      key: true,
      name: true,
      isSystem: true,
      rolePermissions: {
        where: { deletedAt: null, permission: { deletedAt: null } },
        select: { permission: { select: { key: true } } },
      },
      dataScope: { select: { scope: true, departmentId: true } },
    },
  });
  if (!current) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "角色不存在");
  }
  if (current.isSystem) {
    throw new AppError(ERROR_CODES.CONFLICT, "系统角色不可修改");
  }

  const departmentId = normalizeDepartmentId(input.scope, input.departmentId);
  if (departmentId) {
    await assertDepartment(departmentId);
  }

  return prisma.$transaction(async (tx) => {
    const role = await tx.role.update({
      where: { id: input.id },
      data: { name: input.name, updatedBy: actorId },
      select: { id: true, name: true },
    });

    const permissions = await tx.permission.findMany({
      where: { key: { in: input.permissionKeys }, deletedAt: null },
      select: { id: true },
    });
    if (permissions.length !== new Set(input.permissionKeys).size) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "包含无效的权限项");
    }

    await tx.rolePermission.updateMany({
      where: { roleId: input.id },
      data: { deletedAt: new Date(), updatedBy: actorId },
    });
    for (const permission of permissions) {
      await tx.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: input.id,
            permissionId: permission.id,
          },
        },
        update: { deletedAt: null, updatedBy: actorId },
        create: {
          roleId: input.id,
          permissionId: permission.id,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
    }

    await tx.dataScope.upsert({
      where: { roleId: input.id },
      update: {
        scope: input.scope,
        departmentId,
        deletedAt: null,
        updatedBy: actorId,
      },
      create: {
        roleId: input.id,
        scope: input.scope,
        departmentId,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });

    await recordAudit(tx, {
      actorId,
      action: "role.update",
      entity: "Role",
      entityId: input.id,
      before: {
        name: current.name,
        scope: current.dataScope?.scope ?? null,
        departmentId: current.dataScope?.departmentId ?? null,
        permissions: current.rolePermissions.map(
          (rolePermission) => rolePermission.permission.key,
        ),
      },
      after: {
        name: role.name,
        scope: input.scope,
        departmentId,
        permissions: input.permissionKeys,
      },
    });

    return { id: role.id };
  });
}

export async function deleteRole(
  id: string,
  actorId: string,
): Promise<{ id: string }> {
  const role = await prisma.role.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, key: true, name: true, isSystem: true },
  });
  if (!role) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "角色不存在");
  }
  if (role.isSystem) {
    throw new AppError(ERROR_CODES.CONFLICT, "系统角色不可删除");
  }

  const assigned = await prisma.userRole.count({
    where: { roleId: id, deletedAt: null, user: { deletedAt: null } },
  });
  if (assigned > 0) {
    throw new AppError(ERROR_CODES.CONFLICT, "仍有用户使用该角色，无法删除");
  }

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.role.update({
      where: { id },
      data: { deletedAt: now, updatedBy: actorId },
    });
    await tx.rolePermission.updateMany({
      where: { roleId: id },
      data: { deletedAt: now, updatedBy: actorId },
    });
    await tx.dataScope.updateMany({
      where: { roleId: id },
      data: { deletedAt: now, updatedBy: actorId },
    });
    await recordAudit(tx, {
      actorId,
      action: "role.delete",
      entity: "Role",
      entityId: id,
      before: { key: role.key, name: role.name },
    });
  });

  return { id };
}
