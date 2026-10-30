import Link from "next/link";
import {
  AlertTriangle,
  CheckSquare,
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
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime } from "@/shared/datetime";
import { formatMoney } from "@/shared/money";
import { contractStatusLabel } from "@/shared/contract-status";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import { getWorkbench } from "@/server/services/approval";
import { countUnreadNotifications } from "@/server/services/notification";

export const metadata = { title: "工作台" };

export default async function WorkbenchPage() {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);
  const now = new Date();

  const [workbench, unread] = await Promise.all([
    getWorkbench(access, now),
    countUnreadNotifications(user.id),
  ]);

  const cards = [
    {
      key: "pending",
      label: "待我审批",
      value: workbench.counts.pending,
      description: "含受托代办的合同",
      icon: CheckSquare,
      href: "#pending-tasks",
    },
    {
      key: "initiated",
      label: "我发起的",
      value: workbench.counts.initiated,
      description: "在途审批的合同",
      icon: Send,
      href: "#initiated",
    },
    {
      key: "cc",
      label: "抄送我的",
      value: workbench.counts.cc,
      description: "抄送给我备案的合同",
      icon: Inbox,
      href: "#cc",
    },
    {
      key: "overdue",
      label: "已超期",
      value: workbench.counts.overdue,
      description: "超过处理时限的待办",
      icon: AlertTriangle,
      href: "#overdue",
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            你好，{user.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            今天是 {formatDateTime(now)}（Asia/Shanghai）
          </p>
        </div>
        <Link
          href="/notifications"
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          消息通知
          {unread > 0 ? (
            <Badge variant="destructive" className="ml-2">
              {unread}
            </Badge>
          ) : null}
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          const tone =
            card.value === 0
              ? "text-muted-foreground/70"
              : card.key === "overdue"
                ? "text-destructive"
                : "text-foreground";
          return (
            <Link key={card.key} href={card.href} className="group">
              <Card className="transition-colors group-hover:border-foreground/20">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {card.label}
                  </CardTitle>
                  <Icon className={cn("size-4", tone)} />
                </CardHeader>
                <CardContent>
                  <p className={cn("text-3xl font-semibold tabular-nums", tone)}>
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
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>待办明细</CardTitle>
            <CardDescription>按到期时间优先，逾期置顶</CardDescription>
          </div>
          <Link href="/contracts" className="text-sm text-primary hover:underline">
            合同台账
          </Link>
        </CardHeader>
        <CardContent>
          {workbench.pending.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              暂无待办，有合同提交到你审批时会出现在这里。
            </p>
          ) : (
            <ul className="divide-y">
              {workbench.pending.map((item) => (
                <li key={item.taskId}>
                  <Link
                    href={`/approvals/${item.instanceId}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 hover:bg-muted/50"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {item.contractNo}
                    </span>
                    <span className="flex-1 text-sm font-medium">{item.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {item.nodeName} · {formatMoney(item.amount, item.currency)}
                    </span>
                    {item.delegated ? <Badge variant="outline">受托代办</Badge> : null}
                    {item.overdue ? <Badge variant="destructive">已超期</Badge> : null}
                    {item.dueAt ? (
                      <span className="text-xs text-muted-foreground">
                        截止 {formatDateTime(item.dueAt)}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card id="initiated">
          <CardHeader>
            <CardTitle>我发起的</CardTitle>
            <CardDescription>在途审批的合同与当前节点</CardDescription>
          </CardHeader>
          <CardContent>
            {workbench.initiated.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                暂无在途合同。
              </p>
            ) : (
              <ul className="divide-y">
                {workbench.initiated.map((item) => (
                  <li key={item.instanceId} className="py-3">
                    <Link
                      href={`/contracts/${item.contractId}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {item.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{item.contractNo}</span>
                      <Badge variant="outline">
                        {contractStatusLabel(item.contractStatus)}
                      </Badge>
                      <span>{formatMoney(item.amount, item.currency)}</span>
                      <span>
                        当前节点：
                        {item.currentNodeNames.length > 0
                          ? item.currentNodeNames.join("、")
                          : "—"}
                      </span>
                      <span>提交 {formatDate(item.startedAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card id="cc">
          <CardHeader>
            <CardTitle>抄送我的</CardTitle>
            <CardDescription>只需备案查阅，不需要处理</CardDescription>
          </CardHeader>
          <CardContent>
            {workbench.cc.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                暂无抄送。
              </p>
            ) : (
              <ul className="divide-y">
                {workbench.cc.map((item) => (
                  <li key={item.contractId} className="py-3">
                    <Link
                      href={`/contracts/${item.contractId}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {item.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{item.contractNo}</span>
                      <Badge variant="outline">
                        {contractStatusLabel(item.contractStatus)}
                      </Badge>
                      <span>{formatMoney(item.amount, item.currency)}</span>
                      <span>{formatDate(item.createdAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {workbench.overdue.length > 0 ? (
        <Card id="overdue">
          <CardHeader>
            <CardTitle>已超期待办</CardTitle>
            <CardDescription>超过节点设定时限，请尽快处理</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {workbench.overdue.map((item) => (
                <li key={item.taskId}>
                  <Link
                    href={`/approvals/${item.instanceId}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 hover:bg-muted/50"
                  >
                    <Badge variant="destructive">超期</Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {item.contractNo}
                    </span>
                    <span className="flex-1 text-sm font-medium">{item.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {item.nodeName} · 截止 {formatDateTime(item.dueAt ?? item.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
