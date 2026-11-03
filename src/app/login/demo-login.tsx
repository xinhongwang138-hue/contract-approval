"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { demoLoginAction, type LoginFormState } from "@/server/actions/auth";
// 只取类型：编译后这行会被完全擦除，含口令的模块不会进入客户端 bundle
import type { PublicDemoAccount } from "@/server/auth/demo-accounts";

function DemoAccountButton({ account }: { account: PublicDemoAccount }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="outline"
      disabled={pending}
      // h-full 让同一行的两个按钮等高：grid 只拉伸 form，按钮本身得自己填满
      className="h-full w-full flex-col items-start gap-0.5 px-3 py-2 text-left whitespace-normal"
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="text-sm font-medium">{account.name}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {pending ? "登录中…" : account.roleLabel}
        </span>
      </span>
      <span className="text-xs font-normal text-muted-foreground">
        {account.deptLabel} · {account.scopeLabel}
      </span>
    </Button>
  );
}

export function DemoLogin({
  accounts,
  next,
}: {
  accounts: PublicDemoAccount[];
  next: string;
}) {
  const [state, formAction] = useActionState<LoginFormState, FormData>(
    demoLoginAction,
    null,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>演示快捷登录</CardTitle>
        <CardDescription>点角色直接进入，无需输入口令</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 窄屏单列：两列时「基础运维部 · 本部门及下级」会被挤到折行 */}
        <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
          {accounts.map((account) => (
            <form key={account.email} action={formAction} className="h-full">
              <input type="hidden" name="account" value={account.email} />
              <input type="hidden" name="next" value={next} />
              <DemoAccountButton account={account} />
            </form>
          ))}
        </div>
        {state && !state.ok ? (
          <Alert variant="destructive">
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}
        <p className="text-xs text-muted-foreground">
          这些也是真实账号，口令见 README「演示账号」一节。
        </p>
      </CardContent>
    </Card>
  );
}
