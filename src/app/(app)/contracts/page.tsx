import Link from "next/link";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { ContractTable } from "@/components/contract/contract-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import { listContracts } from "@/server/services/contract";
import { CONTRACT_STATUS_LABELS } from "@/shared/contract-status";
import { contractListQuerySchema } from "@/shared/schemas/contract";
import { CONTRACT_STATUSES } from "@/shared/state-machines";

export const metadata = { title: "合同管理" };

type SearchParams = Record<string, string | string[] | undefined>;

const DEFAULT_PAGE_SIZE = contractListQuerySchema.parse({}).pageSize;

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);

  if (!access.permissions.has("contract.read")) {
    return <AccessDenied permission="contract.read" />;
  }

  const raw = await searchParams;
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      flat[key] = value;
    }
  }
  const parsedQuery = contractListQuerySchema.safeParse(flat);
  const query = parsedQuery.success
    ? parsedQuery.data
    : contractListQuerySchema.parse({});

  const result = await listContracts(access, query);
  const canEdit = access.permissions.has("contract.update");
  const canCreate = access.permissions.has("contract.create");

  const buildHref = (overrides: Record<string, string | undefined>): string => {
    const params = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      q: query.q,
      status: query.status,
      sort: query.sort,
      order: query.order,
      pageSize: query.pageSize === DEFAULT_PAGE_SIZE ? undefined : String(query.pageSize),
      page: query.page > 1 ? String(query.page) : undefined,
      ...overrides,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value) {
        params.set(key, value);
      }
    }
    const qs = params.toString();
    return qs ? `/contracts?${qs}` : "/contracts";
  };

  const sortHref = (field: typeof query.sort): string =>
    buildHref({
      sort: field,
      order:
        query.sort === field
          ? query.order === "asc"
            ? "desc"
            : "asc"
          : "desc",
      page: undefined,
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="合同管理"
        description="按权限与数据范围查看合同台账，草稿可继续编辑。"
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/contracts/new">新建合同</Link>
            </Button>
          ) : undefined
        }
      />

      <form
        className="flex flex-wrap items-end gap-3"
        action="/contracts"
        method="get"
      >
        <div className="grid gap-1">
          <label htmlFor="q" className="text-xs text-muted-foreground">
            搜索
          </label>
          <Input
            id="q"
            name="q"
            defaultValue={query.q ?? ""}
            placeholder="编号、标题或相对方"
            className="w-56"
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor="status" className="text-xs text-muted-foreground">
            状态
          </label>
          <select
            id="status"
            name="status"
            defaultValue={query.status ?? ""}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs"
          >
            <option value="">全部状态</option>
            {CONTRACT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {CONTRACT_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
        <input type="hidden" name="sort" value={query.sort} />
        <input type="hidden" name="order" value={query.order} />
        <input type="hidden" name="pageSize" value={String(query.pageSize)} />
        <Button type="submit" variant="secondary">
          查询
        </Button>
        <Button asChild variant="ghost">
          <Link href="/contracts">重置</Link>
        </Button>
      </form>

      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          共 {result.total} 份合同，第 {result.page} / {result.totalPages} 页
        </p>

        <ContractTable
          items={result.items}
          sort={query.sort}
          order={query.order}
          sortHref={sortHref}
          canEdit={canEdit}
        />

        <div className="flex items-center justify-end gap-2">
          {result.page <= 1 ? (
            <Button variant="outline" size="sm" disabled>
              上一页
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href={buildHref({ page: String(result.page - 1) })}>
                上一页
              </Link>
            </Button>
          )}
          {result.page >= result.totalPages ? (
            <Button variant="outline" size="sm" disabled>
              下一页
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link
                href={buildHref({
                  page: String(Math.min(result.totalPages, result.page + 1)),
                })}
              >
                下一页
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
