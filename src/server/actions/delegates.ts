"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/access";
import { requireAuth } from "@/server/auth/session";
import { delegateFormSchema } from "@/shared/schemas/delegate";
import type { ActionResult } from "@/shared/errors";
import {
  deleteDelegate,
  saveDelegate,
} from "@/server/services/delegate";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/server/services/notification";
import { toFailure, zodFailure } from "./helpers";

function revalidateDelegate(): void {
  revalidatePath("/admin/delegates");
  revalidatePath("/");
}

export async function saveDelegateAction(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  let access: Awaited<ReturnType<typeof requirePermission>>;
  try {
    const { user } = await requireAuth();
    access = await requirePermission(user.id, "contract.approve");
  } catch (error) {
    return toFailure(error);
  }

  const id = formData.get("id");
  const payload = {
    ...(typeof id === "string" && id !== "" ? { id } : {}),
    fromUserId: formData.get("fromUserId"),
    toUserId: formData.get("toUserId"),
    permissionKeys: formData.getAll("permissionKeys").map(String),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    reason: formData.get("reason"),
  };

  const parsed = delegateFormSchema.safeParse(payload);
  if (!parsed.success) {
    return zodFailure(parsed.error);
  }

  try {
    const result = await saveDelegate(access, parsed.data);
    revalidateDelegate();
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}

export async function deleteDelegateAction(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  let access: Awaited<ReturnType<typeof requirePermission>>;
  try {
    const { user } = await requireAuth();
    access = await requirePermission(user.id, "contract.approve");
  } catch (error) {
    return toFailure(error);
  }

  try {
    const result = await deleteDelegate(access, id);
    revalidateDelegate();
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}

export async function markNotificationReadAction(id: string): Promise<void> {
  const { user } = await requireAuth();
  await markNotificationRead(user.id, id);
  revalidatePath("/notifications");
  revalidatePath("/");
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const { user } = await requireAuth();
  await markAllNotificationsRead(user.id);
  revalidatePath("/notifications");
  revalidatePath("/");
}
