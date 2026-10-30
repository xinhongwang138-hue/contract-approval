import Link from "next/link";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import {
  listAuditActorOptions,
  listAuditLogs,
  listFlowEvents,
} from "@/server/services/audit-log";
import { formatDateTime, parseShanghaiDate } from "@/shared/datetime";
import { flowStateLabel } from "@/shared/flow-definition";

export const metadata = { title: "审计日志" };

const AUDIT_ENTITIES = [
  "Contract",
  "ContractTemplate",
  "ApprovalFlow",
  "SealRecord",
  "Attachment",
  "Department",
  "User",
  "Role",
  "Party",
  "Delegate",
];

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    entity?: string;
    action?: string;
    actor?: string;
    q?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);
  if (!access.permissions.has("audit.read")) {
    return <AccessDenied permission="audit.read" />;
  }

  const params = await searchParams;
  const tab = params.tab === "flow" ? "flow" : "audit";
  const entity = params.entity ?? "";
  const action = params.action ?? "";
  const actor = params.actor ?? "";
  const q = params.q ?? "";
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const pageSize = 30;
  const from = params.from ? parseShanghaiDate(params.from) : undefined;
  const to = params.to ? parseShanghaiDate(params.to, true) : undefined;

  const [actors, audit, events] = await Promise.all([
    listAuditActorOptions(access),
    tab === "audit"
      ? listAuditLogs(access, {
          page,
          pageSize,
          ...(entity ? { entity } : {}),
          ...(action ? { action } : {}),
          ...(actor ? { actorId: actor } : {}),
          ...(q ? { q } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        })
      : null,
    tab === "flow"
      ? listFlowEvents(access, {
          page,
          pageSize,
          ...(action ? { action } : {}),
          ...(actor ? { actorId: actor } : {}),
          ...(q ? { q } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        })
      : null,
  ]);

  const rows =
    tab === "audit"
      ? (audit?.rows ?? []).map((row) => ({
          id: row.id,
          createdAt: row.createdAt,
          actorName: row.actorName,
          action: row.action,
          objectLabel: `${row.entity} · ${row.entityId}`,
          objectHref: null as string | null,
          change: `${row.before} → ${row.after}`,
          source: row.ip ?? "",
          ua: row.ua ?? "",
        }))
      : (events?.rows ?? []).map((row) => ({
          id: row.id,
          createdAt: row.createdAt,
          actorName: row.actorName,
          action: row.action,
          objectLabel: `${row.contractNo} · ${row.contractTitle}`,
          objectHref: `/approvals/${row.instanceId}`,
          change: `${flowStateLabel(row.action, row.from)} → ${flowStateLabel(row.action, row.to)}　${row.detail}`,
          source: "",
          ua: "",
        }));
  const total = tab === "audit" ? (audit?.total ?? 0) : (events?.total ?? 0);
  const totalPages = tab === "audit" ? (audit?.totalPages ?? 1) : (events?.totalPages ?? 1);

  const buildHref = (overrides: Record<string, string | undefined>): string => {
    const query = new URLSearchParams();
    const merged = {
      tab: tab === "flow" ? "flow" : undefined,
      entity: entity === "" ? undefined : entity,
      action: action === "" ? undefined : action,
      actor: actor === "" ? undefined : actor,
      q: q === "" ? undefined : q,
      from: params.from,
      to: params.to,
      page: page > 1 ? String(page) : undefined,
      ...overrides,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value) {
        query.set(key, value);
      }
    }
    const qs = query.toString();
    return qs ? `/audit?${qs}` : "/audit";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="审计日志"
        description="操作审计与流程事件均为追加写表，数据库层面禁止更新与删除；流程事件按合同可见范围过滤。"
      />

      <div className="flex gap-3 text-sm">
        <Link
          href={buildHref({ tab: undefined, entity: undefined })}
          className={tab === "audit" ? "font-medium text-primary" : "text-muted-foreground"}
        >
          操作审计 {total}
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link
          href={buildHref({ tab: "flow", entity: undefined })}
          className={tab === "flow" ? "font-medium text-primary" : "text-muted-foreground"}
        >
          流程事件 {total}
        </Link>
      </div>

      <form action="/audit" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value={tab} />
        <div className="grid gap-1">
          <label htmlFor="audit-action" className="text-xs text-muted-foreground">
            动作关键字
          </label>
          <Input
            id="audit-action"
            name="action"
            defaultValue={action}
            placeholder="例如 contract.submit"
            className="h-8 w-44"
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor="audit-q" className="text-xs text-muted-foreground">
            对象编号 / 合同号
          </label>
          <Input
            id="audit-q"
            name="q"
            defaultValue={q}
            placeholder="HT-PURCHASE-… 或记录 id"
            className="h-8 w-52"
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor="audit-actor" className="text-xs text-muted-foreground">
            操作人
          </label>
          <select
            id="audit-actor"
            name="actor"
            defaultValue={actor}
            className="h-8 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">全部</option>
            {actors.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
        {tab === "audit" ? (
          <div className="grid gap-1">
            <label htmlFor="audit-entity" className="text-xs text-muted-foreground">
              实体
            </label>
            <select
              id="audit-entity"
              name="entity"
              defaultValue={entity}
              className="h-8 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">全部</option>
              {AUDIT_ENTITIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="grid gap-1">
          <label htmlFor="audit-from" className="text-xs text-muted-foreground">
            起
          </label>
          <Input id="audit-from" name="from" type="date" defaultValue={params.from ?? ""} className="h-8" />
        </div>
        <div className="grid gap-1">
          <label htmlFor="audit-to" className="text-xs text-muted-foreground">
            止
          </label>
          <Input id="audit-to" name="to" type="date" defaultValue={params.to ?? ""} className="h-8" />
        </div>
        <Button type="submit" variant="outline" size="sm">
          筛选
        </Button>
      </form>

      <Card>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              没有符合条件的记录。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium">时间</th>
                    <th className="py-2 text-left font-medium">操作人</th>
                    <th className="py-2 text-left font-medium">动作</th>
                    <th className="py-2 text-left font-medium">对象</th>
                    <th className="py-2 text-left font-medium">变化</th>
                    {tab === "audit" ? (
                      <th className="py-2 text-left font-medium">来源</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b align-top last:border-0">
                      <td className="whitespace-nowrap py-2 text-xs text-muted-foreground">
                        {formatDateTime(row.createdAt)}
                      </td>
                      <td className="py-2">{row.actorName}</td>
                      <td className="py-2">
                        <Badge variant="outline">{row.action}</Badge>
                      </td>
                      <td className="py-2 text-xs">
                        {row.objectHref ? (
                          <Link href={row.objectHref} className="font-mono hover:underline">
                            {row.objectLabel}
                          </Link>
                        ) : (
                          <span className="break-all">{row.objectLabel}</span>
                        )}
                      </td>
                      <td className="max-w-96 py-2 text-xs">
                        <p className="truncate text-muted-foreground">{row.change}</p>
                      </td>
                      {tab === "audit" ? (
                        <td className="max-w-48 py-2 text-xs text-muted-foreground">
                          <p className="truncate">{row.source || "—"}</p>
                          <p className="truncate">{row.ua}</p>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-end gap-2">
              {page <= 1 ? (
                <Button variant="outline" size="sm" disabled>
                  上一页
                </Button>
              ) : (
                <Button asChild variant="outline" size="sm">
                  <Link href={buildHref({ page: String(page - 1) })}>上一页</Link>
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                第 {Math.min(page, totalPages)} / {totalPages} 页，共 {total} 条
              </span>
              {page >= totalPages ? (
                <Button variant="outline" size="sm" disabled>
                  下一页
                </Button>
              ) : (
                <Button asChild variant="outline" size="sm">
                  <Link href={buildHref({ page: String(page + 1) })}>下一页</Link>
                </Button>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
