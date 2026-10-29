import type { Prisma } from "@/generated/prisma/client";
import type { DataScopeType } from "@/generated/prisma/enums";
import { AppError, ERROR_CODES } from "@/shared/errors";
import {
  PERMISSION_KEYS,
  type PermissionKey,
} from "@/shared/permissions";
import { prisma } from "@/server/db/client";

const PERMISSION_KEY_SET = new Set<string>(PERMISSION_KEYS);

export type AccessScope = {
  scope: DataScopeType;
  departmentId: string | null;
};

export type AccessContext = {
  userId: string;
  departmentId: string | null;
  permissions: Set<PermissionKey>;
  scopes: AccessScope[];
};

export const CONTRACT_ACTION_PERMISSIONS = {
  read: "contract.read",
  update: "contract.update",
  submit: "contract.submit",
  withdraw: "contract.withdraw",
  approve: "contract.approve",
  seal: "contract.seal",
  archive: "contract.archive",
  amend: "contract.amend",
  export: "contract.export",
} as const satisfies Record<string, PermissionKey>;

export type ContractAction = keyof typeof CONTRACT_ACTION_PERMISSIONS;

export async function getAccessContext(userId: string): Promise<AccessContext> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { departmentId: true, status: true, deletedAt: true },
  });

  if (!user || user.status !== "active" || user.deletedAt) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, "账号不可用，请重新登录");
  }

  const roles = await prisma.userRole.findMany({
    where: { userId, deletedAt: null, role: { deletedAt: null } },
    select: {
      role: {
        select: {
          rolePermissions: {
            where: { deletedAt: null, permission: { deletedAt: null } },
            select: { permission: { select: { key: true } } },
          },
          dataScope: { select: { scope: true, departmentId: true } },
        },
      },
    },
  });

  const permissions = new Set<PermissionKey>();
  const scopes: AccessScope[] = [];

  for (const { role } of roles) {
    for (const { permission } of role.rolePermissions) {
      if (PERMISSION_KEY_SET.has(permission.key)) {
        permissions.add(permission.key as PermissionKey);
      }
    }
    if (role.dataScope) {
      scopes.push({
        scope: role.dataScope.scope,
        departmentId: role.dataScope.departmentId,
      });
    }
  }

  return { userId, departmentId: user.departmentId, permissions, scopes };
}

export async function requirePermission(
  userId: string,
  key: PermissionKey,
): Promise<AccessContext> {
  const access = await getAccessContext(userId);
  if (!access.permissions.has(key)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "没有执行该操作的权限");
  }
  return access;
}

export async function buildContractScope(
  access: AccessContext,
): Promise<Prisma.ContractWhereInput> {
  if (access.scopes.some((scope) => scope.scope === "all")) {
    return {};
  }

  const conditions: Prisma.ContractWhereInput[] = [];
  const directDepartmentIds = new Set<string>();
  const subtreeDepartmentIds = new Set<string>();
  let includeSelf = false;

  for (const scope of access.scopes) {
    if (scope.scope === "self") {
      includeSelf = true;
      continue;
    }
    const departmentId = scope.departmentId ?? access.departmentId;
    if (!departmentId) {
      continue;
    }
    if (scope.scope === "dept") {
      directDepartmentIds.add(departmentId);
    } else if (scope.scope === "dept_and_sub") {
      subtreeDepartmentIds.add(departmentId);
    }
  }

  if (includeSelf) {
    conditions.push({
      OR: [
        { createdBy: access.userId },
        { participants: { some: { userId: access.userId } } },
        {
          flowInstances: {
            some: {
              OR: [
                { startedBy: access.userId },
                { tasks: { some: { assigneeId: access.userId } } },
              ],
            },
          },
        },
      ],
    });
  }

  if (directDepartmentIds.size > 0) {
    conditions.push({
      ownerDepartmentId: { in: [...directDepartmentIds] },
    });
  }

  if (subtreeDepartmentIds.size > 0) {
    const departments = await prisma.department.findMany({
      where: { id: { in: [...subtreeDepartmentIds] }, deletedAt: null },
      select: { path: true },
    });

    if (departments.length > 0) {
      const pathFilters = departments.flatMap((department) => [
        { path: department.path },
        {
          path: {
            startsWith: department.path === "/" ? "/" : `${department.path}/`,
          },
        },
      ]);
      conditions.push({ ownerDepartment: { is: { OR: pathFilters } } });
    }
  }

  if (conditions.length === 0) {
    return { id: { in: [] } };
  }

  return { OR: conditions };
}

export async function requireContractAccess(
  userId: string,
  contractId: string,
  action: ContractAction,
): Promise<{
  access: AccessContext;
  contract: {
    id: string;
    status: string;
    createdBy: string;
    ownerDepartmentId: string | null;
  };
}> {
  const access = await requirePermission(userId, CONTRACT_ACTION_PERMISSIONS[action]);

  const contract = await prisma.contract.findFirst({
    where: { id: contractId, deletedAt: null },
    select: {
      id: true,
      status: true,
      createdBy: true,
      ownerDepartmentId: true,
    },
  });

  if (!contract) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "合同不存在");
  }

  const scope = await buildContractScope(access);
  const inScope = await prisma.contract.count({
    where: { AND: [{ id: contractId }, scope] },
  });

  if (inScope === 0) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "无权访问该合同");
  }

  return { access, contract };
}
