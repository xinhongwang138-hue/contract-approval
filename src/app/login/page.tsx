import { redirect } from "next/navigation";
import {
  DEMO_ACCOUNTS,
  demoLoginEnabled,
  toPublicDemoAccount,
  type PublicDemoAccount,
} from "@/server/auth/demo-accounts";
import { getAuth } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { DemoLogin } from "./demo-login";
import { LoginForm } from "./login-form";

export const metadata = { title: "登录" };

/**
 * 只摆出库里真实存在且启用的演示账号：
 * 若只跑了 seed.ts 没跑 seed-demo.ts，快捷登录就不该给出一排点了会报错的按钮。
 */
async function listAvailableDemoAccounts(): Promise<PublicDemoAccount[]> {
  if (!demoLoginEnabled()) {
    return [];
  }

  const rows = await prisma.user.findMany({
    where: {
      email: { in: DEMO_ACCOUNTS.map((account) => account.email) },
      status: "active",
      deletedAt: null,
    },
    select: { email: true },
  });
  const available = new Set(rows.map((row) => row.email));

  return DEMO_ACCOUNTS.filter((account) => available.has(account.email)).map(
    toPublicDemoAccount,
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const auth = await getAuth();
  if (auth) {
    redirect("/");
  }

  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : "/";
  const demoAccounts = await listAvailableDemoAccounts();

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">合同审批系统</h1>
          <p className="text-sm text-muted-foreground">
            使用企业邮箱账号登录，请联系管理员开通账号
          </p>
        </div>
        <LoginForm next={nextPath} />
        {demoAccounts.length > 0 ? (
          <>
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">或</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <DemoLogin accounts={demoAccounts} next={nextPath} />
          </>
        ) : null}
      </div>
    </main>
  );
}
