import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ContractForm,
  type ContractFormInitial,
  type ContractFormOptions,
} from "@/components/contract/contract-form";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import {
  getContractDetail,
  listContractFormOptions,
} from "@/server/services/contract";
import { contractStatusLabel, isEditableContractStatus } from "@/shared/contract-status";
import { AppError, ERROR_CODES } from "@/shared/errors";

export const metadata = { title: "编辑合同" };

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export default async function EditContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);

  if (!access.permissions.has("contract.update")) {
    return <AccessDenied permission="contract.update" />;
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

  if (!isEditableContractStatus(detail.status)) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertTitle>该合同当前不可编辑</AlertTitle>
          <AlertDescription>
            只有草稿或被驳回的合同可以修改，当前状态为「{contractStatusLabel(detail.status)}」。
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline">
          <Link href={`/contracts/${detail.id}`}>返回合同详情</Link>
        </Button>
      </div>
    );
  }

  const options = await listContractFormOptions(access);
  const templateExists = options.templates.some(
    (template) => template.id === detail.template.id,
  );
  const typeExists = options.types.some((type) => type.id === detail.typeId);

  const mergedOptions: ContractFormOptions = {
    templates: templateExists
      ? options.templates
      : [detail.template, ...options.templates],
    types: typeExists
      ? options.types
      : [{ id: detail.typeId, key: "", name: detail.typeName }, ...options.types],
    parties: options.parties,
  };

  const formValues: Record<string, string> = {};
  for (const field of detail.template.fields) {
    const value = detail.formData[field.key];
    formValues[field.key] =
      value === undefined || value === null ? "" : String(value);
  }

  const initial: ContractFormInitial = {
    id: detail.id,
    templateId: detail.template.id,
    typeId: detail.typeId,
    title: detail.title,
    partyAId: detail.partyA.id,
    partyBId: detail.partyB.id,
    amount: detail.amount,
    currency: detail.currency,
    signDate: dateOnly(detail.signDate),
    startDate: dateOnly(detail.startDate),
    endDate: dateOnly(detail.endDate),
    formValues,
    bodyMarkdown: detail.latestVersion?.bodyMarkdown ?? "",
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`编辑 · ${detail.title}`}
        description={`合同编号 ${detail.no}，保存后覆盖草稿与初始版本。`}
        actions={
          <Button asChild variant="outline">
            <Link href={`/contracts/${detail.id}`}>返回详情</Link>
          </Button>
        }
      />
      <ContractForm options={mergedOptions} initial={initial} />
    </div>
  );
}
