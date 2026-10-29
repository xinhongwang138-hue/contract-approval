import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { ContractStatusBadge } from "@/components/contract/status-badge";
import { AttachmentUploader } from "@/components/contract/attachment-uploader";
import { AttachmentDeleteButton } from "@/components/contract/attachment-delete-button";
import { Button } from "@/components/ui/button";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import {
  findSimilarContracts,
  getContractDetail,
} from "@/server/services/contract";
import { formatDate, formatDateTime } from "@/shared/datetime";
import { AppError, ERROR_CODES } from "@/shared/errors";
import { formatMoney } from "@/shared/money";
import { ATTACHMENT_KIND_LABELS } from "@/shared/schemas/attachment";
import type { AttachmentKind } from "@/shared/schemas/attachment";
import { CONTRACT_STAGE_LABELS } from "@/shared/contract-status";

export const metadata = { title: "合同详情" };

function formatSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);

  if (!access.permissions.has("contract.read")) {
    return <AccessDenied permission="contract.read" />;
  }

  const { id } = await params;

  let detail;
  try {
    detail = await getContractDetail(access, id);
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.NOT_FOUND) {
      notFound();
    }
    if (error instanceof AppError && error.code === ERROR_CODES.FORBIDDEN) {
      return <AccessDenied permission="contract.read" />;
    }
    throw error;
  }

  const similar = await findSimilarContracts(access, detail.id);
  const canEdit =
    access.permissions.has("contract.update") && detail.status === "draft";

  return (
    <div className="space-y-6">
      <PageHeader
        title={detail.title}
        description={`${detail.no} · ${detail.template.name}（${detail.template.code}）`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/contracts">返回列表</Link>
            </Button>
            {canEdit ? (
              <Button asChild>
                <Link href={`/contracts/${detail.id}/edit`}>编辑草稿</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <section className="rounded-lg border bg-card p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <ContractStatusBadge status={detail.status} />
          {detail.stage !== "normal" ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
              {CONTRACT_STAGE_LABELS[detail.stage] ?? detail.stage}
            </span>
          ) : null}
          <span className="text-sm text-muted-foreground">
            版本 v{detail.latestVersion?.version ?? 1}（共 {detail.versionCount} 个版本）
          </span>
          <span className="ml-auto text-xl font-semibold">
            {formatMoney(detail.amount, detail.currency)}
          </span>
        </div>

        <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-muted-foreground">合同类型</dt>
            <dd className="font-medium">{detail.typeName}</dd>
          </div>
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-muted-foreground">签署日期</dt>
            <dd className="font-medium">{formatDate(detail.signDate)}</dd>
          </div>
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-muted-foreground">履行期间</dt>
            <dd className="font-medium">
              {formatDate(detail.startDate)} 至 {formatDate(detail.endDate)}
            </dd>
          </div>
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-muted-foreground">甲方</dt>
            <dd className="font-medium">{detail.partyA.name}</dd>
          </div>
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-muted-foreground">乙方</dt>
            <dd className="font-medium">{detail.partyB.name}</dd>
          </div>
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-muted-foreground">创建人</dt>
            <dd className="font-medium">
              {detail.creator.name}
              {detail.creator.departmentName
                ? ` · ${detail.creator.departmentName}`
                : ""}
            </dd>
          </div>
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-muted-foreground">创建时间</dt>
            <dd className="font-medium">{formatDateTime(detail.createdAt)}</dd>
          </div>
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-muted-foreground">最近更新</dt>
            <dd className="font-medium">{formatDateTime(detail.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      {detail.formEntries.length > 0 ? (
        <section className="rounded-lg border bg-card p-4 shadow-xs">
          <h2 className="mb-3 text-sm font-semibold">模板字段</h2>
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            {detail.formEntries.map((entry) => (
              <div key={entry.key} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{entry.label}</dt>
                <dd className="text-right font-medium">{entry.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-lg border bg-card p-4 shadow-xs">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">合同正文</h2>
              <span className="text-xs text-muted-foreground">
                v{detail.latestVersion?.version ?? 1} ·{" "}
                {detail.latestVersion
                  ? formatDateTime(detail.latestVersion.createdAt)
                  : "尚无版本"}
              </span>
            </div>
            {detail.latestVersion?.bodyMarkdown ? (
              <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-4 text-sm">
                {detail.latestVersion.bodyMarkdown}
              </pre>
            ) : (
              <p className="rounded-md bg-muted/40 p-4 text-sm text-muted-foreground">
                暂无正文，可在编辑草稿时添加。
              </p>
            )}
          </section>

          <section className="rounded-lg border bg-card p-4 shadow-xs">
            <h2 className="mb-3 text-sm font-semibold">附件</h2>
            {detail.attachments.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无附件。</p>
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
                      {formatSize(attachment.size)} · {attachment.uploaderName} ·{" "}
                      {formatDateTime(attachment.createdAt)}
                    </span>
                    {canEdit ? (
                      <span className="ml-auto">
                        <AttachmentDeleteButton
                          attachmentId={attachment.id}
                          name={attachment.name}
                        />
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canEdit ? (
              <div className="mt-3 border-t pt-3">
                <AttachmentUploader contractId={detail.id} />
              </div>
            ) : null}
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-lg border bg-card p-4 shadow-xs">
            <h2 className="mb-3 text-sm font-semibold">相似合同</h2>
            {similar.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                未发现相同相对方、金额或签署日期的合同。
              </p>
            ) : (
              <ul className="space-y-3">
                {similar.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/contracts/${item.id}`}
                      className="block text-sm font-medium hover:underline"
                    >
                      {item.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{item.no}</span>
                      <ContractStatusBadge status={item.status} />
                      <span>{formatMoney(item.amount, item.currency)}</span>
                      <span>{formatDate(item.signDate)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border bg-card p-4 shadow-xs">
            <h2 className="mb-3 text-sm font-semibold">审批与用印</h2>
            <p className="text-sm text-muted-foreground">
              审批引擎将在提交后生成审批轨迹；用印登记在审批通过后开放。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
