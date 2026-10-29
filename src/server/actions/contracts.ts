"use server";

import { revalidatePath } from "next/cache";
import { ERROR_CODES, type ActionResult } from "@/shared/errors";
import {
  contractDraftSchema,
  contractUpdateSchema,
} from "@/shared/schemas/contract";
import { requirePermission } from "@/server/auth/access";
import { requireAuth } from "@/server/auth/session";
import { createContract, updateContract } from "@/server/services/contract";
import { toFailure, zodFailure } from "./helpers";

function readFormData(formData: FormData): unknown {
  const raw = formData.get("formData");
  if (typeof raw !== "string" || raw.trim() === "") {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export async function saveContractAction(
  formData: FormData,
): Promise<ActionResult<{ id: string; no: string }>> {  const id = formData.get("id");
  const isUpdate = typeof id === "string" && id.trim() !== "";

  let access;
  try {
    const { user } = await requireAuth();
    access = await requirePermission(
      user.id,
      isUpdate ? "contract.update" : "contract.create",
    );
  } catch (error) {
    return toFailure(error);
  }

  const parsedFormData = readFormData(formData);
  if (parsedFormData === undefined) {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: "表单数据格式不正确",
      fields: { formData: "表单数据格式不正确" },
    };
  }

  const payload = {
    templateId: formData.get("templateId"),
    typeId: formData.get("typeId"),
    title: formData.get("title"),
    partyAId: formData.get("partyAId"),
    partyBId: formData.get("partyBId"),
    amount: formData.get("amount"),
    currency: formData.get("currency"),
    signDate: formData.get("signDate"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    formData: parsedFormData,
    bodyMarkdown: formData.get("bodyMarkdown") ?? "",
  };

  try {
    if (isUpdate) {
      const parsed = contractUpdateSchema.safeParse({ ...payload, id });
      if (!parsed.success) {
        return zodFailure(parsed.error);
      }
      const result = await updateContract(access, parsed.data);
      revalidatePath("/contracts");
      revalidatePath(`/contracts/${result.id}`);
      return { ok: true, data: result };
    }

    const parsed = contractDraftSchema.safeParse(payload);
    if (!parsed.success) {
      return zodFailure(parsed.error);
    }
    const result = await createContract(access, parsed.data);
    revalidatePath("/contracts");
    revalidatePath("/");
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}

export async function saveContractFormAction(
  _previous: ActionResult<{ id: string; no: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; no: string }>> {
  return saveContractAction(formData);
}
