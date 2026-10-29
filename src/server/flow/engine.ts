import {
  collectNodeTargets,
  flowDefinitionSchema,
  type ApprovalNode,
  type FlowDefinition,
  type FlowNode,
} from "@/shared/flow-definition";
import {
  CONTRACT_TRANSITIONS,
  FLOW_TRANSITIONS,
  NODE_RUN_TRANSITIONS,
  TASK_TRANSITIONS,
  assertTransition,
  type ContractStatus,
  type FlowStatus,
  type NodeRunStatus,
  type TaskStatus,
} from "@/shared/state-machines";
import { AppError, ERROR_CODES, ValidationError } from "@/shared/errors";
import { resolveAssignees } from "./assignee";
import { resolveBranch } from "./expression";
import { createWebhookDispatcher } from "./webhook";
import {
  addSignBaseNodeId,
  addSignRunId,
  incomingEdgeCount,
  isJoinReady,
  nextAttempt,
} from "./join";
import type {
  EngineCallOptions,
  FlowActionResult,
  FlowDb,
  FlowDecisionAction,
  FlowExecutionContext,
  LoadedInstance,
  TransactionRunner,
} from "./types";
import type { Prisma } from "@/generated/prisma/client";

export const FLOW_MAX_RETRIES = 3;
const SYSTEM_ACTOR = "system";
const defaultWebhookDispatcher = createWebhookDispatcher();

type QueueItem = { nodeId: string };

type TaskLite = {
  id: string;
  nodeRunId: string;
  assigneeId: string;
  status: TaskStatus;
  sequenceIndex: number | null;
  activatedAt: Date | null;
  blockedByNodeRunId: string | null;
};

type RunLite = {
  id: string;
  nodeId: string;
  nodeType: string;
  status: NodeRunStatus;
  attempt: number;
  awaitingCount: number | null;
  joinedCount: number;
  result: Prisma.JsonValue;
  version: number;
};

function asRun(row: {
  id: string;
  nodeId: string;
  nodeType: string;
  status: string;
  attempt: number;
  awaitingCount: number | null;
  joinedCount: number;
  result: Prisma.JsonValue;
  version: number;
}): RunLite {
  return {
    id: row.id,
    nodeId: row.nodeId,
    nodeType: row.nodeType,
    status: row.status as NodeRunStatus,
    attempt: row.attempt,
    awaitingCount: row.awaitingCount,
    joinedCount: row.joinedCount,
    result: row.result,
    version: row.version,
  };
}

function runResult(run: RunLite): Record<string, unknown> {
  return typeof run.result === "object" && run.result !== null
    ? (run.result as Record<string, unknown>)
    : {};
}

function runBaseNodeId(definition: FlowDefinition, run: RunLite): string {
  const direct = definition.nodes.some((node) => node.id === run.nodeId);
  if (direct) {
    return run.nodeId;
  }
  const fromResult = runResult(run).baseNodeId;
  if (typeof fromResult === "string") {
    return fromResult;
  }
  return addSignBaseNodeId(run.nodeId) ?? run.nodeId;
}

function findNode(definition: FlowDefinition, nodeId: string): FlowNode {
  const node = definition.nodes.find((item) => item.id === nodeId);
  if (!node) {
    throw new AppError(ERROR_CODES.INTERNAL, `流程定义缺少节点 ${nodeId}`);
  }
  return node;
}

function approvalNode(definition: FlowDefinition, run: RunLite): ApprovalNode {
  const node = findNode(definition, runBaseNodeId(definition, run));
  if (node.type !== "approval") {
    throw new AppError(ERROR_CODES.INTERNAL, `节点 ${node.id} 不是审批节点`);
  }
  return node;
}

export async function loadInstance(db: FlowDb, instanceId: string): Promise<LoadedInstance> {
  const row = await db.flowInstance.findFirst({
    where: { id: instanceId, deletedAt: null },
  });
  if (!row) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "审批实例不存在");
  }
  return {
    id: row.id,
    contractId: row.contractId,
    startedBy: row.startedBy,
    status: row.status,
    version: row.version,
    definition: row.definitionSnapshot as unknown as FlowDefinition,
    context: row.context as unknown as FlowExecutionContext,
  };
}

async function touchInstance(db: FlowDb, instance: LoadedInstance): Promise<void> {
  const updated = await db.flowInstance.updateMany({
    where: { id: instance.id, version: instance.version, deletedAt: null },
    data: { version: { increment: 1 } },
  });
  if (updated.count === 0) {
    throw new AppError(ERROR_CODES.CONFLICT, "审批实例并发更新，请重试");
  }
  instance.version += 1;
}

