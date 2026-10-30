import Link from "next/link";
import { Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuth } from "@/server/auth/session";
import { listNotifications } from "@/server/services/notification";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/server/actions/delegates";
import { formatDateTime } from "@/shared/datetime";

export const metadata = { title: "消息通知" };

const KIND_LABELS: Record<string, string> = {
  task: "待办",
  cc: "抄送",
  flow: "流程",
  timeout: "超时",
  // 以下三种同样由 notifyUsers() 写入，缺了就会把英文原文漏到徽标上
  seal: "用印", // lifecycle.ts 取件 / 归还
  archive: "归档", // lifecycle.ts 归档完成
  expiry: "到期", // lifecycle.ts 已到期 / 即将到期
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ unread?: string; page?: string }>;
}) {
  const { user } = await requirePageAuth();
  const params = await searchParams;
  const unreadOnly = params.unread === "1";
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const list = await listNotifications(user.id, {
    page,
    pageSize: 20,
    unreadOnly,
  });

  const buildHref = (overrides: Record<string, string | undefined>): string => {
    const query = new URLSearchParams();
    const merged = {
      unread: unreadOnly ? "1" : undefined,
      page: page > 1 ? String(page) : undefined,
      ...overrides,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value) {
        query.set(key, value);
      }
    }
    const qs = query.toString();
    return qs ? `/notifications?${qs}` : "/notifications";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="消息通知"
        description={`未读 ${list.unread} 条，共 ${list.total} 条`}
        actions={
          <form action={markAllNotificationsReadAction}>
            <Button type="submit" variant="outline" disabled={list.unread === 0}>
              全部标记已读
            </Button>
          </form>
        }
      />

      <div className="flex gap-2 text-sm">
        <Link
          href="/notifications"
          className={!unreadOnly ? "font-medium text-primary" : "text-muted-foreground"}
        >
          全部
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link
          href="/notifications?unread=1"
          className={unreadOnly ? "font-medium text-primary" : "text-muted-foreground"}
        >
          仅未读
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>通知列表</CardTitle>
        </CardHeader>
        <CardContent>
          {list.items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Bell className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium">暂无通知</p>
              <p className="text-xs text-muted-foreground">
                待办、抄送与审批结果都会以站内信形式出现在这里。
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {list.items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{KIND_LABELS[item.kind] ?? item.kind}</Badge>
                      {item.link ? (
                        <Link
                          href={item.link}
                          className="text-sm font-medium hover:underline"
                        >
                          {item.title}
                        </Link>
                      ) : (
                        <span className="text-sm font-medium">{item.title}</span>
                      )}
                      {item.readAt === null ? (
                        <span className="size-2 rounded-full bg-primary" />
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDateTime(item.createdAt)}
                    </p>
                  </div>
                  {item.readAt === null ? (
                    <form action={markNotificationReadAction.bind(null, item.id)}>
                      <Button type="submit" variant="ghost" size="sm">
                        标记已读
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {list.totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-end gap-2">
              {list.page <= 1 ? (
                <Button variant="outline" size="sm" disabled>
                  上一页
                </Button>
              ) : (
                <Button asChild variant="outline" size="sm">
                  <Link href={buildHref({ page: String(list.page - 1) })}>上一页</Link>
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                第 {list.page} / {list.totalPages} 页
              </span>
              {list.page >= list.totalPages ? (
                <Button variant="outline" size="sm" disabled>
                  下一页
                </Button>
              ) : (
                <Button asChild variant="outline" size="sm">
                  <Link href={buildHref({ page: String(list.page + 1) })}>下一页</Link>
                </Button>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
