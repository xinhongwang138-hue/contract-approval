import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import { listDepartmentOptions } from "@/server/services/department";
import { listRoles } from "@/server/services/role";
import { RoleManager, type RoleRow } from "./role-manager";

export const metadata = { title: "角色权限" };

export default async function RolesPage() {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);

  if (!access.permissions.has("system.role.manage")) {
    return <AccessDenied permission="system.role.manage" />;
  }

  const [roles, departments] = await Promise.all([
    listRoles(),
    listDepartmentOptions(),
  ]);

  const rows: RoleRow[] = roles.map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    isSystem: role.isSystem,
    scope: role.scope,
    departmentId: role.departmentId,
    departmentName: role.departmentName,
    permissionKeys: role.permissionKeys,
    userCount: role.userCount,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="角色权限"
        description="配置角色可执行的动作与数据范围；系统角色由内置定义，不可修改。"
      />
      <RoleManager roles={rows} departments={departments} />
    </div>
  );
}
