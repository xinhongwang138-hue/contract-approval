"use server";

import { revalidatePath } from "next/cache";
import { getAccessContext } from "@/server/auth/access";
import { requireAuth } from "@/server/auth/session";
import {
  archiveContract,
  pickSealRecord,
  returnSealRecord,
} from "@/server/services/lifecycle";
import type { ActionResult } from "@/shared/errors";
import { toFailure } from "./helpers";

function revalidateLifecycle(contractId: string): void {
  revalidatePath("/seals");
  revalidatePath("/archive");
  revalidatePath("/contracts");
  revalidatePath(`/contracts/${contractId}`);
}

export async function pickSealAction(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { user } = await requireAuth();
    const access = await getAccessContext(user.id);
    const result = await pickSealRecord(access, id);
    revalidateLifecycle(result.contractId);
    return { ok: true, data: { id: result.id } };
  } catch (error) {
    return toFailure(error);
  }
}

export async function returnSealAction(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const id = String(formData.get("id") ?? "");
  const notaryNo = String(formData.get("notaryNo") ?? "");
  try {
    const { user } = await requireAuth();
    const access = await getAccessContext(user.id);
    const result = await returnSealRecord(access, { id, notaryNo });
    revalidateLifecycle(result.contractId);
    return { ok: true, data: { id: result.id } };
  } catch (error) {
    return toFailure(error);
  }
}

export async function archiveContractAction(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "");
  try {
    const { user } = await requireAuth();
    const access = await getAccessContext(user.id);
    const result = await archiveContract(access, id, note);
    revalidateLifecycle(result.id);
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}
