"use server";

import { revalidatePath } from "next/cache";
import { ERROR_CODES, type ActionResult } from "@/shared/errors";
import {
  contractTemplateCreateSchema,
  contractTemplateFieldsSchema,
  contractTemplateToggleSchema,
  contractTemplateUpdateSchema,
} from "@/shared/schemas/contract-template";
import { requirePermission } from "@/server/auth/access";
import { requireAuth } from "@/server/auth/session";
import {
  createContractTemplate,
  setContractTemplateActive,
  updateContractTemplate,
  updateContractTemplateFields,
} from "@/server/services/contract-template";
import { toFailure, zodFailure } from "./helpers";

async function requireTemplateManager(): Promise<string> {
  const { user } = await requireAuth();
  await requirePermission(user.id, "flow.manage");
  return user.id;
}

function readFields(formData: FormData): unknown {
  const raw = formData.get("fields");
  if (typeof raw !== "string" || raw.trim() === "") {
    return [];
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function revalidateTemplate(id?: string): void {
  revalidatePath("/admin/templates");
  if (id) {
    revalidatePath(`/admin/templates/${id}/fields`);
  }
  revalidatePath("/contracts/new");
}

export async function saveTemplateAction(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  let actorId: string;
  try {
    actorId = await requireTemplateManager();
  } catch (error) {
    return toFailure(error);
  }

  const fields = readFields(formData);
  if (fields === undefined) {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: "字段配置格式不正确",
    };
  }

  const id = formData.get("id");
  const payload = {
    code: formData.get("code"),
    name: formData.get("name"),
    category: formData.get("category"),
    active: formData.get("active") === "true",
    fields,
  };

  try {
    if (typeof id === "string" && id.trim() !== "") {
      const parsed = contractTemplateUpdateSchema.safeParse({ ...payload, id });
      if (!parsed.success) {
        return zodFailure(parsed.error);
      }
      const result = await updateContractTemplate(parsed.data, actorId);
      revalidateTemplate(result.id);
      return { ok: true, data: result };
    }

    const parsed = contractTemplateCreateSchema.safeParse(payload);
    if (!parsed.success) {
      return zodFailure(parsed.error);
    }
    const result = await createContractTemplate(parsed.data, actorId);
    revalidateTemplate(result.id);
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}

export async function saveTemplateFieldsAction(
  id: string,
  fieldsJson: string,
): Promise<ActionResult<{ id: string }>> {
  let actorId: string;
  try {
    actorId = await requireTemplateManager();
  } catch (error) {
    return toFailure(error);
  }

  let fields: unknown;
  try {
    fields = JSON.parse(fieldsJson);
  } catch {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: "字段配置格式不正确",
    };
  }

  const parsed = contractTemplateFieldsSchema.safeParse({ id, fields });
  if (!parsed.success) {
    return zodFailure(parsed.error);
  }

  try {
    const result = await updateContractTemplateFields(
      parsed.data.id,
      parsed.data.fields,
      actorId,
    );
    revalidateTemplate(result.id);
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}

export async function toggleTemplateActiveAction(
  id: string,
  active: boolean,
): Promise<ActionResult<{ id: string }>> {
  let actorId: string;
  try {
    actorId = await requireTemplateManager();
  } catch (error) {
    return toFailure(error);
  }

  const parsed = contractTemplateToggleSchema.safeParse({ id, active });
  if (!parsed.success) {
    return zodFailure(parsed.error);
  }

  try {
    const result = await setContractTemplateActive(
      parsed.data.id,
      parsed.data.active,
      actorId,
    );
    revalidateTemplate(result.id);
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}
