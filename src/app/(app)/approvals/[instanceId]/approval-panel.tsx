"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CornerUpLeft, RotateCcw, Send, Undo2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UserPicker } from "@/components/user-picker";
import type { UserOption } from "@/server/actions/user-search";
import {
  addSignAction,
  decideTaskAction,
  transferTaskAction,
  withdrawInstanceAction,
} from "@/server/actions/approvals";
import type { ApprovalDetailView } from "@/server/services/approval-view";
import {
  ADD_SIGN_TYPE_LABELS,
  FLOW_NODE_TYPE_LABELS,
  NODE_RUN_STATUS_LABELS,
  TASK_ACTION_LABELS,
  TASK_STATUS_LABELS,
} from "@/shared/flow-definition";

type PanelMode = "approve" | "reject" | "return" | "addSign" | "transfer" | "withdraw" | null;

const MODE_TITLES: Record<Exclude<PanelMode, null>, string> = {
  approve: "同意审批",
  reject: "驳回合同",
  return: "退回修改",
  addSign: "加签",
  transfer: "转签",
  withdraw: "撤回提交",
};

const ADD_SIGN_LABELS: Record<string, string> = {
  before: "前加签（先由他人出意见，再回到我）",
  after: "后加签（我处理后追加他人复核）",
  parallel: "并加签（追加他人同时处理）",
};

