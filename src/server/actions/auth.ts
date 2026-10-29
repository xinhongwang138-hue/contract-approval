"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ERROR_CODES, type ErrorCode } from "@/shared/errors";
import { loginSchema } from "@/shared/schemas/auth";
import { auth } from "@/server/auth/auth";
import { prisma } from "@/server/db/client";
import { logger } from "@/server/logger";

const MAX_FAILURES = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;

export type LoginFormState = {
  ok: false;
  code: ErrorCode;
  message: string;
} | null;

function clientIp(requestHeaders: Headers): string {
  const forwarded = requestHeaders.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return requestHeaders.get("x-real-ip")?.trim() || "unknown";
}

function safeNextPath(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

export async function loginAction(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: parsed.error.issues[0]?.message ?? "请输入正确的登录信息",
    };
  }

  const { email, password } = parsed.data;
  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);
  const lockWindowStart = new Date(Date.now() - LOCK_WINDOW_MS);

  const recentFailures = await prisma.loginAttempt.count({
    where: {
      success: false,
      createdAt: { gte: lockWindowStart },
      OR: [{ email }, { ip }],
    },
  });

  if (recentFailures >= MAX_FAILURES) {
    return {
      ok: false,
      code: ERROR_CODES.RATE_LIMITED,
      message: "登录失败次数过多，请 15 分钟后再试",
    };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, status: true, deletedAt: true },
  });

  if (!user || user.status !== "active" || user.deletedAt) {
    await prisma.loginAttempt.create({ data: { email, ip, success: false } });
    return {
      ok: false,
      code: ERROR_CODES.UNAUTHENTICATED,
      message: "邮箱或密码错误",
    };
  }

  try {
    await auth.api.signInEmail({
      body: { email, password },
      headers: requestHeaders,
    });
  } catch (error) {
    await prisma.loginAttempt.create({ data: { email, ip, success: false } });
    if (error instanceof APIError) {
      logger.info({ email, ip, status: error.status }, "login rejected");
      return {
        ok: false,
        code: ERROR_CODES.UNAUTHENTICATED,
        message: "邮箱或密码错误",
      };
    }
    logger.error({ err: error, email }, "login failed unexpectedly");
    return {
      ok: false,
      code: ERROR_CODES.INTERNAL,
      message: "登录失败，请稍后再试",
    };
  }

  await prisma.loginAttempt.create({ data: { email, ip, success: true } });
  logger.info({ userId: user.id, ip }, "login succeeded");
  redirect(safeNextPath(formData.get("next")));
}

export async function logoutAction(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
