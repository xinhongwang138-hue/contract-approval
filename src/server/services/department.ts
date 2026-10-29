import { randomUUID } from "node:crypto";
import { AppError, ERROR_CODES } from "@/shared/errors";
import type {
  DepartmentFormInput,
  DepartmentUpdateInput,
} from "@/shared/schemas/department";
import { recordAudit } from "@/server/audit";
import { prisma } from "@/server/db/client";

export type DepartmentTreeNode = {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  sortOrder: number;
  manager: { id: string; name: string } | null;
  userCount: number;
  children: DepartmentTreeNode[];
};

export type DepartmentOption = {
  id: string;
  name: string;
  level: number;
};

export async function listDepartmentTree(): Promise<DepartmentTreeNode[]> {
  const [departments, userCounts] = await Promise.all([
    prisma.department.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        parentId: true,
        path: true,
        sortOrder: true,
        manager: { select: { id: true, name: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.user.groupBy({
      by: ["departmentId"],
      where: { deletedAt: null, departmentId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const countByDepartment = new Map<string, number>();
  for (const row of userCounts) {
    if (row.departmentId) {
      countByDepartment.set(row.departmentId, row._count._all);
    }
  }

  const nodes = new Map<string, DepartmentTreeNode>();
  for (const department of departments) {
    nodes.set(department.id, {
      id: department.id,
      name: department.name,
      parentId: department.parentId,
      path: department.path,
      sortOrder: department.sortOrder,
      manager: department.manager,
      userCount: countByDepartment.get(department.id) ?? 0,
      children: [],
    });
  }

  const roots: DepartmentTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRecursively = (list: DepartmentTreeNode[]): void => {
    list.sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-CN"),
    );
    for (const node of list) {
      sortRecursively(node.children);
    }
  };
  sortRecursively(roots);

  return roots;
}

export function flattenDepartmentTree(
  tree: DepartmentTreeNode[],
  level = 0,
): DepartmentOption[] {
  return tree.flatMap((node) => [
    { id: node.id, name: node.name, level },
    ...flattenDepartmentTree(node.children, level + 1),
  ]);
}

export async function listDepartmentOptions(): Promise<DepartmentOption[]> {
  return flattenDepartmentTree(await listDepartmentTree());
}

async function assertActiveUser(userId: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, status: "active" },
    select: { id: true },
  });
  if (!user) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, "部门主管必须是启用状态的用户");
  }
}

export async function createDepartment(
  input: DepartmentFormInput,
  actorId: string,
): Promise<{ id: string }> {
  if (input.managerUserId) {
    await assertActiveUser(input.managerUserId);
  }

  return prisma.$transaction(async (tx) => {
    let parentPath: string | null = null;
    if (input.parentId) {
      const parent = await tx.department.findFirst({
        where: { id: input.parentId, deletedAt: null },
        select: { id: true, path: true },
      });
      if (!parent) {
        throw new AppError(ERROR_CODES.NOT_FOUND, "上级部门不存在");
      }
      parentPath = parent.path;
    }

    const created = await tx.department.create({
      data: {
        name: input.name,
        parentId: input.parentId ?? null,
        managerUserId: input.managerUserId ?? null,
        sortOrder: input.sortOrder,
        path: `${parentPath ?? ""}/${randomUUID()}`,
        createdBy: actorId,
        updatedBy: actorId,
      },
      select: { id: true, name: true, path: true, parentId: true },
    });

    await recordAudit(tx, {
      actorId,
      action: "department.create",
      entity: "Department",
      entityId: created.id,
      after: created,
    });

    return { id: created.id };
  });
}

export async function updateDepartment(
  input: DepartmentUpdateInput,
  actorId: string,
): Promise<{ id: string }> {
  const current = await prisma.department.findFirst({
    where: { id: input.id, deletedAt: null },
    select: {
      id: true,
      name: true,
      parentId: true,
      managerUserId: true,
      sortOrder: true,
      path: true,
    },
  });
  if (!current) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "部门不存在");
  }

  if (input.managerUserId) {
    await assertActiveUser(input.managerUserId);
  }

  return prisma.$transaction(async (tx) => {
    let nextPath = current.path;
    if ((input.parentId ?? null) !== current.parentId) {
      if (input.parentId === current.id) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, "上级部门不能是自己");
      }

      let parentPath: string | null = null;
      if (input.parentId) {
        const parent = await tx.department.findFirst({
          where: { id: input.parentId, deletedAt: null },
          select: { id: true, path: true },
        });
        if (!parent) {
          throw new AppError(ERROR_CODES.NOT_FOUND, "上级部门不存在");
        }
        if (parent.path === current.path || parent.path.startsWith(`${current.path}/`)) {
          throw new AppError(ERROR_CODES.VALIDATION_FAILED, "上级部门不能是自己的下级");
        }
        parentPath = parent.path;
      }

      nextPath = `${parentPath ?? ""}/${randomUUID()}`;
      await tx.$executeRaw`
        UPDATE "Department"
        SET path = ${nextPath} || substring(path from (${current.path.length + 1})::int),
            "updatedAt" = NOW(),
            "updatedBy" = ${actorId}
        WHERE id = ${current.id} OR path LIKE ${`${current.path}/%`}
      `;
    }

    const updated = await tx.department.update({
      where: { id: current.id },
      data: {
        name: input.name,
        parentId: input.parentId ?? null,
        managerUserId: input.managerUserId ?? null,
        sortOrder: input.sortOrder,
        path: nextPath,
        updatedBy: actorId,
      },
      select: { id: true, name: true, path: true, parentId: true, sortOrder: true },
    });

    await recordAudit(tx, {
      actorId,
      action: "department.update",
      entity: "Department",
      entityId: current.id,
      before: current,
      after: updated,
    });

    return { id: updated.id };
  });
}

export async function deleteDepartment(
  id: string,
  actorId: string,
): Promise<{ id: string }> {
  const department = await prisma.department.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, path: true },
  });
  if (!department) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "部门不存在");
  }

  const [children, users, scopes] = await Promise.all([
    prisma.department.count({ where: { parentId: id, deletedAt: null } }),
    prisma.user.count({ where: { departmentId: id, deletedAt: null } }),
    prisma.dataScope.count({ where: { departmentId: id, deletedAt: null } }),
  ]);

  if (children > 0) {
    throw new AppError(ERROR_CODES.CONFLICT, "请先删除或移走下级部门");
  }
  if (users > 0) {
    throw new AppError(ERROR_CODES.CONFLICT, "部门下仍有用户，无法删除");
  }
  if (scopes > 0) {
    throw new AppError(ERROR_CODES.CONFLICT, "部门被角色数据范围引用，无法删除");
  }

  await prisma.$transaction(async (tx) => {
    await tx.department.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: actorId },
    });
    await recordAudit(tx, {
      actorId,
      action: "department.delete",
      entity: "Department",
      entityId: id,
      before: department,
    });
  });

  return { id };
}
