"use server";

import { revalidatePath } from "next/cache";
import { ERROR_CODES, type ActionResult } from "@/shared/errors";
import { attachmentKindSchema } from "@/shared/schemas/attachment";
import { requirePermission } from "@/server/auth/access";
import { requireAuth } from "@/server/auth/session";
import {
  deleteAttachment,
  uploadAttachment,
} from "@/server/services/attachment";
import { toFailure } from "./helpers";

export async function uploadAttachmentAction(
  formData: FormData,
): Promise<ActionResult<{ id: string; name: string }>> {
  let access;
  try {
    const { user } = await requireAuth();
    access = await requirePermission(user.id, "contract.update");
  } catch (error) {
    return toFailure(error);
  }

  const contractId = formData.get("contractId");
  if (typeof contractId !== "string" || contractId.trim() === "") {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: "缺少合同标识",
    };
  }

  const kind = attachmentKindSchema.safeParse(formData.get("kind"));
  if (!kind.success) {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: "附件类型不正确",
    };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: "请选择要上传的文件",
      fields: { file: "请选择要上传的文件" },
    };
  }

  try {
    const result = await uploadAttachment(access, {
      contractId,
      kind: kind.data,
      file,
    });
    revalidatePath(`/contracts/${contractId}`);
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}

export async function deleteAttachmentAction(
  attachmentId: string,
): Promise<ActionResult<{ id: string }>> {
  let access;
  try {
    const { user } = await requireAuth();
    access = await requirePermission(user.id, "contract.update");
  } catch (error) {
    return toFailure(error);
  }

  try {
    const result = await deleteAttachment(access, attachmentId);
    revalidatePath(`/contracts/${result.contractId}`);
    return { ok: true, data: { id: result.id } };
  } catch (error) {
    return toFailure(error);
  }
}
