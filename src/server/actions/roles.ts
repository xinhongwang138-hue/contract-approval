"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/shared/errors";
import { roleCreateSchema, roleUpdateSchema } from "@/shared/schemas/role";
import { requirePermission } from "@/server/auth/access";
import { requireAuth } from "@/server/auth/session";
import { createRole, deleteRole, updateRole } from "@/server/services/role";
import { toFailure, zodFailure } from "./helpers";

async function requireRoleManager(): Promise<string> {
  const { user } = await requireAuth();
  await requirePermission(user.id, "system.role.manage");
  return user.id;
}

function readPermissionKeys(formData: FormData): string[] {
  return formData
    .getAll("permissionKeys")
    .filter((value): value is string => typeof value === "string");
}

export async function saveRoleAction(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  let actorId: string;
  try {
    actorId = await requireRoleManager();
  } catch (error) {
    return toFailure(error);
  }

  const id = formData.get("id");
  const payload = {
    name: formData.get("name"),
    permissionKeys: readPermissionKeys(formData),
    scope: formData.get("scope"),
    departmentId: formData.get("departmentId"),
  };

  try {
    if (typeof id === "string" && id.trim() !== "") {
      const parsed = roleUpdateSchema.safeParse({ ...payload, id });
      if (!parsed.success) {
        return zodFailure(parsed.error);
      }
      const result = await updateRole(parsed.data, actorId);
      revalidatePath("/admin/roles");
      return { ok: true, data: result };
    }

    const parsed = roleCreateSchema.safeParse({
      ...payload,
      key: formData.get("key"),
    });
    if (!parsed.success) {
      return zodFailure(parsed.error);
    }
    const result = await createRole(parsed.data, actorId);
    revalidatePath("/admin/roles");
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}

export async function deleteRoleAction(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  let actorId: string;
  try {
    actorId = await requireRoleManager();
  } catch (error) {
    return toFailure(error);
  }

  try {
    const result = await deleteRole(id, actorId);
    revalidatePath("/admin/roles");
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}
