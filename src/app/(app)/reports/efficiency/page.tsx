import Link from "next/link";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import {
  getEfficiencyReport,
  isReportWindow,
  listReportFlowOptions,
  REPORT_WINDOWS,
} from "@/server/services/report";
import { formatDate } from "@/shared/datetime";

export const metadata = { title: "效率报表" };

function formatHours(value: number | null): string {
  if (value === null) {
    return "—";
  }
  if (value < 1 / 60) {
    return `${Math.max(0, Math.round(value * 3600))} 秒`;
  }
  if (value < 1) {
    return `${Math.round(value * 60)} 分钟`;
  }
  if (value < 48) {
    return `${value.toFixed(1)} 小时`;
  }
  return `${(value / 24).toFixed(1)} 天`;
}

function formatRate(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export default async function EfficiencyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; flow?: string }>;
}) {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);
  if (!access.permissions.has("report.read")) {
    return <AccessDenied permission="report.read" />;
  }

  const params = await searchParams;
  const windowDays = isReportWindow(params.days) ? Number(params.days) : 30;
  const flowId = params.flow;

  const [report, flows] = await Promise.all([
    getEfficiencyReport(access, {
      windowDays: windowDays as 7 | 30 | 90,
      ...(flowId ? { flowId } : {}),
    }),
    listReportFlowOptions(access),
  ]);

  const buildHref = (overrides: Record<string, string | undefined>): string => {
    const query = new URLSearchParams();
    const merged = {
      days: String(windowDays),
      flow: flowId,
      ...overrides,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value) {
        query.set(key, value);
      }
    }
    return `/reports/efficiency?${query.toString()}`;
  };

  const cards = [
    { label: "样本任务", value: String(report.sampleSize), hint: `${formatDate(report.from)} 起` },
    { label: "平均处理时长", value: formatHours(report.totals.avgHours), hint: `已处理 ${report.totals.decidedCount} 件` },
    { label: "超期率", value: formatRate(report.totals.overdueRate), hint: `超期 ${report.totals.overdueCount} 件` },
    { label: "驳回率", value: formatRate(report.totals.rejectRate), hint: `驳回 ${report.totals.rejectedCount} 件` },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="效率报表"
        description="按流程与节点统计审批耗时、超期与驳回比例；数据范围沿用合同可见范围。"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="统计时间窗口"
          className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1 text-sm"
        >
          {REPORT_WINDOWS.map((days) => {
            const active = days === windowDays;
            return (
              <Link
                key={days}
                href={buildHref({ days: String(days) })}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "rounded-md bg-background px-3 py-1 font-medium text-foreground shadow-xs"
                    : "rounded-md px-3 py-1 text-muted-foreground hover:text-foreground"
                }
              >
                近 {days} 天
              </Link>
            );
          })}
        </div>

        <form action="/reports/efficiency" className="flex items-center gap-2">
          <input type="hidden" name="days" value={String(windowDays)} />
          <label htmlFor="report-flow" className="text-sm text-muted-foreground">
            流程
          </label>
          <select
            id="report-flow"
            name="flow"
            defaultValue={flowId ?? ""}
            className="h-8 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">全部流程</option>
            {flows.map((flow) => (
              <option key={flow.id} value={flow.id}>
                {flow.name}（{flow.code}）
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline" size="sm">
            应用
          </Button>
        </form>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">{card.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{card.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {report.truncated ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          样本已达 {report.sampleSize} 条上限，仅统计最近的活动；请缩短时间窗或按流程过滤。
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>节点效率</CardTitle>
        </CardHeader>
        <CardContent>
          {report.nodes.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              该时间窗内没有审批任务样本。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium">流程</th>
                    <th className="py-2 text-left font-medium">节点</th>
                    <th className="py-2 text-right font-medium">任务</th>
                    <th className="py-2 text-right font-medium">待处理</th>
                    <th className="py-2 text-right font-medium">平均耗时</th>
                    <th className="py-2 text-right font-medium">中位耗时</th>
                    <th className="py-2 text-right font-medium">最慢</th>
                    <th className="py-2 text-right font-medium">超期率</th>
                    <th className="py-2 text-right font-medium">驳回率</th>
                  </tr>
                </thead>
                <tbody>
                  {report.nodes.map((node) => (
                    <tr key={node.key} className="border-b last:border-0">
                      <td className="py-2">
                        <span className="font-medium">{node.flowName}</span>
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {node.flowCode}
                        </span>
                      </td>
                      <td className="py-2">{node.nodeName}</td>
                      <td className="py-2 text-right tabular-nums">{node.taskCount}</td>
                      <td className="py-2 text-right tabular-nums">{node.pendingCount}</td>
                      <td className="py-2 text-right tabular-nums">{formatHours(node.avgHours)}</td>
                      <td className="py-2 text-right tabular-nums">
                        {formatHours(node.medianHours)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatHours(node.slowestHours)}
                      </td>
                      <td className="py-2 text-right">
                        {node.overdueRate !== null && node.overdueRate > 0.2 ? (
                          <Badge variant="destructive">{formatRate(node.overdueRate)}</Badge>
                        ) : (
                          <span className="tabular-nums">{formatRate(node.overdueRate)}</span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {node.rejectRate !== null && node.rejectRate > 0.3 ? (
                          <Badge variant="secondary">{formatRate(node.rejectRate)}</Badge>
                        ) : (
                          <span className="tabular-nums">{formatRate(node.rejectRate)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>流程汇总</CardTitle>
        </CardHeader>
        <CardContent>
          {report.flows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">暂无数据。</p>
          ) : (
            <ul className="divide-y">
              {report.flows.map((flow) => (
                <li key={flow.flowCode} className="flex flex-wrap items-center gap-4 py-2 text-sm">
                  <Link
                    href={buildHref({ flow: flows.find((item) => item.code === flow.flowCode)?.id })}
                    className="font-medium hover:underline"
                  >
                    {flow.flowName}
                  </Link>
                  <span className="font-mono text-xs text-muted-foreground">{flow.flowCode}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {flow.taskCount} 个任务 · 平均 {formatHours(flow.avgHours)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