async function logEvent(
  db: FlowDb,
  input: {
    instanceId: string;
    nodeRunId?: string;
    taskId?: string;
    actorId: string;
    action: string;
    from?: string;
    to?: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await db.flowEventLog.create({
    data: {
      instanceId: input.instanceId,
      nodeRunId: input.nodeRunId,
      taskId: input.taskId,
      actorId: input.actorId,
      action: input.action,
      from: input.from,
      to: input.to,
      detail: (input.detail ?? {}) as Prisma.InputJsonValue,
    },
  });
}

async function notify(
  db: FlowDb,
  userIds: string[],
  message: { kind: string; title: string; body: string; link?: string },
): Promise<void> {
  const unique = [...new Set(userIds)].filter((id) => id !== "");
  if (unique.length === 0) {
    return;
  }
  await db.notification.createMany({
    data: unique.map((userId) => ({
      userId,
      kind: message.kind,
      title: message.title,
      body: message.body,
      link: message.link,
    })),
  });
}

async function addParticipants(
  db: FlowDb,
  contractId: string,
  userIds: string[],
  kind: "approver" | "cc",
): Promise<void> {
  for (const userId of [...new Set(userIds)]) {
    await db.contractParticipant.upsert({
      where: { contractId_userId_kind: { contractId, userId, kind } },
      update: {},
      create: { contractId, userId, kind },
    });
  }
}

async function setContractStatus(
  db: FlowDb,
  contractId: string,
  to: ContractStatus,
  actorId: string,
  stage?: "normal" | "returned",
): Promise<ContractStatus> {
  const contract = await db.contract.findFirstOrThrow({
    where: { id: contractId, deletedAt: null },
    select: { id: true, status: true, stage: true },
  });
  const current = contract.status as ContractStatus;
  if (current !== to) {
    assertTransition("Contract", CONTRACT_TRANSITIONS, current, to);
  }
  await db.contract.update({
    where: { id: contractId },
    data: {
      status: to,
      stage: stage ?? contract.stage,
      updatedBy: actorId,
    },
  });
  return to;
}

async function setInstanceStatus(
  db: FlowDb,
  instance: LoadedInstance,
  to: FlowStatus,
): Promise<void> {
  if (instance.status !== to) {
    assertTransition("FlowInstance", FLOW_TRANSITIONS, instance.status, to);
  }
  await db.flowInstance.update({
    where: { id: instance.id },
    data: {
      status: to,
      finishedAt: to === "running" ? null : new Date(),
    },
  });
  instance.status = to;
}

async function createNodeRun(
  db: FlowDb,
  input: {
    instanceId: string;
    node: FlowNode;
    attempt: number;
    result?: Record<string, unknown>;
    awaitingCount?: number;
  },
): Promise<RunLite> {
  const created = await db.flowNodeRun.create({
    data: {
      instanceId: input.instanceId,
      nodeId: input.node.id,
      nodeType: input.node.type,
      nodeName: input.node.name,
      status: "pending",
      attempt: input.attempt,
      awaitingCount: input.awaitingCount ?? null,
      result: (input.result ?? {}) as Prisma.InputJsonValue,
    },
  });
  return asRun(created);
}

async function setRunStatus(
  db: FlowDb,
  run: RunLite,
  to: NodeRunStatus,
  extra: { finishedAt?: Date | null; result?: Prisma.InputJsonValue } = {},
): Promise<RunLite> {
  assertTransition("FlowNodeRun", NODE_RUN_TRANSITIONS, run.status, to);
  const updated = await db.flowNodeRun.updateMany({
    where: { id: run.id, version: run.version, status: run.status },
    data: { ...extra, status: to, version: { increment: 1 } },
  });
  if (updated.count === 0) {
    throw new AppError(ERROR_CODES.CONFLICT, "审批节点并发更新，请重试");
  }
  return { ...run, status: to, version: run.version + 1 };
}

async function loadRuns(db: FlowDb, instanceId: string): Promise<RunLite[]> {
  const rows = await db.flowNodeRun.findMany({
    where: { instanceId, deletedAt: null },
    orderBy: { startedAt: "asc" },
  });
  return rows.map(asRun);
}

async function loadTasks(db: FlowDb, nodeRunId: string): Promise<TaskLite[]> {
  const rows = await db.flowTask.findMany({
    where: { nodeRunId, deletedAt: null },
    orderBy: [{ sequenceIndex: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    nodeRunId: row.nodeRunId,
    assigneeId: row.assigneeId,
    status: row.status as TaskStatus,
    sequenceIndex: row.sequenceIndex,
    activatedAt: row.activatedAt,
    blockedByNodeRunId: row.blockedByNodeRunId,
  }));
}

async function cancelPendingTasks(
  db: FlowDb,
  instanceId: string,
  nodeRunIds: string[],
  actorId: string,
  reason: string,
): Promise<void> {
  if (nodeRunIds.length === 0) {
    return;
  }
  const targets = await db.flowTask.findMany({
    where: { nodeRunId: { in: nodeRunIds }, status: "pending", deletedAt: null },
    select: { id: true, instanceId: true, nodeRunId: true },
  });
  for (const target of targets) {
    const updated = await db.flowTask.updateMany({
      where: { id: target.id, status: "pending" },
      data: { status: "cancelled", decidedAt: new Date(), decidedBy: actorId },
    });
    if (updated.count === 0) {
      continue;
    }
    await logEvent(db, {
      instanceId,
      nodeRunId: target.nodeRunId,
      taskId: target.id,
      actorId,
      action: "task.cancelled",
      from: "pending",
      to: "cancelled",
      detail: { reason },
    });
  }
}

async function activateTask(
  db: FlowDb,
  instance: LoadedInstance,
  task: { id: string; nodeRunId: string; assigneeId: string },
  dueAt: Date | null,
  actorId: string,
): Promise<void> {
  await db.flowTask.update({
    where: { id: task.id },
    data: { activatedAt: new Date(), dueAt },
  });
  await notify(db, [task.assigneeId], {
    kind: "task",
    title: "有新的合同待你审批",
    body: `合同 ${String(instance.context.contract.no ?? "")} 等待你处理`,
    link: `/approvals/${instance.id}`,
  });
  await logEvent(db, {
    instanceId: instance.id,
    nodeRunId: task.nodeRunId,
    taskId: task.id,
    actorId,
    action: "task.activated",
    detail: { dueAt: dueAt ? dueAt.toISOString() : null },
  });
}

function dueAtFrom(now: Date, hours: number | undefined): Date | null {
  if (!hours || hours <= 0) {
    return null;
  }
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

async function enterApprovalNode(
  db: FlowDb,
  instance: LoadedInstance,
  node: ApprovalNode,
  options: EngineCallOptions,
  activated: string[],
): Promise<void> {
  const runs = await loadRuns(db, instance.id);
  const attempt = nextAttempt(runs, node.id);
  let run = await createNodeRun(db, { instanceId: instance.id, node, attempt });
  run = await setRunStatus(db, run, "running");

  const resolution = await resolveAssignees(db, node.assignee, {
    initiatorId: instance.startedBy,
    departmentId:
      typeof instance.context.initiator.departmentId === "string"
        ? instance.context.initiator.departmentId
        : null,
    managerUserId:
      typeof instance.context.initiator.managerUserId === "string"
        ? instance.context.initiator.managerUserId
        : null,
    formData: instance.context.form,
  });

  let assigneeIds = resolution.userIds;
  let selfSkipped = false;
  if (assigneeIds.includes(instance.startedBy)) {
    if (node.selfApprovePolicy === "block") {
      throw new ValidationError(`节点「${node.name}」的审批人只有发起人本人`);
    }
    assigneeIds = assigneeIds.filter((id) => id !== instance.startedBy);
    selfSkipped = true;
    await logEvent(db, {
      instanceId: instance.id,
      nodeRunId: run.id,
      actorId: SYSTEM_ACTOR,
      action: "node.self_approve_skipped",
      detail: { nodeId: node.id },
    });
  }

  if (assigneeIds.length === 0 && !selfSkipped) {
    if (node.emptyPolicy === "block_submit") {
      throw new ValidationError(`节点「${node.name}」解析不到审批人，无法提交`);
    }
    if (node.emptyPolicy === "transfer_to_manager") {
      const manager = await resolveAssignees(
        db,
        { kind: "expression", expression: "initiator.manager" },
        {
          initiatorId: instance.startedBy,
          departmentId: null,
          managerUserId:
            typeof instance.context.initiator.managerUserId === "string"
              ? instance.context.initiator.managerUserId
              : null,
          formData: instance.context.form,
        },
      );
      if (manager.userIds.length > 0) {
        assigneeIds = manager.userIds;
      }
    }
  }

  if (assigneeIds.length === 0) {
    await setRunStatus(db, run, "approved", {
      result: {
        autoPassed: true,
        reason: selfSkipped ? "self_approve_skipped" : node.emptyPolicy,
      } as Prisma.InputJsonValue,
      finishedAt: new Date(),
    });
    await logEvent(db, {
      instanceId: instance.id,
      nodeRunId: run.id,
      actorId: SYSTEM_ACTOR,
      action: "node.auto_passed",
      detail: { nodeId: node.id },
    });
    await continueFrom(db, instance, node, options, activated);
    return;
  }

  await addParticipants(db, instance.contractId, assigneeIds, "approver");
  await setContractStatus(db, instance.contractId, "approving", instance.startedBy);

  const now = options.now ?? new Date();
  const sequential = node.mode === "sequential";
  let sequence = 0;
  for (const assigneeId of assigneeIds) {
    const created = await db.flowTask.create({
      data: {
        instanceId: instance.id,
        nodeRunId: run.id,
        assigneeId,
        status: "pending",
        sequenceIndex: sequential ? sequence : null,
        dueAt: dueAtFrom(now, node.timeout?.hours),
      },
    });
    if (!sequential || sequence === 0) {
      await activateTask(
        db,
        instance,
        { id: created.id, nodeRunId: run.id, assigneeId: created.assigneeId },
        created.dueAt,
        SYSTEM_ACTOR,
      );
      activated.push(created.id);
    } else {
      await logEvent(db, {
        instanceId: instance.id,
        nodeRunId: run.id,
        taskId: created.id,
        actorId: SYSTEM_ACTOR,
        action: "task.queued",
        detail: { sequenceIndex: sequence },
      });
    }
    sequence += 1;
  }

  await logEvent(db, {
    instanceId: instance.id,
    nodeRunId: run.id,
    actorId: SYSTEM_ACTOR,
    action: "node.entered",
    detail: { nodeId: node.id, mode: node.mode, assigneeIds },
  });
}

async function continueFrom(
  db: FlowDb,
  instance: LoadedInstance,
  node: FlowNode,
  options: EngineCallOptions,
  activated: string[],
): Promise<void> {
  await processQueue(
    db,
    instance,
    collectNodeTargets(node).map((nodeId) => ({ nodeId })),
    options,
    activated,
  );
}

async function runActionNode(
  db: FlowDb,
  instance: LoadedInstance,
  node: Extract<FlowNode, { type: "action" }>,
  options: EngineCallOptions,
): Promise<void> {
  switch (node.kind) {
    case "notify": {
      const recipients = [
        ...(Array.isArray(node.payload.userIds)
          ? (node.payload.userIds as string[])
          : []),
        instance.startedBy,
      ];
      await notify(db, recipients, {
        kind: "flow",
        title: String(node.payload.title ?? instance.contractId),
        body: String(node.payload.body ?? node.name),
        link: `/contracts/${instance.contractId}`,
      });
      break;
    }
    case "set_status": {
      await setContractStatus(
        db,
        instance.contractId,
        String(node.payload.status) as ContractStatus,
        SYSTEM_ACTOR,
      );
      break;
    }
    case "create_seal_record": {
      const current = await db.contract.findUniqueOrThrow({
        where: { id: instance.contractId },
        select: { status: true },
      });
      if (current.status === "approving" || current.status === "pending") {
        await setContractStatus(db, instance.contractId, "approved", SYSTEM_ACTOR);
      }
      await db.sealRecord.create({
        data: {
          contractId: instance.contractId,
          sealType: String(node.payload.sealType ?? "company") as "company",
          copies: Number(node.payload.copies ?? 1),
          applicantId: instance.startedBy,
          appliedAt: new Date(),
        },
      });
      await setContractStatus(db, instance.contractId, "to_seal", SYSTEM_ACTOR);
      break;
    }
    case "archive": {
      await db.contractMilestone.create({
        data: {
          contractId: instance.contractId,
          kind: "archived",
          at: new Date(),
          operatorId: SYSTEM_ACTOR,
        },
      });
      await setContractStatus(db, instance.contractId, "archived", SYSTEM_ACTOR);
      break;
    }
    case "webhook": {
      const dispatcher = options.webhook ?? defaultWebhookDispatcher;
      await dispatcher.post(String(node.payload.target ?? ""), {
        contractId: instance.contractId,
        instanceId: instance.id,
        ...node.payload,
      });
      break;
    }
  }
}

async function processQueue(
  db: FlowDb,
  instance: LoadedInstance,
  queue: QueueItem[],
  options: EngineCallOptions,
  activated: string[],
): Promise<void> {
  const pending = [...queue];
  while (pending.length > 0) {
    const item = pending.shift();
    if (!item) {
      continue;
    }
    const node = findNode(instance.definition, item.nodeId);

    if (node.type === "end") {
      const finished = await finishInstance(db, instance, node.result);
      if (!finished) {
        continue;
      }
      pending.length = 0;
      continue;
    }

    if (node.type === "approval") {
      await enterApprovalNode(db, instance, node, options, activated);
      continue;
    }

    const runs = await loadRuns(db, instance.id);
    const attempt = nextAttempt(runs, node.id);
    let run = await createNodeRun(db, { instanceId: instance.id, node, attempt });
    run = await setRunStatus(db, run, "running");

    if (node.type === "start") {
      await setRunStatus(db, run, "approved", { finishedAt: new Date() });
      await logEvent(db, {
        instanceId: instance.id,
        nodeRunId: run.id,
        actorId: instance.startedBy,
        action: "node.started",
        detail: { nodeId: node.id },
      });
      pending.unshift(...collectNodeTargets(node).map((nodeId) => ({ nodeId })));
      continue;
    }

    if (node.type === "cc") {
      const resolution = await resolveAssignees(db, node.assignee, {
        initiatorId: instance.startedBy,
        departmentId:
          typeof instance.context.initiator.departmentId === "string"
            ? instance.context.initiator.departmentId
            : null,
        managerUserId:
          typeof instance.context.initiator.managerUserId === "string"
            ? instance.context.initiator.managerUserId
            : null,
        formData: instance.context.form,
      });
      if (resolution.userIds.length > 0) {
        await addParticipants(db, instance.contractId, resolution.userIds, "cc");
        await notify(db, resolution.userIds, {
          kind: "cc",
          title: "合同抄送给你",
          body: `合同 ${String(instance.context.contract.no ?? "")} 已抄送你`,
          link: `/contracts/${instance.contractId}`,
        });
      }
      await setRunStatus(db, run, "approved", { finishedAt: new Date() });
      pending.unshift(...collectNodeTargets(node).map((nodeId) => ({ nodeId })));
      continue;
    }

    if (node.type === "condition") {
      const branch = resolveBranch(node.branches, instance.context);
      if (!branch) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          `条件节点「${node.name}」没有任何分支命中`,
        );
      }
      await setRunStatus(db, run, "approved", {
        result: { branchId: branch.id } as Prisma.InputJsonValue,
        finishedAt: new Date(),
      });
      await logEvent(db, {
        instanceId: instance.id,
        nodeRunId: run.id,
        actorId: SYSTEM_ACTOR,
        action: "node.branch_taken",
        detail: { nodeId: node.id, branchId: branch.id },
      });
      const targets = Array.isArray(branch.next) ? branch.next : [branch.next];
      pending.unshift(...targets.map((nodeId) => ({ nodeId })));
      continue;
    }

    if (node.type === "action") {
      await runActionNode(db, instance, node, options);
      await setRunStatus(db, run, "approved", { finishedAt: new Date() });
      pending.unshift(...collectNodeTargets(node).map((target) => ({ nodeId: target })));
      continue;
    }

    if (node.type === "join") {
      const awaiting = incomingEdgeCount(instance.definition, node.id);
      const waiting = runs.find(
        (item) => item.nodeId === node.id && item.status === "waiting_join",
      );
      if (waiting) {
        const joined = waiting.joinedCount + 1;
        await db.flowNodeRun.update({
          where: { id: waiting.id },
          data: { joinedCount: joined, version: { increment: 1 } },
        });
        await logEvent(db, {
          instanceId: instance.id,
          nodeRunId: waiting.id,
          actorId: SYSTEM_ACTOR,
          action: "node.join_arrived",
          detail: { joined, awaiting },
        });
        if (!isJoinReady(joined, awaiting)) {
          continue;
        }
        await setRunStatus(
          db,
          { ...waiting, joinedCount: joined, version: waiting.version + 1 },
          "approved",
          { finishedAt: new Date() },
        );
        await logEvent(db, {
          instanceId: instance.id,
          nodeRunId: waiting.id,
          actorId: SYSTEM_ACTOR,
          action: "node.joined",
          detail: { joined, awaiting },
        });
        pending.unshift(...collectNodeTargets(node).map((t) => ({ nodeId: t })));
        continue;
      }

      await db.flowNodeRun.update({
        where: { id: run.id },
        data: { joinedCount: 1, awaitingCount: awaiting, version: { increment: 1 } },
      });
      const first = { ...run, joinedCount: 1, awaitingCount: awaiting, version: run.version + 1 };
      if (!isJoinReady(1, awaiting)) {
        await setRunStatus(db, first, "waiting_join");
        await logEvent(db, {
          instanceId: instance.id,
          nodeRunId: run.id,
          actorId: SYSTEM_ACTOR,
          action: "node.waiting_join",
          detail: { joined: 1, awaiting },
        });
        continue;
      }
      await setRunStatus(db, first, "approved", { finishedAt: new Date() });
      await logEvent(db, {
        instanceId: instance.id,
        nodeRunId: run.id,
        actorId: SYSTEM_ACTOR,
        action: "node.joined",
        detail: { joined: 1, awaiting },
      });
      pending.unshift(...collectNodeTargets(node).map((t) => ({ nodeId: t })));
      continue;
    }

    const exhausted: never = node;
    throw new AppError(
      ERROR_CODES.INTERNAL,
      `未处理的节点类型 ${(exhausted as FlowNode).type}`,
    );
  }
}

async function finishInstance(
  db: FlowDb,
  instance: LoadedInstance,
  result: "approved" | "rejected" | "terminated",
): Promise<boolean> {
  const runs = await loadRuns(db, instance.id);
  const open = runs.filter((run) =>
    ["running", "waiting_join", "pending"].includes(run.status),
  );
  if (open.length > 0) {
    await logEvent(db, {
      instanceId: instance.id,
      actorId: SYSTEM_ACTOR,
      action: "flow.branch_finished",
      detail: { result, openRuns: open.length },
    });
    return false;
  }

  const status: FlowStatus = result;
  await setInstanceStatus(db, instance, status);
  const current = await db.contract.findUniqueOrThrow({
    where: { id: instance.contractId },
    select: { status: true },
  });
  // 动作节点可能已把合同推进到用印之后，此时实例结束不再回写合同状态。
  if (current.status === "pending" || current.status === "approving") {
    if (current.status === "pending" && result === "approved") {
      await setContractStatus(db, instance.contractId, "approving", SYSTEM_ACTOR);
    }
    await setContractStatus(
      db,
      instance.contractId,
      result === "approved" ? "approved" : "rejected",
      SYSTEM_ACTOR,
    );
  }
  await notify(db, [instance.startedBy], {
    kind: "flow",
    title: result === "approved" ? "合同审批通过" : "合同审批未通过",
    body: `合同 ${String(instance.context.contract.no ?? "")} 审批结束`,
    link: `/contracts/${instance.contractId}`,
  });
  await logEvent(db, {
    instanceId: instance.id,
    actorId: SYSTEM_ACTOR,
    action: "flow.finished",
    from: "running",
    to: status,
    detail: { result },
  });
  return true;
}

async function cancelEverything(
  db: FlowDb,
  instance: LoadedInstance,
  actorId: string,
  reason: string,
): Promise<void> {
  const runs = await loadRuns(db, instance.id);
  const open = runs.filter((run) =>
    ["running", "waiting_join", "pending"].includes(run.status),
  );
  await cancelPendingTasks(
    db,
    instance.id,
    open.map((run) => run.id),
    actorId,
    reason,
  );
  for (const run of open) {
    await setRunStatus(db, run, "cancelled", { finishedAt: new Date() });
  }
}

function requiredApprovals(node: ApprovalNode, total: number): number {
  // ratio < 1 时按“超过阈值”判定，与验收用例（4 人 0.5 需第 3 票）一致。
  if (node.mode !== "all" || node.minApproveRatio >= 1) {
    return node.mode === "all" ? total : 1;
  }
  return Math.floor(node.minApproveRatio * total) + 1;
}

async function evaluateNodeOutcome(
  db: FlowDb,
  instance: LoadedInstance,
  run: RunLite,
  actorId: string,
  opinion: string | undefined,
  options: EngineCallOptions,
  activated: string[],
): Promise<"pending" | "approved" | "rejected"> {
  const node = approvalNode(instance.definition, run);
  const tasks = await loadTasks(db, run.id);
  const relevant = tasks.filter(
    (task) => task.status !== "cancelled" && task.status !== "transferred",
  );

  const rejected = relevant.find((task) => task.status === "rejected");
  if (rejected) {
    await rejectNode(db, instance, run, node, actorId, opinion, options, activated);
    return "rejected";
  }

  const approved = relevant.filter((task) => task.status === "approved").length;
  const pending = relevant.filter((task) => task.status === "pending");

  if (node.mode === "sequential") {
    if (pending.length === 0) {
      await completeNode(db, instance, run, node, actorId, options, activated);
      return "approved";
    }
    const next = pending
      .filter((task) => task.activatedAt === null && task.blockedByNodeRunId === null)
      .sort((left, right) => (left.sequenceIndex ?? 0) - (right.sequenceIndex ?? 0))[0];
    if (next) {
      await activateTask(
        db,
        instance,
        { id: next.id, nodeRunId: run.id, assigneeId: next.assigneeId },
        dueAtFrom(options.now ?? new Date(), node.timeout?.hours),
        actorId,
      );
      activated.push(next.id);
    }
    return "pending";
  }

  const needed = requiredApprovals(node, relevant.length);
  if (approved >= needed) {
    await cancelPendingTasks(
      db,
      instance.id,
      [run.id],
      actorId,
      node.mode === "any" ? "或签已由他人通过" : "会签已达到通过比例",
    );
    await completeNode(db, instance, run, node, actorId, options, activated);
    return "approved";
  }

  if (pending.length === 0) {
    await rejectNode(db, instance, run, node, actorId, opinion, options, activated);
    return "rejected";
  }

  return "pending";
}

async function completeNode(
  db: FlowDb,
  instance: LoadedInstance,
  run: RunLite,
  node: ApprovalNode,
  actorId: string,
  options: EngineCallOptions,
  activated: string[],
): Promise<void> {
  const afterSigns = runResult(run).afterAddSigns;
  await setRunStatus(db, run, "approved", { finishedAt: new Date() });
  await logEvent(db, {
    instanceId: instance.id,
    nodeRunId: run.id,
    actorId,
    action: "node.approved",
    detail: { nodeId: node.id },
  });

  if (run.nodeId !== node.id) {
    await finishAddSignRun(db, instance, run, node.id, actorId, options, activated);
    return;
  }

  if (Array.isArray(afterSigns) && afterSigns.length > 0) {
    let blocked = false;
    for (const entry of afterSigns as { assigneeIds: string[]; originTaskId: string }[]) {
      for (const assigneeId of entry.assigneeIds) {
        const created = await createAddSignRun(
          db,
          instance,
          node,
          run,
          "after",
          assigneeId,
          entry.originTaskId,
          options,
        );
        if (created) {
          blocked = true;
        }
      }
    }
    if (blocked) {
      return;
    }
  }

  await continueFrom(db, instance, node, options, activated);
}

async function createAddSignRun(
  db: FlowDb,
  instance: LoadedInstance,
  node: ApprovalNode,
  originRun: RunLite,
  position: "before" | "after",
  assigneeId: string,
  originTaskId: string,
  options: EngineCallOptions,
): Promise<string | null> {
  const syntheticId = addSignRunId(node.id, position, originTaskId, assigneeId);
  const existing = await db.flowNodeRun.findFirst({
    where: { instanceId: instance.id, nodeId: syntheticId, deletedAt: null },
  });
  if (existing) {
    return null;
  }

  const created = await db.flowNodeRun.create({
    data: {
      instanceId: instance.id,
      nodeId: syntheticId,
      nodeType: "approval",
      nodeName: `${node.name}·加签`,
      status: "running",
      attempt: 1,
      result: {
        baseNodeId: node.id,
        addSignPosition: position,
        originTaskId,
      } as Prisma.InputJsonValue,
    },
  });
  const task = await db.flowTask.create({
    data: {
      instanceId: instance.id,
      nodeRunId: created.id,
      assigneeId,
      status: "pending",
      addSignType: position === "before" ? "before" : "after",
      originTaskId,
      dueAt: dueAtFrom(options.now ?? new Date(), node.timeout?.hours),
      activatedAt: new Date(),
    },
  });
  await addParticipants(db, instance.contractId, [assigneeId], "approver");
  await notify(db, [assigneeId], {
    kind: "task",
    title: "有合同需要你加签审批",
    body: `合同 ${String(instance.context.contract.no ?? "")} 被加签`,
    link: `/approvals/${instance.id}`,
  });
  await logEvent(db, {
    instanceId: instance.id,
    nodeRunId: created.id,
    taskId: task.id,
    actorId: instance.startedBy,
    action: "task.add_sign",
    detail: { position, originTaskId, nodeId: node.id },
  });
  return created.id;
}

async function releaseBlockedTasks(
  db: FlowDb,
  instance: LoadedInstance,
  finishedRunId: string,
  actorId: string,
  options: EngineCallOptions,
  activated: string[],
): Promise<boolean> {
  const blocked = await db.flowTask.findMany({
    where: { blockedByNodeRunId: finishedRunId, status: "pending", deletedAt: null },
  });
  for (const task of blocked) {
    const run = await db.flowNodeRun.findUnique({ where: { id: task.nodeRunId } });
    if (!run) {
      continue;
    }
    const node = approvalNode(instance.definition, asRun(run));
    await db.flowTask.update({
      where: { id: task.id },
      data: { blockedByNodeRunId: null, activatedAt: new Date() },
    });
    await activateTask(
      db,
      instance,
      { id: task.id, nodeRunId: task.nodeRunId, assigneeId: task.assigneeId },
      dueAtFrom(options.now ?? new Date(), node.timeout?.hours),
      actorId,
    );
    activated.push(task.id);
  }
  return blocked.length > 0;
}

async function rejectNode(
  db: FlowDb,
  instance: LoadedInstance,
  run: RunLite,
  node: ApprovalNode,
  actorId: string,
  opinion: string | undefined,
  options: EngineCallOptions,
  activated: string[],
): Promise<void> {
  await cancelPendingTasks(db, instance.id, [run.id], actorId, "节点被驳回");
  await setRunStatus(db, run, "rejected", { finishedAt: new Date() });
  await logEvent(db, {
    instanceId: instance.id,
    nodeRunId: run.id,
    actorId,
    action: "node.rejected",
    detail: { nodeId: node.id, policy: node.reject.policy },
  });

  const runs = await loadRuns(db, instance.id);
  const openOthers = runs.filter(
    (item) =>
      item.id !== run.id &&
      ["running", "waiting_join", "pending"].includes(item.status),
  );
  await cancelPendingTasks(
    db,
    instance.id,
    openOthers.map((item) => item.id),
    actorId,
    "其他分支随驳回取消",
  );
  for (const item of openOthers) {
    await setRunStatus(db, item, "cancelled", { finishedAt: new Date() });
  }

  const policy = node.reject.policy;
  if (policy === "to_initiator" || policy === "terminate") {
    const status: FlowStatus = policy === "terminate" ? "terminated" : "rejected";
    await setInstanceStatus(db, instance, status);
    await setContractStatus(db, instance.contractId, "rejected", actorId);
    await notify(db, [instance.startedBy], {
      kind: "flow",
      title: policy === "terminate" ? "合同审批已终止" : "合同被驳回",
      body: `合同 ${String(instance.context.contract.no ?? "")} 需要修改后重新提交`,
      link: `/contracts/${instance.contractId}`,
    });
    await logEvent(db, {
      instanceId: instance.id,
      actorId,
      action: "flow.finished",
      from: "running",
      to: status,
      detail: { policy, opinion: opinion ?? null },
    });
    return;
  }

  const targetId =
    policy === "to_prev" ? previousApprovedNode(instance.definition, runs, run) : policy.slice("to_node:".length);

  if (!targetId) {
    await setInstanceStatus(db, instance, "rejected");
    await setContractStatus(db, instance.contractId, "rejected", actorId);
    return;
  }

  await logEvent(db, {
    instanceId: instance.id,
    nodeRunId: run.id,
    actorId,
    action: "flow.returned",
    detail: { targetId },
  });
  await processQueue(db, instance, [{ nodeId: targetId }], options, activated);
}

function previousApprovedNode(
  definition: FlowDefinition,
  runs: RunLite[],
  current: RunLite,
): string | null {
  const approved = runs.filter(
    (item) =>
      item.id !== current.id &&
      item.status === "approved" &&
      item.nodeType === "approval" &&
      definition.nodes.some((node) => node.id === runBaseNodeId(definition, item)),
  );
  const last = approved.at(-1);
  return last ? runBaseNodeId(definition, last) : null;
}

export async function startFlowInstance(
  db: FlowDb,
  input: {
    contractId: string;
    flowId: string;
    flowVersionId: string;
    definition: FlowDefinition;
    initiatorId: string;
    context: FlowExecutionContext;
    options?: EngineCallOptions;
  },
): Promise<{ instanceId: string; activatedTaskIds: string[] }> {
  const contract = await db.contract.findFirst({
    where: { id: input.contractId, deletedAt: null },
  });
  if (!contract) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "合同不存在");
  }
  const from = contract.status as ContractStatus;
  if (from !== "draft" && from !== "rejected") {
    throw new AppError(ERROR_CODES.CONFLICT, "只有草稿或被驳回的合同可以提交");
  }

  const definition = flowDefinitionSchema.parse(input.definition);

  const instance = await db.flowInstance.create({
    data: {
      contractId: input.contractId,
      flowId: input.flowId,
      flowVersionId: input.flowVersionId,
      definitionSnapshot: definition as unknown as Prisma.InputJsonValue,
      context: input.context as unknown as Prisma.InputJsonValue,
      status: "running",
      startedBy: input.initiatorId,
    },
  });

  await db.contract.update({
    where: { id: input.contractId },
    data: { currentFlowInstanceId: instance.id },
  });
  await setContractStatus(db, input.contractId, "pending", input.initiatorId);
  await logEvent(db, {
    instanceId: instance.id,
    actorId: input.initiatorId,
    action: "flow.started",
    to: "running",
    detail: { contractId: input.contractId },
  });

  const loaded: LoadedInstance = {
    id: instance.id,
    contractId: input.contractId,
    startedBy: input.initiatorId,
    status: "running",
    version: instance.version,
    definition,
    context: input.context,
  };
  const activated: string[] = [];
  await processQueue(
    db,
    loaded,
    [{ nodeId: loaded.definition.entry }],
    input.options ?? {},
    activated,
  );
  return { instanceId: instance.id, activatedTaskIds: activated };
}

