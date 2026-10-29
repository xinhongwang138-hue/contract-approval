"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Send } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { submitContractAction } from "@/server/actions/approvals";
import type { FlowPreview } from "@/server/services/approval";

export function SubmitContractPanel({
  contractId,
  preview,
  error,
}: {
  contractId: string;
  preview: FlowPreview | null;
  error: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const blocked = error !== null || (preview?.blocking.length ?? 0) > 0;

  function handleSubmit(): void {
    startTransition(async () => {
      const result = await submitContractAction(contractId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("已提交审批");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Send className="size-4" />
        提交审批
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>审批流预览</DialogTitle>
            <DialogDescription>
              {preview
                ? `流程「${preview.flowName}」v${preview.version}（${preview.flowCode}），提交后按此链路生成待办。`
                : "无法解析该合同模板关联的审批流。"}
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>无法提交</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {preview ? (
            <div className="space-y-3">
              <ol className="space-y-2">
                {preview.nodes.map((node, index) => (
                  <li
                    key={node.nodeId}
                    className="rounded-md border bg-card p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {index + 1}
                      </span>
                      <span className="font-medium">{node.name}</span>
                      <Badge variant="outline">{node.summary}</Badge>
                      {node.type === "cc" ? (
                        <Badge variant="outline">不阻塞</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      审批人：
                      {node.assigneeNames.length > 0
                        ? node.assigneeNames.join("、")
                        : "（解析不到人员）"}
                      {node.dynamic ? " · 运行时按表单/组织解析" : ""}
                    </p>
                    {node.messages.map((message) => (
                      <p key={message} className="mt-1 text-xs text-amber-700">
                        {message}
                      </p>
                    ))}
                  </li>
                ))}
              </ol>

              {preview.blocking.length > 0 ? (
                <Alert variant="destructive">
                  <AlertTitle>提交前需要先解决 {preview.blocking.length} 项问题</AlertTitle>
                  <AlertDescription>
                    <ul className="mt-1 space-y-1">
                      {preview.blocking.map((message) => (
                        <li key={message} className="flex items-start gap-2 text-xs">
                          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                          {message}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}

              {preview.warnings.length > 0 ? (
                <Alert>
                  <AlertTitle>提示 {preview.warnings.length} 项</AlertTitle>
                  <AlertDescription>
                    <ul className="mt-1 space-y-1">
                      {preview.warnings.map((message) => (
                        <li key={message} className="flex items-start gap-2 text-xs">
                          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                          {message}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}

          <DialogFooter className="sticky -bottom-4 z-10 bg-muted">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                取消
              </Button>
            </DialogClose>
            <Button onClick={handleSubmit} disabled={pending || blocked || !preview}>
              {pending ? "提交中…" : "确认提交"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
