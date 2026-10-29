"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/shared/errors";
import {
  passwordResetSchema,
  userCreateSchema,
  userUpdateSchema,
} from "@/shared/schemas/user";
import { requirePermission } from "@/server/auth/access";
import { requireAuth } from "@/server/auth/session";
import {
  createUser,
  deleteUser,
  resetUserPassword,
  updateUser,
} from "@/server/services/user";
import { toFailure, zodFailure } from "./helpers";

async function requireUserManager(): Promise<string> {
  const { user } = await requireAuth();
  await requirePermission(user.id, "system.user.manage");
  return user.id;
}

function readRoleIds(formData: FormData): string[] {
  return formData
    .getAll("roleIds")
    .filter((value): value is string => typeof value === "string");
}

export async function saveUserAction(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  let actorId: string;
  try {
    actorId = await requireUserManager();
  } catch (error) {
    return toFailure(error);
  }

  const id = formData.get("id");
  const common = {
    name: formData.get("name"),
    departmentId: formData.get("departmentId"),
    managerUserId: formData.get("managerUserId"),
    status: formData.get("status"),
    roleIds: readRoleIds(formData),
  };

  try {
    if (typeof id === "string" && id.trim() !== "") {
      const parsed = userUpdateSchema.safeParse({ ...common, id });
      if (!parsed.success) {
        return zodFailure(parsed.error);
      }
      const result = await updateUser(parsed.data, actorId);
      revalidatePath("/admin/users");
      return { ok: true, data: result };
    }

    const parsed = userCreateSchema.safeParse({
      ...common,
      email: formData.get("email"),
      password: formData.get("password"),
    });
    if (!parsed.success) {
      return zodFailure(parsed.error);
    }
    const result = await createUser(parsed.data, actorId);
    revalidatePath("/admin/users");
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}

export async function resetUserPasswordAction(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  let actorId: string;
  try {
    actorId = await requireUserManager();
  } catch (error) {
    return toFailure(error);
  }

  const parsed = passwordResetSchema.safeParse({
    userId: formData.get("userId"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return zodFailure(parsed.error);
  }

  try {
    const result = await resetUserPassword(
      parsed.data.userId,
      parsed.data.password,
      actorId,
    );
    revalidatePath("/admin/users");
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}

export async function deleteUserAction(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  let actorId: string;
  try {
    actorId = await requireUserManager();
  } catch (error) {
    return toFailure(error);
  }

  try {
    const result = await deleteUser(id, actorId);
    revalidatePath("/admin/users");
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}
