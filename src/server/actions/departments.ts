"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/shared/errors";
import {
  departmentFormSchema,
  departmentUpdateSchema,
} from "@/shared/schemas/department";
import { requirePermission } from "@/server/auth/access";
import { requireAuth } from "@/server/auth/session";
import {
  createDepartment,
  deleteDepartment,
  updateDepartment,
} from "@/server/services/department";
import { toFailure, zodFailure } from "./helpers";

async function requireManager(): Promise<string> {
  const { user } = await requireAuth();
  await requirePermission(user.id, "system.user.manage");
  return user.id;
}

export async function saveDepartmentAction(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  let actorId: string;
  try {
    actorId = await requireManager();
  } catch (error) {
    return toFailure(error);
  }

  const departmentId = formData.get("id");
  const payload = {
    name: formData.get("name"),
    parentId: formData.get("parentId"),
    managerUserId: formData.get("managerUserId"),
    sortOrder: formData.get("sortOrder"),
  };

  try {
    if (typeof departmentId === "string" && departmentId.trim() !== "") {
      const parsed = departmentUpdateSchema.safeParse({ ...payload, id: departmentId });
      if (!parsed.success) {
        return zodFailure(parsed.error);
      }
      const result = await updateDepartment(parsed.data, actorId);
      revalidatePath("/admin/departments");
      return { ok: true, data: result };
    }

    const parsed = departmentFormSchema.safeParse(payload);
    if (!parsed.success) {
      return zodFailure(parsed.error);
    }
    const result = await createDepartment(parsed.data, actorId);
    revalidatePath("/admin/departments");
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}

export async function deleteDepartmentAction(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  let actorId: string;
  try {
    actorId = await requireManager();
  } catch (error) {
    return toFailure(error);
  }

  try {
    const result = await deleteDepartment(id, actorId);
    revalidatePath("/admin/departments");
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}
