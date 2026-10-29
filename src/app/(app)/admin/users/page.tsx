import Link from "next/link";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { formatDateTime } from "@/shared/datetime";
import { listDepartmentOptions } from "@/server/services/department";
import { listRoleOptions, listUsers } from "@/server/services/user";
import { UserManager } from "./user-manager";

export const metadata = { title: "用户管理" };

type SearchParams = Record<string, string | string[] | undefined>;

function readParam(params: SearchParams, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value.trim() : "";
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);

  if (!access.permissions.has("system.user.manage")) {
    return <AccessDenied permission="system.user.manage" />;
  }

  const params = await searchParams;
  const search = readParam(params, "search");
  const departmentId = readParam(params, "departmentId");
  const rawStatus = readParam(params, "status");
  const status =
    rawStatus === "active" || rawStatus === "disabled" ? rawStatus : undefined;
  const parsedPage = Number.parseInt(readParam(params, "page"), 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const [result, departments, roles, people] = await Promise.all([
    listUsers({
      search: search || undefined,
      departmentId: departmentId || undefined,
      status,
      page,
    }),
    listDepartmentOptions(),
    listRoleOptions(),
    prisma.user.findMany({
      where: { deletedAt: null, status: "active" },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
  ]);

  const query = new URLSearchParams();
  if (search) {
    query.set("search", search);
  }
  if (departmentId) {
    query.set("departmentId", departmentId);
  }
  if (status) {
    query.set("status", status);
  }
  const pageHref = (target: number): string => {
    const next = new URLSearchParams(query);
    if (target > 1) {
      next.set("page", String(target));
    }
    const qs = next.toString();
    return qs ? `/admin/users?${qs}` : "/admin/users";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="用户管理"
        description="维护账号、部门归属、角色与直属上级，停用即清除会话。"
      />

      <form className="flex flex-wrap items-end gap-3" action="/admin/users">
        <div className="grid gap-1">
          <label htmlFor="search" className="text-xs text-muted-foreground">
            搜索
          </label>
          <Input
            id="search"
            name="search"
            defaultValue={search}
            placeholder="姓名或邮箱"
            className="w-56"
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor="departmentId" className="text-xs text-muted-foreground">
            部门
          </label>
          <select
            id="departmentId"
            name="departmentId"
            defaultValue={departmentId}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs"
          >
            <option value="">全部部门</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {"　".repeat(department.level)}
                {department.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="status" className="text-xs text-muted-foreground">
            状态
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status ?? ""}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs"
          >
            <option value="">全部状态</option>
            <option value="active">启用</option>
            <option value="disabled">停用</option>
          </select>
        </div>
        <Button type="submit" variant="secondary">
          查询
        </Button>
        <Button asChild variant="ghost">
          <Link href="/admin/users">重置</Link>
        </Button>
      </form>

      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          共 {result.total} 个用户，第 {result.page} / {result.totalPages} 页
        </p>
        <UserManager
          users={result.items.map((item) => ({
            id: item.id,
            name: item.name,
            email: item.email,
            status: item.status,
            departmentId: item.department?.id ?? null,
            departmentName: item.department?.name ?? null,
            managerId: item.manager?.id ?? null,
            managerName: item.manager?.name ?? null,
            roles: item.roles.map((role) => ({ id: role.id, name: role.name })),
            createdAtLabel: formatDateTime(item.createdAt),
          }))}
          departments={departments}
          roles={roles.map((role) => ({
            id: role.id,
            name: role.name,
            isSystem: role.isSystem,
          }))}
          people={people}
          currentUserId={user.id}
        />

        <div className="flex items-center justify-end gap-2">
          <Button asChild variant="outline" size="sm" disabled={result.page <= 1}>
            <Link
              href={pageHref(Math.max(1, result.page - 1))}
              aria-disabled={result.page <= 1}
            >
              上一页
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            disabled={result.page >= result.totalPages}
          >
            <Link
              href={pageHref(Math.min(result.totalPages, result.page + 1))}
              aria-disabled={result.page >= result.totalPages}
            >
              下一页
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
