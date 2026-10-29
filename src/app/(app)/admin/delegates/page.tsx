import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import { listDelegates } from "@/server/services/delegate";
import { toDateInputValue } from "@/shared/datetime";
import { DelegateManager, type DelegateRow } from "./delegate-manager";

export const metadata = { title: "审批委托" };

export default async function DelegatesPage() {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);

  const canManageAll = access.permissions.has("system.user.manage");
  if (!canManageAll && !access.permissions.has("contract.approve")) {
    return <AccessDenied permission="contract.approve" />;
  }

  const delegates = await listDelegates(access);

  const rows: DelegateRow[] = delegates.map((delegate) => ({
    id: delegate.id,
    from: delegate.from,
    to: delegate.to,
    permissionKeys: delegate.permissionKeys,
    startLabel: toDateInputValue(delegate.startAt),
    endLabel: toDateInputValue(delegate.endAt),
    reason: delegate.reason,
    state: delegate.state,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="审批委托"
        description="委托期内受托人可代为处理委托人的审批待办，操作仍记录真实执行人。"
      />
      <DelegateManager
        rows={rows}
        selfUser={{
          id: user.id,
          name: user.name,
          email: user.email,
          departmentName: null,
        }}
        canPickPrincipal={canManageAll}
      />
    </div>
  );
}