export function ApprovalPanel({ detail }: { detail: ApprovalDetailView }) {
  const router = useRouter();
  const [mode, setMode] = useState<PanelMode>(null);
  const [opinion, setOpinion] = useState("");
  const [reason, setReason] = useState("");
  const [position, setPosition] = useState<"before" | "after" | "parallel">("before");
  const [transferTarget, setTransferTarget] = useState<UserOption | null>(null);
  const [addSignUsers, setAddSignUsers] = useState<UserOption[]>([]);
  const [pending, startTransition] = useTransition();

  const task = detail.myTask;
  const capabilities = task?.capabilities;
  const needsOpinion = (action: "approve" | "reject" | "return"): boolean =>
    action === "return" || Boolean(capabilities?.requiredOpinionOn.includes(action));

  function close(): void {
    setMode(null);
    setOpinion("");
    setReason("");
    setTransferTarget(null);
    setAddSignUsers([]);
  }

  function run(action: () => Promise<{ ok: boolean; message?: string }>): void {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(
          mode === "approve"
            ? "已同意"
            : mode === "reject"
              ? "已驳回"
              : mode === "return"
                ? "已退回修改"
                : mode === "withdraw"
                  ? "已撤回提交"
                  : "操作成功",
        );
        close();
        router.refresh();
        return;
      }
      toast.error(result.message ?? "操作失败");
    });
  }

  function submitDecision(action: "approve" | "reject" | "return"): void {
    const data = new FormData();
    data.set("taskId", task?.taskId ?? "");
    data.set("action", action);
    data.set("opinion", opinion.trim());
    run(() => decideTaskAction(data));
  }

  function submitAddSign(): void {
    if (addSignUsers.length === 0) {
      toast.error("请选择加签人");
      return;
    }
    const data = new FormData();
    data.set("taskId", task?.taskId ?? "");
    data.set("position", position);
    data.set("reason", reason.trim());
    for (const user of addSignUsers) {
      data.append("assigneeIds", user.id);
    }
    run(() => addSignAction(data));
  }

  function submitTransfer(): void {
    if (!transferTarget) {
      toast.error("请选择转签对象");
      return;
    }
    const data = new FormData();
    data.set("taskId", task?.taskId ?? "");
    data.set("targetUserId", transferTarget.id);
    data.set("reason", reason.trim());
    run(() => transferTaskAction(data));
  }

  function submitWithdraw(): void {
    run(() => withdrawInstanceAction(detail.instance.id));
  }

  const canAct = task !== null && task.status === "pending";

  return (
    <div className="space-y-3">
      {task?.actedAs ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          该任务属于 {task.actedAs}，你在生效委托期内代为处理，操作将记录你的账号。
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canAct ? (
          <>
            <Button size="sm" onClick={() => setMode("approve")}>
              <Send className="size-4" />
              同意
            </Button>
            {capabilities?.return ? (
              <Button size="sm" variant="outline" onClick={() => setMode("return")}>
                <RotateCcw className="size-4" />
                退回修改
              </Button>
            ) : null}
            <Button size="sm" variant="destructive" onClick={() => setMode("reject")}>
              <CornerUpLeft className="size-4" />
              驳回
            </Button>
            {capabilities && capabilities.addSign.length > 0 ? (
              <Button size="sm" variant="outline" onClick={() => setMode("addSign")}>
                <UserPlus className="size-4" />
                加签
              </Button>
            ) : null}
            {capabilities?.transfer ? (
              <Button size="sm" variant="outline" onClick={() => setMode("transfer")}>
                转签
              </Button>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {task
              ? `你已处理该节点（${task.status === "approved" ? "同意" : task.status === "rejected" ? "驳回" : task.status}），等待其他审批人。`
              : "你没有该节点的待办，只能查看审批轨迹。"}
          </p>
        )}
        {detail.canWithdraw ? (
          <Button size="sm" variant="ghost" onClick={() => setMode("withdraw")}>
            <Undo2 className="size-4" />
            撤回提交
          </Button>
        ) : null}
      </div>

      {detail.withdrawBlockedReason ? (
        <p className="text-xs text-muted-foreground">{detail.withdrawBlockedReason}</p>
      ) : null}

      <Dialog open={mode !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{mode ? MODE_TITLES[mode] : ""}</DialogTitle>
            <DialogDescription>
              {mode === "withdraw"
                ? "撤回后合同回到草稿，审批轨迹保留；一旦有人处理过就无法撤回。"
                : `节点：${task?.nodeName ?? detail.instance.flowName}`}
            </DialogDescription>
          </DialogHeader>

          {mode === "approve" || mode === "reject" || mode === "return" ? (
            <div className="grid gap-2">
              <Label htmlFor="decision-opinion">
                审批意见
                {needsOpinion(mode) ? (
                  <span className="ml-1 text-destructive">*</span>
                ) : (
                  <span className="ml-1 text-muted-foreground">（选填）</span>
                )}
              </Label>
              <Textarea
                id="decision-opinion"
                rows={4}
                value={opinion}
                placeholder={
                  mode === "approve"
                    ? "例如：条款与预算均已核对，同意。"
                    : mode === "reject"
                      ? "请写明驳回原因，便于发起人修改"
                      : "请写明需要补充的内容"
                }
                onChange={(event) => setOpinion(event.target.value)}
              />
            </div>
          ) : null}

          {mode === "addSign" ? (
            <div className="space-y-3">
              <div className="grid gap-2">
                <Label htmlFor="addsign-position">加签方式</Label>
                <select
                  id="addsign-position"
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs"
                  value={position}
                  onChange={(event) =>
                    setPosition(event.target.value as typeof position)
                  }
                >
                  {(capabilities?.addSign ?? []).map((item) => (
                    <option key={item} value={item}>
                      {ADD_SIGN_LABELS[item] ?? item}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="addsign-search">加签人</Label>
                <UserPicker
                  id="addsign-search"
                  multi
                  max={5}
                  selected={addSignUsers}
                  onChange={setAddSignUsers}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="addsign-reason">加签原因</Label>
                <Textarea
                  id="addsign-reason"
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
            </div>
          ) : null}

          {mode === "transfer" ? (
            <div className="space-y-3">
              <div className="grid gap-2">
                <Label htmlFor="transfer-search">转签给</Label>
                <UserPicker
                  id="transfer-search"
                  multi={false}
                  selected={transferTarget ? [transferTarget] : []}
                  onChange={(next) => setTransferTarget(next[0] ?? null)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="transfer-reason">转签原因</Label>
                <Textarea
                  id="transfer-reason"
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                转签不改变节点判定口径：你的任务变为已转签，接手人处理后才计入节点结论。
              </p>
            </div>
          ) : null}

          {mode === "withdraw" ? (
            <p className="text-sm text-muted-foreground">
              确认撤回《{detail.contract.title}》的本次提交？
            </p>
          ) : null}

          <DialogFooter className="sticky -bottom-4 z-10 bg-muted">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                取消
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={pending}
              variant={mode === "reject" ? "destructive" : "default"}
              onClick={() => {
                if (mode === "approve" || mode === "reject" || mode === "return") {
                  if (needsOpinion(mode) && opinion.trim() === "") {
                    toast.error("该节点必须填写审批意见");
                    return;
                  }
                  submitDecision(mode);
                  return;
                }
                if (mode === "addSign") {
                  submitAddSign();
                  return;
                }
                if (mode === "transfer") {
                  submitTransfer();
                  return;
                }
                submitWithdraw();
              }}
            >
              {pending ? "提交中…" : mode === "withdraw" ? "确认撤回" : "确认提交"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function TrailList({ trail }: { trail: ApprovalDetailView["trail"] }) {
  return (
    <ol className="space-y-4">
      {trail.map((entry) => (
        <li key={entry.nodeRunId} className="flex gap-3">
          <span
            className={[
              "mt-1 size-2.5 shrink-0 rounded-full",
              entry.status === "approved"
                ? "bg-emerald-500"
                : entry.status === "rejected"
                  ? "bg-destructive"
                  : entry.status === "cancelled"
                    ? "bg-muted-foreground/40"
                    : entry.status === "running"
                      ? "bg-primary"
                      : "bg-border",
            ].join(" ")}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{entry.nodeName}</span>
              <Badge variant="outline">
                {FLOW_NODE_TYPE_LABELS[entry.nodeType as keyof typeof FLOW_NODE_TYPE_LABELS] ??
                  entry.nodeType}
              </Badge>
              <Badge
                variant={
                  entry.status === "approved"
                    ? "secondary"
                    : entry.status === "rejected"
                      ? "destructive"
                      : "outline"
                }
              >
                {NODE_RUN_STATUS_LABELS[entry.status] ?? entry.status}
              </Badge>
            </div>
            <ul className="mt-1 space-y-1">
              {entry.tasks.map((task) => (
                <li key={task.id} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{task.assigneeName}</span>
                  {" · "}
                  {TASK_STATUS_LABELS[task.status] ?? task.status}
                  {task.action
                    ? `（${TASK_ACTION_LABELS[task.action] ?? task.action}）`
                    : ""}
                  {task.decidedAt
                    ? ` · ${formatDateTimeShort(task.decidedAt)}`
                    : task.dueAt
                      ? ` · 截止 ${formatDateTimeShort(task.dueAt)}`
                      : ""}
                  {task.addSignType
                    ? ` · ${ADD_SIGN_TYPE_LABELS[task.addSignType] ?? task.addSignType}`
                    : ""}
                  {task.opinion ? (
                    <p className="mt-0.5 rounded bg-muted/60 px-2 py-1 text-foreground">
                      {task.opinion}
                    </p>
                  ) : null}
                </li>
              ))}
              {entry.tasks.length === 0 ? (
                <li className="text-xs text-muted-foreground">该节点无待办人员</li>
              ) : null}
            </ul>
          </div>
        </li>
      ))}
    </ol>
  );
}

function formatDateTimeShort(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}
