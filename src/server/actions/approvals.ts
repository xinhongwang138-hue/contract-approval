"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, type AccessContext } from "@/server/auth/access";
import { requireAuth } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import {
  addSignToTask,
  decideTask,
  runWithFlowRetry,
  transferTask,
  withdrawInstance,
} from "@/server/flow/engine";
import { AppError, ERROR_CODES, type ActionResult } from "@/shared/errors";
import { activePrincipalIds, submitContract } from "@/server/services/approval";
import { toFailure } from "./helpers";

type PermissionKey = "contract.submit" | "contract.approve" | "contract.withdraw";

async function requireActor(permission: PermissionKey): Promise<AccessContext> {
  const { user } = await requireAuth();
  return requirePermission(user.id, permission);
}

function revalidateApproval(instanceId: string, contractId: string): void {
  revalidatePath(`/approvals/${instanceId}`);
  revalidatePath(`/contracts/${contractId}`);
  revalidatePath("/contracts");
  revalidatePath("/");
  revalidatePath("/notifications");
}

// 审批资格：任务归属人本人，或处于生效委托期内的受托人。
async function resolveTaskActor(
  taskId: string,
  userId: string,
): Promise<{ ownerId: string; operatorId: string; instanceId: string; contractId: string }> {
  const task = await prisma.flowTask.findFirst({
    where: { id: taskId, deletedAt: null },
    select: {
      id: true,
      assigneeId: true,
      instanceId: true,
      instance: { select: { contractId: true } },
    },
  });
  if (!task) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "审批任务不存在");
  }

  if (task.assigneeId === userId) {
    return {
      ownerId: userId,
      operatorId: userId,
      instanceId: task.instanceId,
      contractId: task.instance.contractId,
    };
  }

  const principals = await activePrincipalIds(userId);
  if (!principals.includes(task.assigneeId)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "该任务不属于你，且没有生效的审批委托");
  }

  return {
    ownerId: task.assigneeId,
    operatorId: userId,
    instanceId: task.instanceId,
    contractId: task.instance.contractId,
  };
}

export async function submitContractAction(
  contractId: string,
): Promise<ActionResult<{ instanceId: string; no: string }>> {
  let access: AccessContext;
  try {
    access = await requireActor("contract.submit");
  } catch (error) {
    return toFailure(error);
  }

  try {
    const result = await submitContract(access, contractId);
    revalidateApproval(result.instanceId, contractId);
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}

export async function decideTaskAction(formData: FormData): Promise<ActionResult<{ instanceId: string }>> {
  const taskId = String(formData.get("taskId") ?? "");
  const rawAction = String(formData.get("action") ?? "");
  const opinion = String(formData.get("opinion") ?? "");

  if (rawAction !== "approve" && rawAction !== "reject" && rawAction !== "return") {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: "未知的审批动作",
    };
  }

  let access: AccessContext;
  try {
    access = await requireActor("contract.approve");
  } catch (error) {
    return toFailure(error);
  }

  let actor: Awaited<ReturnType<typeof resolveTaskActor>>;
  try {
    actor = await resolveTaskActor(taskId, access.userId);
  } catch (error) {
    return toFailure(error);
  }

  try {
    const result = await runWithFlowRetry(
      (fn) => prisma.$transaction(fn),
      (run) =>
        decideTask(run, {
        taskId,
        actorId: actor.ownerId,
        operatorId: actor.operatorId,
          action: rawAction,
          opinion,
        }),
    );

    revalidateApproval(result.instanceId, actor.contractId);
    return { ok: true, data: { instanceId: result.instanceId } };
  } catch (error) {
    return toFailure(error);
  }
}

export async function addSignAction(formData: FormData): Promise<ActionResult<{ added: number }>> {
  const taskId = String(formData.get("taskId") ?? "");
  const position = String(formData.get("position") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const assigneeIds = formData
    .getAll("assigneeIds")
    .map(String)
    .filter((id) => id !== "");

  if (position !== "before" && position !== "after" && position !== "parallel") {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: "未知的加签方式",
    };
  }

  let access: AccessContext;
  try {
    access = await requireActor("contract.approve");
  } catch (error) {
    return toFailure(error);
  }

  let actor: Awaited<ReturnType<typeof resolveTaskActor>>;
  try {
    actor = await resolveTaskActor(taskId, access.userId);
  } catch (error) {
    return toFailure(error);
  }

  try {
    const result = await runWithFlowRetry(
      (fn) => prisma.$transaction(fn),
      (run) =>
        addSignToTask(run, {
          taskId,
          actorId: actor.ownerId,
          operatorId: actor.operatorId,
          position,
          assigneeIds,
          reason,
        }),
    );
    revalidateApproval(actor.instanceId, actor.contractId);
    return { ok: true, data: { added: result.addedTaskIds.length } };
  } catch (error) {
    return toFailure(error);
  }
}

export async function transferTaskAction(
  formData: FormData,
): Promise<ActionResult<{ taskId: string }>> {
  const taskId = String(formData.get("taskId") ?? "");
  const targetUserId = String(formData.get("targetUserId") ?? "");
  const reason = String(formData.get("reason") ?? "");

  if (targetUserId === "") {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: "请选择转签对象",
      fields: { targetUserId: "请选择转签对象" },
    };
  }

  let access: AccessContext;
  try {
    access = await requireActor("contract.approve");
  } catch (error) {
    return toFailure(error);
  }

  let actor: Awaited<ReturnType<typeof resolveTaskActor>>;
  try {
    actor = await resolveTaskActor(taskId, access.userId);
  } catch (error) {
    return toFailure(error);
  }

  try {
    const result = await runWithFlowRetry(
      (fn) => prisma.$transaction(fn),
      (run) =>
        transferTask(run, {
          taskId,
          actorId: actor.ownerId,
          operatorId: actor.operatorId,
          targetUserId,
          reason,
        }),
    );
    revalidateApproval(actor.instanceId, actor.contractId);
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error);
  }
}

export async function withdrawInstanceAction(
  instanceId: string,
): Promise<ActionResult<{ instanceId: string }>> {
  let access: AccessContext;
  try {
    access = await requireActor("contract.withdraw");
  } catch (error) {
    return toFailure(error);
  }

  const instance = await prisma.flowInstance.findFirst({
    where: { id: instanceId, deletedAt: null },
    select: { id: true, contractId: true },
  });
  if (!instance) {
    return {
      ok: false,
      code: ERROR_CODES.NOT_FOUND,
      message: "审批实例不存在",
    };
  }

  try {
    const result = await runWithFlowRetry(
      (fn) => prisma.$transaction(fn),
      (run) => withdrawInstance(run, { instanceId, actorId: access.userId }),
    );
    revalidateApproval(result.instanceId, instance.contractId);
    return { ok: true, data: { instanceId: result.instanceId } };
  } catch (error) {
    return toFailure(error);
  }
}
