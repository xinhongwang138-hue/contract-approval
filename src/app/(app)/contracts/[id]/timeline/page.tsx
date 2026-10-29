import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContractStatusBadge } from "@/components/contract/status-badge";
import { TrailList } from "@/app/(app)/approvals/[instanceId]/approval-panel";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import { getContractTimeline } from "@/server/services/approval-view";
import { contractStatusLabel } from "@/shared/contract-status";
import { FLOW_STATUS_LABELS } from "@/shared/flow-definition";
import { formatDateTime } from "@/shared/datetime";
import { AppError, ERROR_CODES } from "@/shared/errors";

export const metadata = { title: "审批轨迹" };

export default async function ContractTimelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);
  const { id } = await params;

  let timeline;
  try {
    timeline = await getContractTimeline(access, id);
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.NOT_FOUND) {
      notFound();
    }
    if (error instanceof AppError && error.code === ERROR_CODES.FORBIDDEN) {
      return <AccessDenied permission="contract.read" />;
    }
    throw error;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`审批轨迹 · ${timeline.contract.title}`}
        description={`${timeline.contract.no} · ${contractStatusLabel(timeline.contract.status)}`}
        actions={
          <Button asChild variant="outline">
            <Link href={`/contracts/${timeline.contract.id}`}>返回合同详情</Link>
          </Button>
        }
      />

      {timeline.instances.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            该合同尚未提交审批，没有审批轨迹。
          </CardContent>
        </Card>
      ) : (
        timeline.instances.map((instance) => (
          <Card key={instance.instanceId}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <div>
                <CardTitle>
                  {instance.flowName} v{instance.flowVersion}
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {instance.startedByName} 提交于{" "}
                  {formatDateTime(instance.startedAt)}
                  {instance.finishedAt
                    ? ` · 结束于 ${formatDateTime(instance.finishedAt)}`
                    : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <ContractStatusBadge status={timeline.contract.status} />
                <Badge variant="outline">
                  实例 {FLOW_STATUS_LABELS[instance.status] ?? instance.status}
                </Badge>
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/approvals/${instance.instanceId}`}>查看审批详情</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <TrailList trail={instance.trail} />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
