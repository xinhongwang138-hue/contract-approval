"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { uploadAttachmentAction } from "@/server/actions/attachments";
import {
  ATTACHMENT_KIND_LABELS,
  type AttachmentKind,
} from "@/shared/schemas/attachment";

const UPLOAD_KINDS: AttachmentKind[] = ["body", "appendix", "other"];

export function AttachmentUploader({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<AttachmentKind>("appendix");
  const [inputKey, setInputKey] = useState(0);
  const [pending, startTransition] = useTransition();

  function handleUpload() {
    if (!file) {
      toast.error("请选择要上传的文件");
      return;
    }
    const data = new FormData();
    data.set("contractId", contractId);
    data.set("kind", kind);
    data.set("file", file);

    startTransition(async () => {
      const result = await uploadAttachmentAction(data);
      if (result.ok) {
        toast.success(`已上传「${result.data.name}」`);
        setFile(null);
        setInputKey((key) => key + 1);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        支持 PDF / Word / Excel / PNG / JPG，单个不超过 20MB；相同内容自动复用存储。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as AttachmentKind)}
          aria-label="附件类型"
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs"
        >
          {UPLOAD_KINDS.map((item) => (
            <option key={item} value={item}>
              {ATTACHMENT_KIND_LABELS[item]}
            </option>
          ))}
        </select>
        <input
          key={inputKey}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,application/pdf,application/msword,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/png,image/jpeg"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="block w-full max-w-xs text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:bg-transparent file:px-3 file:py-1.5 file:text-sm"
        />
        <Button
          type="button"
          variant="secondary"
          disabled={pending || !file}
          onClick={handleUpload}
        >
          <Upload className="size-4" />
          {pending ? "上传中…" : "上传"}
        </Button>
      </div>
    </div>
  );
}