export async function decideTask(
  db: FlowDb,
  input: {
    taskId: string;
    actorId: string;
    action: FlowDecisionAction;
    opinion?: string;
    options?: EngineCallOptions;
  },
): Promise<FlowActionResult> {
  const task = await db.flowTask.findFirst({ where: { id: input.taskId, deletedAt: null } });
  if (!task) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "审批任务不存在");
  }
  if (task.assigneeId !== input.actorId) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "该任务不属于你");
  }
  if (task.status !== "pending") {
    throw new AppError(ERROR_CODES.TASK_ALREADY_DECIDED, "该任务已处理");
  }
  if (!task.activatedAt) {
    throw new AppError(ERROR_CODES.CONFLICT, "还没轮到你处理该节点");
  }
  if (task.blockedByNodeRunId) {
    throw new AppError(ERROR_CODES.CONFLICT, "该任务被前加签阻塞");
  }

  const instance = await loadInstance(db, task.instanceId);
  if (instance.status !== "running") {
    throw new AppError(ERROR_CODES.CONFLICT, "审批实例已结束");
  }
  const runRow = await db.flowNodeRun.findUniqueOrThrow({ where: { id: task.nodeRunId } });
  const run = asRun(runRow);
  const node = approvalNode(instance.definition, run);
  const opinion = input.opinion?.trim() ?? "";

  if (node.requiredOpinionOn.includes(input.action) && opinion === "") {
    throw new ValidationError(`节点「${node.name}」的${input.action === "reject" ? "驳回" : "退回"}必须填写意见`, {
      opinion: "请填写审批意见",
    });
  }
  if (input.action === "return" && opinion === "") {
    throw new ValidationError("退回修改必须填写意见", { opinion: "请填写退回原因" });
  }

  const toStatus: TaskStatus =
    input.action === "approve" ? "approved" : input.action === "return" ? "rejected" : "rejected";
  assertTransition("FlowTask", TASK_TRANSITIONS, task.status as TaskStatus, toStatus);

  const claimed = await db.flowTask.updateMany({
    where: { id: task.id, status: "pending" },
    data: {
      status: toStatus,
      action: input.action,
      opinion: opinion === "" ? null : opinion,
      decidedAt: new Date(),
      decidedBy: input.actorId,
    },
  });
  if (claimed.count === 0) {
    throw new AppError(ERROR_CODES.TASK_ALREADY_DECIDED, "该任务已处理");
  }
  await logEvent(db, {
    instanceId: instance.id,
    nodeRunId: run.id,
    taskId: task.id,
    actorId: input.actorId,
    action: `task.${input.action}`,
    from: "pending",
    to: toStatus,
    detail: { opinion: opinion === "" ? null : opinion },
  });

  await touchInstance(db, instance);

  const activated: string[] = [];
  if (input.action === "return") {
    await returnToInitiator(db, instance, run, node, input.actorId, opinion);
  } else {
    await evaluateNodeOutcome(
      db,
      instance,
      run,
      input.actorId,
      opinion || undefined,
      input.options ?? {},
      activated,
    );
  }

  const finalInstance = await db.flowInstance.findUniqueOrThrow({
    where: { id: instance.id },
    select: { status: true },
  });
  const finalContract = await db.contract.findUniqueOrThrow({
    where: { id: instance.contractId },
    select: { status: true },
  });

  return {
    instanceId: instance.id,
    instanceStatus: finalInstance.status as FlowStatus,
    contractStatus: finalContract.status as ContractStatus,
    activatedTaskIds: activated,
  };
}

