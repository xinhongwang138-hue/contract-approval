import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import { getContractTemplate } from "@/server/services/contract-template";
import { AppError, ERROR_CODES } from "@/shared/errors";
import { FieldEditor } from "./field-editor";

export const metadata = { title: "模板字段设计" };

export default async function TemplateFieldsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);

  if (!access.permissions.has("flow.manage")) {
    return <AccessDenied permission="flow.manage" />;
  }

  const { id } = await params;

  let template;
  try {
    template = await getContractTemplate(id);
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.NOT_FOUND) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`字段设计 · ${template.name}`}
        description={`模板编码 ${template.code}，分类 ${template.category}。字段变更只影响之后新建的合同。`}
        actions={
          <Button asChild variant="outline">
            <Link href="/admin/templates">返回模板列表</Link>
          </Button>
        }
      />
      <FieldEditor templateId={template.id} initialFields={template.fields} />
    </div>
  );
}
