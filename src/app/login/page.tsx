import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "登录" };

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

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">合同审批系统</h1>
          <p className="text-sm text-muted-foreground">
            使用企业邮箱账号登录，请联系管理员开通账号
          </p>
        </div>
        <LoginForm next={typeof next === "string" ? next : "/"} />
      </div>
    </main>
  );
}