async function finishAddSignRun(
  db: FlowDb,
  instance: LoadedInstance,
  run: RunLite,
  baseNodeId: string,
  actorId: string,
  options: EngineCallOptions,
  activated: string[],
): Promise<void> {
  const released = await releaseBlockedTasks(db, instance, run.id, actorId, options, activated);
  const openSiblings = await db.flowNodeRun.count({
    where: {
      instanceId: instance.id,
      nodeId: { startsWith: `${baseNodeId}#` },
      status: { in: ["pending", "running", "waiting_join"] },
      deletedAt: null,
    },
  });
  if (released || openSiblings > 0) {
    return;
  }
  const node = findNode(instance.definition, baseNodeId);
  await continueFrom(db, instance, node, options, activated);
}

async function returnToInitiator(
  db: FlowDb,
  instance: LoadedInstance,
  run: RunLite,
  node: ApprovalNode,
  actorId: string,
  opinion: string,
): Promise<void> {
  await cancelPendingTasks(db, instance.id, [run.id], actorId, "审批人退回修改");
  await setRunStatus(db, run, "rejected", { finishedAt: new Date() });
  await cancelEverything(db, instance, actorId, "审批人退回修改");
  await setInstanceStatus(db, instance, "rejected");
  await setContractStatus(db, instance.contractId, "rejected", actorId, "returned");
  await notify(db, [instance.startedBy], {
    kind: "flow",
    title: "合同被退回修改",
    body: `节点「${node.name}」退回：${opinion}`,
    link: `/contracts/${instance.contractId}`,
  });
  await logEvent(db, {
    instanceId: instance.id,
    nodeRunId: run.id,
    actorId,
    action: "flow.returned_to_initiator",
    from: "running",
    to: "rejected",
    detail: { opinion },
  });
}

