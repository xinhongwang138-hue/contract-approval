import Link from "next/link";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import { listSealRecords } from "@/server/services/lifecycle";
import { SEAL_STATES, SEAL_STATE_LABELS, type SealState } from "@/shared/lifecycle";
import { SealManager, type SealRowView } from "./seal-manager";

export const metadata = { title: "用印管理" };

function isSealState(value: string | undefined): value is SealState {
  return value !== undefined && (SEAL_STATES as readonly string[]).includes(value);
}

export default async function SealsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; q?: string; page?: string; pageSize?: string }>;
}) {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);
  if (!access.permissions.has("contract.seal")) {
    return <AccessDenied permission="contract.seal" />;
  }

  const params = await searchParams;
  const state = isSealState(params.state) ? params.state : null;
  const q = params.q ?? "";
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const pageSize = Number(params.pageSize ?? "20") || 20;

  const list = await listSealRecords(access, { page, pageSize, state, q });

  const buildHref = (overrides: Record<string, string | undefined>): string => {
    const query = new URLSearchParams();
    const merged = {
      state: state ?? undefined,
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
    return qs ? `/seals?${qs}` : "/seals";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="用印管理"
        description="审批通过并生成用印申请后，在这里登记取件与归还；归还登记完成合同自动进入履行。"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            href={buildHref({ state: undefined, page: undefined })}
            className={state === null ? "font-medium text-primary" : "text-muted-foreground"}
          >
            全部 {list.total}
          </Link>
          {SEAL_STATES.map((item) => (
            <Link
              key={item}
              href={buildHref({ state: item, page: undefined })}
              className={state === item ? "font-medium text-primary" : "text-muted-foreground"}
            >
              {SEAL_STATE_LABELS[item]} {list.counts[item]}
            </Link>
          ))}
        </div>

        <form action="/seals" className="flex items-center gap-2">
          {state ? <input type="hidden" name="state" value={state} /> : null}
          <input type="hidden" name="pageSize" value={String(pageSize)} />
          <Input
            id="seal-q"
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

      <SealManager
        rows={list.rows.map((row): SealRowView => ({
          id: row.id,
          contractId: row.contractId,
          contractNo: row.contractNo,
          contractTitle: row.contractTitle,
          contractStatus: row.contractStatus,
          sealType: row.sealType,
          copies: row.copies,
          applicantName: row.applicantName,
          appliedAt: row.appliedAt.toISOString(),
          pickedAt: row.pickedAt?.toISOString() ?? null,
          returnedAt: row.returnedAt?.toISOString() ?? null,
          notaryNo: row.notaryNo,
          state: row.state,
        }))}
        pagination={{
          page: list.page,
          pageSize: list.pageSize,
          totalPages: list.totalPages,
          total: list.total,
          basePath: "/seals",
          // 函数不能跨 RSC 边界传给客户端组件，改传可序列化的查询基线
          baseQuery: {
            state: state ?? undefined,
            q: q === "" ? undefined : q,
            pageSize: pageSize === 20 ? undefined : String(pageSize),
          },
        }}
      />
    </div>
  );
}
