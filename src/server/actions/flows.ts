"use server";

import { revalidatePath } from "next/cache";
import { ERROR_CODES, type ActionResult } from "@/shared/errors";
import {
  flowCreateSchema,
  flowDraftSchema,
  flowIdSchema,
  flowUpdateSchema,
} from "@/shared/schemas/flow";
import { requirePermission } from "@/server/auth/access";
import { requireAuth } from "@/server/auth/session";
import {
  createFlow,
  deleteFlow,
  publishFlow,
  saveFlowDraft,
  setTemplateFlow,
  updateFlow,
} from "@/server/services/flow";
import type { FlowValidationIssue } from "@/server/flow/validate";
import { toFailure, zodFailure } from "./helpers";

async function requireFlowActor(permission: "flow.create" | "flow.manage" | "flow.publish"): Promise<string> {
  const { user } = await requireAuth();
  await requirePermission(user.id, permission);
  return user.id;
}

function revalidateFlow(id?: string): void {
  revalidatePath("/admin/flows");
  if (id) {
    revalidatePath(`/admin/flows/${id}/builder`);
    revalidatePath(`/admin/flows/${id}/versions`);
  }
  revalidatePath("/admin/templates");
}

export async function saveFlowMetaAction(
  formData: FormData,
): Promise<ActionResult<{ id: string; code?: string }>> {
  const id = formData.get("id");

  if (typeof id === "string" && id.trim() !== "") {
    let actorId: string;
    try {
      actorId = await requireFlowActor("flow.manage");
    } catch (error) {
      return toFailure(error);
    }

    const parsed = flowUpdateSchema.safeParse({
      id,
      name: formData.get("name"),
      category: formData.get("category"),
    });
    if (!parsed.success) {
      return zodFailure(parsed.error);
    }

    try {
      const result = await updateFlow(parsed.data, actorId);
      revalidateFlow(result.id);
      return { ok: true, data: result };
    } catch (error) {
      return toFailure(error);
    }
  }

  let actorId: string;
  try {
    actorId = await requireFlowActor("flow.create");
  } catch (error) {
    return toFailure(error);
  }

  const parsed = flowCreateSchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    category: formData.get("category"),
  });
  if (!parsed.success) {
    return zodFailure(parsed.error);
  }

  try {
    const result = await createFlow(parsed.data, actorId);
    revalidateFlow(result.id);
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}

export async function saveFlowDraftAction(
  id: string,
  definitionJson: string,
): Promise<ActionResult<{ id: string; issues: FlowValidationIssue[] }>> {
  let actorId: string;
  try {
    actorId = await requireFlowActor("flow.manage");
  } catch (error) {
    return toFailure(error);
  }

  let definition: unknown;
  try {
    definition = JSON.parse(definitionJson);
  } catch {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: "流程定义不是合法的 JSON",
    };
  }

  const parsed = flowDraftSchema.safeParse({ id, definition });
  if (!parsed.success) {
    return zodFailure(parsed.error);
  }

  try {
    const result = await saveFlowDraft(parsed.data, actorId);
    revalidateFlow(result.id);
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}

export async function publishFlowAction(
  id: string,
): Promise<ActionResult<{ id: string; version: number }>> {
  let actorId: string;
  try {
    actorId = await requireFlowActor("flow.publish");
  } catch (error) {
    return toFailure(error);
  }

  const parsed = flowIdSchema.safeParse({ id });
  if (!parsed.success) {
    return zodFailure(parsed.error);
  }

  try {
    const result = await publishFlow(parsed.data.id, actorId);
    revalidateFlow(result.id);
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}

export async function deleteFlowAction(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  let actorId: string;
  try {
    actorId = await requireFlowActor("flow.manage");
  } catch (error) {
    return toFailure(error);
  }

  const parsed = flowIdSchema.safeParse({ id });
  if (!parsed.success) {
    return zodFailure(parsed.error);
  }

  try {
    const result = await deleteFlow(parsed.data.id, actorId);
    revalidateFlow();
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}

export async function bindTemplateFlowAction(
  templateId: string,
  flowId: string | null,
): Promise<ActionResult<{ templateId: string; flowId: string | null }>> {
  let actorId: string;
  try {
    actorId = await requireFlowActor("flow.manage");
  } catch (error) {
    return toFailure(error);
  }

  try {
    const result = await setTemplateFlow(templateId, flowId, actorId);
    revalidateFlow();
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}