async function transferTaskInternal(
  db: FlowDb,
  input: {
    taskId: string;
    actorId: string;
    targetUserId: string;
    reason: string;
    options?: EngineCallOptions;
    requireCapability: boolean;
  },
): Promise<{ taskId: string }> {
  const task = await db.flowTask.findFirst({ where: { id: input.taskId, deletedAt: null } });
  if (!task) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "审批任务不存在");
  }
  if (task.assigneeId !== input.actorId) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "该任务不属于你");
  }
  if (task.status !== "pending") {
    throw new AppError(ERROR_CODES.TASK_ALREADY_DECIDED, "该任务已处理");
  }

  const instance = await loadInstance(db, task.instanceId);
  const runRow = await db.flowNodeRun.findUniqueOrThrow({ where: { id: task.nodeRunId } });
  const run = asRun(runRow);
  const node = approvalNode(instance.definition, run);
  if (input.requireCapability && !node.capabilities.transfer) {
    throw new AppError(ERROR_CODES.CONFLICT, `节点「${node.name}」不允许转签`);
  }
  if (input.reason.trim() === "") {
    throw new ValidationError("转签必须填写原因", { reason: "请填写转签原因" });
  }

  const target = await db.user.findFirst({
    where: { id: input.targetUserId, deletedAt: null, status: "active" },
    select: { id: true },
  });
  if (!target) {
    throw new ValidationError("转签对象不存在或已停用");
  }
  const already = await db.flowTask.findFirst({
    where: { nodeRunId: run.id, assigneeId: target.id, deletedAt: null },
  });
  if (already) {
    throw new AppError(ERROR_CODES.CONFLICT, "该审批人已在此节点持有任务");
  }

  const claimed = await db.flowTask.updateMany({
    where: { id: task.id, status: "pending" },
    data: {
      status: "transferred",
      action: "transfer",
      opinion: input.reason,
      decidedAt: new Date(),
      decidedBy: input.actorId,
    },
  });
  if (claimed.count === 0) {
    throw new AppError(ERROR_CODES.TASK_ALREADY_DECIDED, "该任务已处理");
  }

  const created = await db.flowTask.create({
    data: {
      instanceId: instance.id,
      nodeRunId: run.id,
      assigneeId: target.id,
      status: "pending",
      action: null,
      originTaskId: task.id,
      sequenceIndex: task.sequenceIndex,
      activatedAt: task.activatedAt ? new Date() : null,
      dueAt: task.dueAt,
    },
  });
  await addParticipants(db, instance.contractId, [target.id], "approver");
  if (created.activatedAt) {
    await notify(db, [target.id], {
      kind: "task",
      title: "有合同转签给你",
      body: `合同 ${String(instance.context.contract.no ?? "")} 由他人转签给你`,
      link: `/approvals/${instance.id}`,
    });
  }
  await logEvent(db, {
    instanceId: instance.id,
    nodeRunId: run.id,
    taskId: created.id,
    actorId: input.actorId,
    action: "task.transferred",
    from: "pending",
    to: "transferred",
    detail: { targetUserId: target.id, reason: input.reason },
  });

  const activated: string[] = [];
  await evaluateNodeOutcome(db, instance, run, input.actorId, undefined, input.options ?? {}, activated);
  return { taskId: created.id };
}

