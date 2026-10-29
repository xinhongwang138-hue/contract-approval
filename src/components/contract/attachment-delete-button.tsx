"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { deleteAttachmentAction } from "@/server/actions/attachments";

export function AttachmentDeleteButton({
  attachmentId,
  name,
}: {
  attachmentId: string;
  name: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteAttachmentAction(attachmentId);
      if (result.ok) {
        toast.success(`已删除「${name}」`);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`删除附件 ${name}`}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4 text-destructive" />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除附件「{name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后合同详情不再展示该附件，已存储的文件保留用于内容去重。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                handleDelete();
              }}
            >
              {pending ? "删除中…" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
