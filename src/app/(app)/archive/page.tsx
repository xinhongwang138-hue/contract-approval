import Link from "next/link";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import { listArchive } from "@/server/services/lifecycle";
import { ArchiveManager, type ArchiveRowView } from "./archive-manager";

export const metadata = { title: "合同归档" };

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    q?: string;
    page?: string;
    pageSize?: string;
  }>;
}) {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);
  if (!access.permissions.has("contract.archive")) {
    return <AccessDenied permission="contract.archive" />;
  }

  const params = await searchParams;
  const tab = params.tab === "archived" ? "archived" : "pending";
  const q = params.q ?? "";
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const pageSize = Number(params.pageSize ?? "20") || 20;

  const list = await listArchive(access, { page, pageSize, tab, q });

  const buildHref = (overrides: Record<string, string | undefined>): string => {
    const query = new URLSearchParams();
    const merged = {
      tab: tab === "archived" ? "archived" : undefined,
      q: q === "" ? undefined : q,
      page: page > 1 ? String(page) : undefined,
      pageSize: pageSize === 20 ? undefined : String(pageSize),
      ...overrides,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value) {
        query.set(key, value);
      }
    }
    const qs = query.toString();
    return qs ? `/archive?${qs}` : "/archive";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="合同归档"
        description="履行完毕、到期或终止的合同在此归档；归档后合同与其附件转为只读，不能再编辑或审批。"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-3 text-sm">
          <Link
            href={buildHref({ tab: undefined, page: undefined })}
            className={tab === "pending" ? "font-medium text-primary" : "text-muted-foreground"}
          >
            待归档 {list.pendingTotal}
          </Link>
          <span className="text-muted-foreground">·</span>
          <Link
            href={buildHref({ tab: "archived", page: undefined })}
            className={tab === "archived" ? "font-medium text-primary" : "text-muted-foreground"}
          >
            已归档 {list.archivedTotal}
          </Link>
        </div>

        <form action="/archive" className="flex items-center gap-2">
          {tab === "archived" ? <input type="hidden" name="tab" value="archived" /> : null}
          <input type="hidden" name="pageSize" value={String(pageSize)} />
          <Input
            id="archive-q"
            name="q"
            defaultValue={q}
            placeholder="合同编号或标题"
            className="h-8 w-56"
          />
          <Button type="submit" variant="outline" size="sm">
            搜索
          </Button>
          {q !== "" ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={buildHref({ q: undefined, page: undefined })}>清空</Link>
            </Button>
          ) : null}
        </form>
      </div>

      <ArchiveManager
        tab={tab}
        rows={list.rows.map((row): ArchiveRowView => ({
          id: row.id,
          no: row.no,
          title: row.title,
          amount: row.amount,
          status: row.status,
          endDate: row.endDate.toISOString(),
          sealedAt: row.sealedAt?.toISOString() ?? null,
          effectiveAt: row.effectiveAt?.toISOString() ?? null,
          archivedAt: row.archivedAt?.toISOString() ?? null,
        }))}
        pagination={{
          page: list.page,
          pageSize: list.pageSize,
          totalPages: list.totalPages,
          total: list.total,
          basePath: "/archive",
          // 函数不能跨 RSC 边界传给客户端组件，改传可序列化的查询基线
          baseQuery: {
            tab: tab === "archived" ? "archived" : undefined,
            q: q === "" ? undefined : q,
            pageSize: pageSize === 20 ? undefined : String(pageSize),
          },
        }}
      />
    </div>
  );
}
