import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import { getApprovalDetail } from "@/server/services/approval-view";
import { contractStatusLabel } from "@/shared/contract-status";
import { FLOW_STATUS_LABELS } from "@/shared/flow-definition";
import { AppError, ERROR_CODES } from "@/shared/errors";
import { formatDate, formatDateTime } from "@/shared/datetime";
import { formatMoney } from "@/shared/money";
import { ATTACHMENT_KIND_LABELS } from "@/shared/schemas/attachment";
import type { AttachmentKind } from "@/shared/schemas/attachment";
import { ContractStatusBadge } from "@/components/contract/status-badge";
import { ApprovalPanel, TrailList } from "./approval-panel";

export const metadata = { title: "审批详情" };

function formatSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function ApprovalDetailPage({
  params,
}: {
  params: Promise<{ instanceId: string }>;
}) {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);
  const { instanceId } = await params;

  let detail;
  try {
    detail = await getApprovalDetail(access, instanceId);
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
        title={detail.contract.title}
        description={`${detail.contract.no} · ${detail.contract.templateName}（${detail.contract.templateCode}）· 流程 ${detail.instance.flowName} v${detail.instance.flowVersion}`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/contracts/${detail.contract.id}`}>合同详情</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/contracts/${detail.contract.id}/timeline`}>
                审批轨迹
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>合同摘要</CardTitle>
              <div className="flex items-center gap-2">
                <ContractStatusBadge status={detail.contract.status} />
                <Badge variant="outline">
                  实例 {FLOW_STATUS_LABELS[detail.instance.status] ?? detail.instance.status}
                </Badge>
                <span className="text-xl font-semibold">
                  {formatMoney(detail.contract.amount, detail.contract.currency)}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">甲方</dt>
                  <dd className="font-medium">{detail.contract.partyAName}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">乙方</dt>
                  <dd className="font-medium">{detail.contract.partyBName}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">签署日期</dt>
                  <dd className="font-medium">{formatDate(detail.contract.signDate)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">履行期间</dt>
                  <dd className="font-medium">
                    {formatDate(detail.contract.startDate)} 至{" "}
                    {formatDate(detail.contract.endDate)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">发起人</dt>
                  <dd className="font-medium">{detail.instance.startedByName}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">提交时间</dt>
                  <dd className="font-medium">
                    {formatDateTime(detail.instance.startedAt)}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {detail.formEntries.length > 0 ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle>模板字段</CardTitle>
                {detail.fieldsRestricted ? (
                  <Badge variant="outline">按节点可见字段展示</Badge>
                ) : null}
              </CardHeader>
              <CardContent>
                <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                  {detail.formEntries.map((entry) => (
                    <div key={entry.key} className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">{entry.label}</dt>
                      <dd className="text-right font-medium">{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>合同正文</CardTitle>
              {detail.fieldsRestricted && detail.bodyMarkdown === null ? (
                <span className="text-xs text-muted-foreground">该节点不可见</span>
              ) : null}
            </CardHeader>
            <CardContent>
              {detail.bodyMarkdown ? (
                <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-4 text-sm">
                  {detail.bodyMarkdown}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">暂无可见正文。</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>附件</CardTitle>
              {detail.fieldsRestricted && detail.attachments.length === 0 ? (
                <span className="text-xs text-muted-foreground">该节点不可见</span>
              ) : null}
            </CardHeader>
            <CardContent>
              {detail.attachments.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无可见附件。</p>
              ) : (
                <ul className="divide-y">
                  {detail.attachments.map((attachment) => (
                    <li
                      key={attachment.id}
                      className="flex flex-wrap items-center gap-3 py-2 text-sm"
                    >
                      <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
                        {ATTACHMENT_KIND_LABELS[attachment.kind as AttachmentKind] ??
                          attachment.kind}
                      </span>
                      <a
                        href={`/api/files/${attachment.id}`}
                        className="font-medium hover:underline"
                      >
                        {attachment.name}
                      </a>
                      <span className="text-xs text-muted-foreground">
                        {formatSize(attachment.size)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>审批轨迹</CardTitle>
            </CardHeader>
            <CardContent>
              <TrailList trail={detail.trail} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>决策面板</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ApprovalPanel detail={detail} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>合同状态</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="flex justify-between gap-4">
                <span className="text-muted-foreground">当前状态</span>
                <span className="font-medium">
                  {contractStatusLabel(detail.contract.status)}
                </span>
              </p>
              <p className="flex justify-between gap-4">
                <span className="text-muted-foreground">阶段</span>
                <span className="font-medium">
                  {detail.contract.stage === "returned" ? "退回修改" : "正常"}
                </span>
              </p>
              <p className="flex justify-between gap-4">
                <span className="text-muted-foreground">分类</span>
                <span className="font-medium">{detail.contract.category}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                驳回后合同状态变为「已驳回」，发起人可直接修改并重新提交，旧实例保留为轨迹。
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
