import Link from "next/link";
import {
  AlertTriangle,
  CheckSquare,
  FileText,
  Inbox,
  Send,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/shared/datetime";
import { requireAuth } from "@/server/auth/session";
import { prisma } from "@/server/db/client";

export const metadata = { title: "工作台" };

export default async function WorkbenchPage() {
  const { user } = await requireAuth();
  const now = new Date();

  const [pendingCount, myContractCount, ccCount, overdueCount, pendingTasks] =
    await Promise.all([
      prisma.flowTask.count({
        where: { assigneeId: user.id, status: "pending", deletedAt: null },
      }),
      prisma.contract.count({
        where: { createdBy: user.id, deletedAt: null },
      }),
      prisma.contractParticipant.count({
        where: {
          userId: user.id,
          kind: "cc",
          contract: { deletedAt: null },
        },
      }),
      prisma.flowTask.count({
        where: {
          assigneeId: user.id,
          status: "pending",
          dueAt: { lt: now },
          deletedAt: null,
        },
      }),
      prisma.flowTask.findMany({
        where: { assigneeId: user.id, status: "pending", deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          instanceId: true,
          dueAt: true,
          createdAt: true,
          nodeRun: { select: { nodeName: true } },
          instance: {
            select: {
              contract: { select: { id: true, no: true, title: true } },
            },
          },
        },
      }),
    ]);

  const cards = [
    {
      label: "待我审批",
      value: pendingCount,
      description: "归属你的待审批任务",
      icon: CheckSquare,
      href: "#pending-tasks",
    },
    {
      label: "我发起的",
      value: myContractCount,
      description: "由你创建的合同",
      icon: Send,
      href: "/contracts?mine=1",
    },
    {
      label: "抄送我的",
      value: ccCount,
      description: "抄送给你的合同",
      icon: Inbox,
      href: "/contracts?cc=1",
    },
    {
      label: "已超期",
      value: overdueCount,
      description: "超过处理时限的待办",
      icon: AlertTriangle,
      href: "#pending-tasks",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          你好，{user.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          今天是 {formatDateTime(now)}（Asia/Shanghai）
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.label} href={card.href} className="group">
              <Card className="transition-colors group-hover:border-foreground/20">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {card.label}
                  </CardTitle>
                  <Icon className="size-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-semibold tabular-nums">
                    {card.value}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {card.description}
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <Card id="pending-tasks">
        <CardHeader>
          <CardTitle>最近待办</CardTitle>
          <CardDescription>按到达时间倒序展示最近 5 条</CardDescription>
        </CardHeader>
        <CardContent>
          {pendingTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <FileText className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium">暂无待办</p>
              <p className="text-xs text-muted-foreground">
                有合同提交到你审批时，会出现在这里
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {pendingTasks.map((task) => {
                const overdue = task.dueAt !== null && task.dueAt < now;
                return (
                  <li key={task.id}>
                    <Link
                      href={`/approvals/${task.instanceId}`}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 hover:bg-muted/50"
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        {task.instance.contract.no}
                      </span>
                      <span className="flex-1 text-sm font-medium">
                        {task.instance.contract.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {task.nodeRun.nodeName}
                      </span>
                      {overdue ? (
                        <Badge variant="destructive">已超期</Badge>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        到达 {formatDateTime(task.createdAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
