import Link from "next/link";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import { formatDateTime } from "@/shared/datetime";
import { listParties } from "@/server/services/party";
import { PartyManager, type PartyRow } from "./party-manager";

export const metadata = { title: "相对方" };

type SearchParams = Record<string, string | string[] | undefined>;

function readParam(params: SearchParams, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value.trim() : "";
}

export default async function PartiesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);

  if (!access.permissions.has("contract.create")) {
    return <AccessDenied permission="contract.create" />;
  }

  const params = await searchParams;
  const search = readParam(params, "search");
  const rawType = readParam(params, "type");
  const type =
    rawType === "customer" || rawType === "supplier" || rawType === "other"
      ? rawType
      : undefined;
  const parsedPage = Number.parseInt(readParam(params, "page"), 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const result = await listParties({
    search: search || undefined,
    type,
    page,
  });

  const query = new URLSearchParams();
  if (search) {
    query.set("search", search);
  }
  if (type) {
    query.set("type", type);
  }
  const pageHref = (target: number): string => {
    const next = new URLSearchParams(query);
    if (target > 1) {
      next.set("page", String(target));
    }
    const qs = next.toString();
    return qs ? `/admin/parties?${qs}` : "/admin/parties";
  };

  const rows: PartyRow[] = result.items.map((item) => ({
    id: item.id,
    name: item.name,
    uscc: item.uscc,
    type: item.type,
    address: item.address,
    contacts: item.contacts.map((contact) => ({
      name: contact.name,
      phone: contact.phone ?? "",
      email: contact.email ?? "",
    })),
    contractCount: item.contractCount,
    updatedAtLabel: formatDateTime(item.updatedAt),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="相对方"
        description="维护客户与供应商主数据，统一社会信用代码唯一。"
      />

      <form className="flex flex-wrap items-end gap-3" action="/admin/parties">
        <div className="grid gap-1">
          <label htmlFor="search" className="text-xs text-muted-foreground">
            搜索
          </label>
          <Input
            id="search"
            name="search"
            defaultValue={search}
            placeholder="名称或信用代码"
            className="w-56"
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor="type" className="text-xs text-muted-foreground">
            类型
          </label>
          <select
            id="type"
            name="type"
            defaultValue={type ?? ""}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs"
          >
            <option value="">全部类型</option>
            <option value="customer">客户</option>
            <option value="supplier">供应商</option>
            <option value="other">其他</option>
          </select>
        </div>
        <Button type="submit" variant="secondary">
          查询
        </Button>
        <Button asChild variant="ghost">
          <Link href="/admin/parties">重置</Link>
        </Button>
      </form>

      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          共 {result.total} 个相对方，第 {result.page} / {result.totalPages} 页
        </p>
        <PartyManager parties={rows} />

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
