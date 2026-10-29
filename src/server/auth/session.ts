import { headers } from "next/headers";
import { AppError, ERROR_CODES } from "@/shared/errors";
import { prisma } from "@/server/db/client";
import { auth } from "./auth";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  departmentId: string | null;
  managerUserId: string | null;
};

export type AuthContext = {
  sessionId: string;
  user: SessionUser;
};

export async function getAuth(): Promise<AuthContext | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      departmentId: true,
      managerUserId: true,
      status: true,
      deletedAt: true,
    },
  });

  if (!user || user.status !== "active" || user.deletedAt) {
    return null;
  }

  return {
    sessionId: session.session.id,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      departmentId: user.departmentId,
      managerUserId: user.managerUserId,
    },
  };
}

export async function requireAuth(): Promise<AuthContext> {
  const context = await getAuth();
  if (!context) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, "请先登录");
  }
  return context;
}