export async function transferTask(
  db: FlowDb,
  input: {
    taskId: string;
    actorId: string;
    targetUserId: string;
    reason: string;
    options?: EngineCallOptions;
  },
): Promise<{ taskId: string }> {
  return transferTaskInternal(db, { ...input, requireCapability: true });
}

export async function addSignToTask(
  db: FlowDb,
  input: {
    taskId: string;
    actorId: string;
    position: "before" | "after" | "parallel";
    assigneeIds: string[];
    reason: string;
    options?: EngineCallOptions;
  },
): Promise<{ addedTaskIds: string[] }> {
  const task = await db.flowTask.findFirst({ where: { id: input.taskId, deletedAt: null } });
  if (!task) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "审批任务不存在");
  }
  if (task.assigneeId !== input.actorId) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "该任务不属于你");
  }
  if (task.status !== "pending") {
    throw new AppError(ERROR_CODES.TASK_ALREADY_DECIDED, "该任务已处理");
  }
  if (input.assigneeIds.length === 0) {
    throw new ValidationError("请选择加签审批人");
  }

  const instance = await loadInstance(db, task.instanceId);
  const runRow = await db.flowNodeRun.findUniqueOrThrow({ where: { id: task.nodeRunId } });
  const run = asRun(runRow);
  const node = approvalNode(instance.definition, run);
  if (!node.capabilities.addSign.includes(input.position)) {
    throw new AppError(ERROR_CODES.CONFLICT, `节点「${node.name}」不允许${input.position}加签`);
  }

  const users = await db.user.findMany({
    where: { id: { in: input.assigneeIds }, deletedAt: null, status: "active" },
    select: { id: true },
  });
  const validIds = input.assigneeIds.filter((id) => users.some((user) => user.id === id));
  if (validIds.length === 0) {
    throw new ValidationError("加签对象均不可用");
  }

  const addedTaskIds: string[] = [];

  if (input.position === "parallel") {
    for (const assigneeId of validIds) {
      const created = await db.flowTask.create({
        data: {
          instanceId: instance.id,
          nodeRunId: run.id,
          assigneeId,
          status: "pending",
          addSignType: "parallel",
          originTaskId: task.id,
          activatedAt: new Date(),
          dueAt: dueAtFrom(input.options?.now ?? new Date(), node.timeout?.hours),
        },
      });
      addedTaskIds.push(created.id);
      await notify(db, [assigneeId], {
        kind: "task",
        title: "合同并加签待你审批",
        body: `合同 ${String(instance.context.contract.no ?? "")} 并加签给你`,
        link: `/approvals/${instance.id}`,
      });
      await logEvent(db, {
        instanceId: instance.id,
        nodeRunId: run.id,
        taskId: created.id,
        actorId: input.actorId,
        action: "task.add_sign",
        detail: { position: "parallel", originTaskId: task.id, reason: input.reason },
      });
    }
    await addParticipants(db, instance.contractId, validIds, "approver");
    return { addedTaskIds };
  }

  if (input.position === "after") {
    const existing = Array.isArray(runResult(run).afterAddSigns)
      ? (runResult(run).afterAddSigns as unknown[])
      : [];
    await db.flowNodeRun.update({
      where: { id: run.id },
      data: {
        result: {
          ...runResult(run),
          afterAddSigns: [
            ...existing,
            ...validIds.map((assigneeId) => ({ assigneeIds: [assigneeId], originTaskId: task.id })),
          ],
        } as Prisma.InputJsonValue,
      },
    });
    await logEvent(db, {
      instanceId: instance.id,
      nodeRunId: run.id,
      taskId: task.id,
      actorId: input.actorId,
      action: "task.add_sign",
      detail: { position: "after", assigneeIds: validIds, reason: input.reason },
    });
    return { addedTaskIds };
  }

  let blockedRunId: string | null = task.blockedByNodeRunId;
  for (const assigneeId of validIds) {
    const created = await createAddSignRun(
      db,
      instance,
      node,
      run,
      "before",
      assigneeId,
      task.id,
      input.options ?? {},
    );
    if (created) {
      blockedRunId = created;
    }
  }
  if (blockedRunId) {
    await db.flowTask.update({
      where: { id: task.id },
      data: { blockedByNodeRunId: blockedRunId, activatedAt: null },
    });
    await logEvent(db, {
      instanceId: instance.id,
      nodeRunId: run.id,
      taskId: task.id,
      actorId: input.actorId,
      action: "task.blocked_by_add_sign",
      detail: { position: "before", blockedByNodeRunId: blockedRunId },
    });
  }
  return { addedTaskIds };
}

