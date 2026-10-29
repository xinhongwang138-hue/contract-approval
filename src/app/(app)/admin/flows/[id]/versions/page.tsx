import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import { getFlow, listFlowVersions } from "@/server/services/flow";
import { AppError, ERROR_CODES } from "@/shared/errors";
import { formatDateTime } from "@/shared/datetime";

export const metadata = { title: "流程版本" };

export default async function FlowVersionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);

  if (
    !access.permissions.has("flow.manage") &&
    !access.permissions.has("flow.create") &&
    !access.permissions.has("flow.publish")
  ) {
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

  const versions = await listFlowVersions(flow.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`版本历史 · ${flow.name}`}
        description="发布后的版本定义不可修改；在途实例始终按启动时冻结的快照流转。"
        actions={
          <Button asChild variant="outline">
            <Link href={`/admin/flows/${flow.id}/builder`}>回到配置器</Link>
          </Button>
        }
      />

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>版本</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">节点数</TableHead>
              <TableHead className="text-right">在途实例</TableHead>
              <TableHead>发布人</TableHead>
              <TableHead>发布时间</TableHead>
              <TableHead>定义</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-12 text-center text-muted-foreground"
                >
                  该流程还没有发布过版本。
                </TableCell>
              </TableRow>
            ) : (
              versions.map((version) => (
                <TableRow key={version.id}>
                  <TableCell className="font-medium">v{version.version}</TableCell>
                  <TableCell>
                    {version.status === "active" ? (
                      <Badge variant="secondary">在用</Badge>
                    ) : (
                      <Badge variant="outline">已归档</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{version.nodeCount}</TableCell>
                  <TableCell className="text-right">{version.instanceCount}</TableCell>
                  <TableCell className="text-sm">{version.publishedByName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(version.publishedAt)}
                  </TableCell>
                  <TableCell>
                    <details className="max-w-md">
                      <summary className="cursor-pointer text-xs text-primary">
                        查看定义 JSON
                      </summary>
                      <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted/50 p-3 text-[11px] leading-relaxed">
                        {JSON.stringify(version.definition, null, 2)}
                      </pre>
                    </details>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
