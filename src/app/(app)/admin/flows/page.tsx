import { PageHeader } from "@/components/layout/page-header";
import { AccessDenied } from "@/components/layout/access-denied";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import { listFlows } from "@/server/services/flow";
import { FlowManager, type FlowRow } from "./flow-manager";

export const metadata = { title: "审批流程" };

export default async function FlowsPage() {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);

  const canManage = access.permissions.has("flow.manage");
  const canCreate = access.permissions.has("flow.create");
  const canPublish = access.permissions.has("flow.publish");

  if (!canCreate && !canManage && !canPublish) {
    return <AccessDenied permission="flow.manage" />;
  }

  const flows: FlowRow[] = (await listFlows()).map((flow) => ({
    id: flow.id,
    name: flow.name,
    code: flow.code,
    category: flow.category,
    latestVersion: flow.latestVersion,
    activeVersion: flow.activeVersion,
    nodeCount: flow.nodeCount,
    templateCount: flow.templateCount,
    instanceCount: flow.instanceCount,
    updatedAtLabel: new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(flow.updatedAt),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="审批流程"
        description="草稿可反复修改，发布后生成不可变版本；在合同模板中选择流程即可生效。"
      />
      <FlowManager
        flows={flows}
        canCreate={canCreate}
        canManage={canManage}
        canPublish={canPublish}
      />
    </div>
  );
}