export async function withdrawInstance(
  db: FlowDb,
  input: { instanceId: string; actorId: string; reason?: string },
): Promise<FlowActionResult> {
  const instance = await loadInstance(db, input.instanceId);
  if (instance.startedBy !== input.actorId) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "只有发起人可以撤回");
  }
  if (instance.status !== "running") {
    throw new AppError(ERROR_CODES.CONFLICT, "审批实例已结束，无法撤回");
  }
  const handled = await db.flowTask.count({
    where: { instanceId: instance.id, decidedAt: { not: null }, deletedAt: null },
  });
  if (handled > 0) {
    throw new AppError(ERROR_CODES.CONFLICT, "已有审批人处理，无法撤回");
  }

  await cancelEverything(db, instance, input.actorId, "发起人撤回");
  await setInstanceStatus(db, instance, "withdrawn");
  await setContractStatus(db, instance.contractId, "withdrawn", input.actorId);
  await setContractStatus(db, instance.contractId, "draft", input.actorId);
  await logEvent(db, {
    instanceId: instance.id,
    actorId: input.actorId,
    action: "flow.withdrawn",
    from: "running",
    to: "withdrawn",
    detail: { reason: input.reason ?? null },
  });

  return {
    instanceId: instance.id,
    instanceStatus: "withdrawn",
    contractStatus: "draft",
    activatedTaskIds: [],
  };
}

