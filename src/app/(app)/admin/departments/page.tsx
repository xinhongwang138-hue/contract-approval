import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { listDepartmentTree, type DepartmentTreeNode } from "@/server/services/department";
import { DepartmentManager } from "./department-manager";
import type { DepartmentRow } from "./types";

export const metadata = { title: "部门管理" };

function toRows(
  nodes: DepartmentTreeNode[],
  level = 0,
): DepartmentRow[] {
  return nodes.flatMap((node) => [
    {
      id: node.id,
      name: node.name,
      parentId: node.parentId,
      path: node.path,
      sortOrder: node.sortOrder,
      managerId: node.manager?.id ?? null,
      managerName: node.manager?.name ?? null,
      userCount: node.userCount,
      level,
    },
    ...toRows(node.children, level + 1),
  ]);
}

export default async function DepartmentsPage() {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);

  if (!access.permissions.has("system.user.manage")) {
    return <AccessDenied permission="system.user.manage" />;
  }

  const [tree, managers] = await Promise.all([
    listDepartmentTree(),
    prisma.user.findMany({
      where: { deletedAt: null, status: "active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="部门管理"
        description="维护组织架构与部门负责人，物化路径支撑数据范围的下级查询。"
      />
      <DepartmentManager rows={toRows(tree)} managers={managers} />
    </div>
  );
}
