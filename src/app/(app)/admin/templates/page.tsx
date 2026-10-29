import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import { listContractTemplates } from "@/server/services/contract-template";
import { formatDateTime } from "@/shared/datetime";
import { TemplateManager, type TemplateRow } from "./template-manager";

export const metadata = { title: "合同模板" };

export default async function TemplatesPage() {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);

  if (!access.permissions.has("flow.manage")) {
    return <AccessDenied permission="flow.manage" />;
  }

  const templates = await listContractTemplates();
  const rows: TemplateRow[] = templates.map((template) => ({
    id: template.id,
    code: template.code,
    name: template.name,
    category: template.category,
    active: template.active,
    fieldCount: template.fieldCount,
    contractCount: template.contractCount,
    updatedAtLabel: formatDateTime(template.updatedAt),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="合同模板"
        description="模板决定动态表单字段与默认审批流，编码参与合同编号生成。"
      />
      <p className="text-xs text-muted-foreground">共 {rows.length} 个模板</p>
      <TemplateManager templates={rows} />
    </div>
  );
}