export type TimeoutResult = {
  scanned: number;
  handled: number;
  skipped: number;
};

export async function processDueTasks(
  db: FlowDb,
  input: { now: Date; limit?: number },
): Promise<TimeoutResult> {
  const due = await db.flowTask.findMany({
    where: {
      status: "pending",
      deletedAt: null,
      activatedAt: { not: null },
      dueAt: { not: null, lt: input.now },
    },
    orderBy: { dueAt: "asc" },
    take: input.limit ?? 200,
  });

  let handled = 0;
  let skipped = 0;

  for (const task of due) {
    const instance = await db.flowInstance.findFirst({
      where: { id: task.instanceId, status: "running", deletedAt: null },
    });
    if (!instance) {
      skipped += 1;
      continue;
    }
    const runRow = await db.flowNodeRun.findUnique({ where: { id: task.nodeRunId } });
    if (!runRow) {
      skipped += 1;
      continue;
    }
    const loaded = await loadInstance(db, instance.id);
    const node = approvalNode(loaded.definition, asRun(runRow));
    if (!node.timeout) {
      skipped += 1;
      continue;
    }

    const action = node.timeout.action;
    const key = `timeout:${action}:${task.id}:${task.dueAt?.toISOString() ?? "none"}`;
    try {
      await db.idempotencyKey.create({
        data: {
          key,
          scope: "flow_timeout",
          response: { taskId: task.id, action } as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        skipped += 1;
        continue;
      }
      throw error;
    }

    if (action === "remind") {
      await notify(db, [task.assigneeId], {
        kind: "timeout",
        title: "审批即将超期",
        body: `合同 ${String(loaded.context.contract.no ?? "")} 的审批任务已超期`,
        link: `/approvals/${loaded.id}`,
      });
      await logEvent(db, {
        instanceId: loaded.id,
        nodeRunId: runRow.id,
        taskId: task.id,
        actorId: SYSTEM_ACTOR,
        action: "task.timeout_reminded",
        detail: { dueAt: task.dueAt?.toISOString() ?? null },
      });
      handled += 1;
      continue;
    }

    if (action === "transfer_to_manager") {
      const manager = await resolveAssignees(
        db,
        { kind: "expression", expression: "initiator.manager" },
        {
          initiatorId: loaded.startedBy,
          departmentId: null,
          managerUserId:
            typeof loaded.context.initiator.managerUserId === "string"
              ? loaded.context.initiator.managerUserId
              : null,
          formData: loaded.context.form,
        },
      );
      const targetId = manager.userIds[0];
      if (!targetId) {
        skipped += 1;
        continue;
      }
      await transferTaskInternal(db, {
        taskId: task.id,
        actorId: task.assigneeId,
        targetUserId: targetId,
        reason: "超时自动转签给上级",
        requireCapability: false,
      });
      handled += 1;
      continue;
    }

    const decision: FlowDecisionAction = action === "auto_approve" ? "approve" : "reject";
    await decideTask(db, {
      taskId: task.id,
      actorId: task.assigneeId,
      action: decision,
      opinion: action === "auto_approve" ? "超时自动通过" : "超时自动驳回",
      options: { now: input.now },
    });
    await db.flowTask.update({
      where: { id: task.id },
      data: { action: action === "auto_approve" ? "auto_approve" : "auto_reject" },
    });
    handled += 1;
  }

  return { scanned: due.length, handled, skipped };
}

export async function runWithFlowRetry<T>(
  run: TransactionRunner,
  operation: (db: FlowDb) => Promise<T>,
  retries = FLOW_MAX_RETRIES,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await run(operation);
    } catch (error) {
      const conflict =
        error instanceof AppError && error.code === ERROR_CODES.CONFLICT;
      if (!conflict || attempt >= retries) {
        throw error;
      }
      attempt += 1;
    }
  }
}
