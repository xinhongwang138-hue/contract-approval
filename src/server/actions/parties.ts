"use server";

import { revalidatePath } from "next/cache";
import { ERROR_CODES, type ActionFailure, type ActionResult } from "@/shared/errors";
import { partyFormSchema, partyUpdateSchema } from "@/shared/schemas/party";
import { requirePermission } from "@/server/auth/access";
import { requireAuth } from "@/server/auth/session";
import {
  createParty,
  deleteParty,
  updateParty,
} from "@/server/services/party";
import { toFailure, zodFailure } from "./helpers";

async function requirePartyEditor(): Promise<string> {
  const { user } = await requireAuth();
  await requirePermission(user.id, "contract.create");
  return user.id;
}

function readContacts(formData: FormData): unknown {
  const raw = formData.get("contacts");
  if (typeof raw !== "string" || raw.trim() === "") {
    return [];
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const INVALID_CONTACTS: ActionFailure = {
  ok: false,
  code: ERROR_CODES.VALIDATION_FAILED,
  message: "联系人数据格式不正确",
};

export async function savePartyAction(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  let actorId: string;
  try {
    actorId = await requirePartyEditor();
  } catch (error) {
    return toFailure(error);
  }

  const contacts = readContacts(formData);
  if (contacts === undefined) {
    return INVALID_CONTACTS;
  }

  const id = formData.get("id");
  const payload = {
    name: formData.get("name"),
    uscc: formData.get("uscc"),
    type: formData.get("type"),
    address: formData.get("address"),
    contacts,
  };

  try {
    if (typeof id === "string" && id.trim() !== "") {
      const parsed = partyUpdateSchema.safeParse({ ...payload, id });
      if (!parsed.success) {
        return zodFailure(parsed.error);
      }
      const result = await updateParty(parsed.data, actorId);
      revalidatePath("/admin/parties");
      return { ok: true, data: result };
    }

    const parsed = partyFormSchema.safeParse(payload);
    if (!parsed.success) {
      return zodFailure(parsed.error);
    }
    const result = await createParty(parsed.data, actorId);
    revalidatePath("/admin/parties");
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}

export async function deletePartyAction(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  let actorId: string;
  try {
    actorId = await requirePartyEditor();
  } catch (error) {
    return toFailure(error);
  }

  try {
    const result = await deleteParty(id, actorId);
    revalidatePath("/admin/parties");
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}
