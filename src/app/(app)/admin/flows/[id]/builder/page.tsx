import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import { getFlow, listFlowActorOptions } from "@/server/services/flow";
import { AppError, ERROR_CODES } from "@/shared/errors";
import { FlowBuilder } from "./flow-builder";

export const metadata = { title: "流程配置" };

export default async function FlowBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);

  const canEdit = access.permissions.has("flow.manage");
  const canView = canEdit || access.permissions.has("flow.create") || access.permissions.has("flow.publish");
  if (!canView) {
    return <AccessDenied permission="flow.manage" />;
  }

  const { id } = await params;

  let flow;
  try {
    flow = await getFlow(id);
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.NOT_FOUND) {
      notFound();
    }
    throw error;
  }

  const actors = await listFlowActorOptions(flow.draftDefinition);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`流程配置 · ${flow.name}`}
        description="树形视图点击节点配置属性；JSON 视图改动后切回树形会自动跑校验。"
        actions={
          <Button asChild variant="outline">
            <Link href="/admin/flows">返回流程列表</Link>
          </Button>
        }
      />
      <FlowBuilder
        flowId={flow.id}
        flowName={flow.name}
        flowCode={flow.code}
        latestVersion={flow.latestVersion}
        activeVersion={flow.activeVersion}
        initialDefinition={flow.draftDefinition}
        canEdit={canEdit}
        canPublish={access.permissions.has("flow.publish")}
        roles={actors.roles}
        users={actors.users}
      />
    </div>
  );
}
