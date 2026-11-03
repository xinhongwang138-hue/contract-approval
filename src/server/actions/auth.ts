"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ERROR_CODES, type ErrorCode } from "@/shared/errors";
import { loginSchema } from "@/shared/schemas/auth";
import { auth } from "@/server/auth/auth";
import { demoLoginEnabled, findDemoAccount } from "@/server/auth/demo-accounts";
import { prisma } from "@/server/db/client";
import { logger } from "@/server/logger";

const MAX_FAILURES = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;

export type LoginFormState = {
  ok: false;
  code: ErrorCode;
  message: string;
} | null;

type AuthOutcome =
  | { ok: true; userId: string }
  | { ok: false; code: ErrorCode; message: string };

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

/**
 * 邮箱口令登录的唯一入口：锁定检查、账号状态校验、登录流水、better-auth 调用都在这里。
 * 手动登录与演示快捷登录共用，避免两套流程在「失败计数」「成功流水」上出现偏差。
 */
async function authenticate(
  email: string,
  password: string,
  ip: string,
  requestHeaders: Headers,
): Promise<AuthOutcome> {
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
  return { ok: true, userId: user.id };
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

  const requestHeaders = await headers();
  const outcome = await authenticate(
    parsed.data.email,
    parsed.data.password,
    clientIp(requestHeaders),
    requestHeaders,
  );

  if (!outcome.ok) {
    return { ok: false, code: outcome.code, message: outcome.message };
  }

  redirect(safeNextPath(formData.get("next")));
}

/**
 * 演示快捷登录：只接受白名单里的账号，口令由服务端补上。
 * 开关关闭时（生产环境默认）直接拒绝 —— 前端不渲染入口，服务端也不放行。
 */
export async function demoLoginAction(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  if (!demoLoginEnabled()) {
    return {
      ok: false,
      code: ERROR_CODES.FORBIDDEN,
      message: "演示快捷登录未启用",
    };
  }

  const account = findDemoAccount(String(formData.get("account") ?? ""));
  if (!account) {
    return {
      ok: false,
      code: ERROR_CODES.UNAUTHENTICATED,
      message: "该账号不在演示名单内",
    };
  }

  const requestHeaders = await headers();
  const outcome = await authenticate(
    account.email,
    account.password,
    clientIp(requestHeaders),
    requestHeaders,
  );

  if (!outcome.ok) {
    return { ok: false, code: outcome.code, message: outcome.message };
  }

  logger.info({ email: account.email }, "demo login succeeded");
  redirect(safeNextPath(formData.get("next")));
}

export async function logoutAction(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
