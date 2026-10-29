import { prisma } from "@/server/db/client";

export type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
};

export type NotificationList = {
  items: NotificationItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  unread: number;
};

export async function listNotifications(
  userId: string,
  input: { page: number; pageSize: number; unreadOnly: boolean },
): Promise<NotificationList> {
  const where = {
    userId,
    ...(input.unreadOnly ? { readAt: null } : {}),
  };

  const [rows, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ readAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        link: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  return {
    items: rows,
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
    unread,
  };
}

export async function markNotificationRead(userId: string, id: string): Promise<{ id: string }> {
  const updated = await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
  if (updated.count === 0) {
    const existing = await prisma.notification.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) {
      return { id };
    }
  }
  return { id };
}

export async function markAllNotificationsRead(userId: string): Promise<{ count: number }> {
  const updated = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { count: updated.count };
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}
