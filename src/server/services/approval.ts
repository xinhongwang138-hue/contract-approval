import type { Prisma } from "@/generated/prisma/client";
import type { AccessContext } from "@/server/auth/access";
import { requireContractAccess } from "@/server/auth/access";
import { recordAudit } from "@/server/audit";
import { prisma } from "@/server/db/client";
import { resolveAssignees } from "@/server/flow/assignee";
import { runWithFlowRetry, startFlowInstance } from "@/server/flow/engine";
import { validateFlowDefinition } from "@/server/flow/validate";
import {
  flowDefinitionSchema,
  type FlowDefinition,
  type FlowNodeType,
} from "@/shared/flow-definition";
import { AppError, ERROR_CODES, ValidationError } from "@/shared/errors";
import { isEditableContractStatus } from "@/shared/contract-status";
import type { ContractStatus } from "@/shared/state-machines";

export type FlowPreviewNode = {
  nodeId: string;
  name: string;
  type: FlowNodeType;
  summary: string;
  assigneeIds: string[];
  assigneeNames: string[];
  dynamic: boolean;
  messages: string[];
};

export type FlowPreview = {
  flowId: string;
  flowName: string;
  flowCode: string;
  version: number;
  nodes: FlowPreviewNode[];
  blocking: string[];
  warnings: string[];
};

export type ContractSummaryForFlow = {
  id: string;
  no: string;
  title: string;
  amount: string;
  currency: string;
  category: string;
  typeKey: string;
  partyAName: string;
  partyBName: string;
  signDate: string;
  startDate: string;
  endDate: string;
  days: number;
  status: ContractStatus;
  stage: string;
};

export function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function daysBetween(start: Date, end: Date): number {
  return Math.max(
    0,
    Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)),
  );
}

export async function loadContract(contractId: string) {
  const contract = await prisma.contract.findFirst({
    where: { id: contractId, deletedAt: null },
    select: {
      id: true,
      no: true,
      title: true,
      amount: true,
      currency: true,
      signDate: true,
      startDate: true,
      endDate: true,
      status: true,
      stage: true,
      formData: true,
      template: {
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
          flowId: true,
          fieldSchema: true,
        },
      },
      type: { select: { key: true, name: true } },
      partyA: { select: { name: true } },
      partyB: { select: { name: true } },
      creator: {
        select: { id: true, departmentId: true, managerUserId: true },
      },
    },
  });

  if (!contract) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "合同不存在");
  }
  return contract;
}

export function summaryOf(
  contract: NonNullable<Awaited<ReturnType<typeof loadContract>>>,
): ContractSummaryForFlow {
  return {
    id: contract.id,
    no: contract.no,
    title: contract.title,
    amount: contract.amount.toFixed(2),
    currency: contract.currency,
    category: contract.template.category,
    typeKey: contract.type.key,
    partyAName: contract.partyA.name,
    partyBName: contract.partyB.name,
    signDate: dateOnly(contract.signDate),
    startDate: dateOnly(contract.startDate),
    endDate: dateOnly(contract.endDate),
    days: daysBetween(contract.signDate, contract.endDate),
    status: contract.status as ContractStatus,
    stage: contract.stage,
  };
}

function conditionContextOf(
  contract: NonNullable<Awaited<ReturnType<typeof loadContract>>>,
) {
  return {
    contract: {
      id: contract.id,
      no: contract.no,
      title: contract.title,
      amount: Number(contract.amount.toFixed(2)),
      currency: contract.currency,
      category: contract.template.category,
      typeKey: contract.type.key,
      templateCode: contract.template.code,
      partyA: contract.partyA.name,
      partyB: contract.partyB.name,
      signDate: dateOnly(contract.signDate),
      startDate: dateOnly(contract.startDate),
      endDate: dateOnly(contract.endDate),
      days: daysBetween(contract.signDate, contract.endDate),
    },
    form: (contract.formData ?? {}) as Record<string, unknown>,
    initiator: {
      id: contract.creator.id,
      departmentId: contract.creator.departmentId ?? "",
      managerUserId: contract.creator.managerUserId ?? "",
    },
  };
}

async function loadActiveFlow(contract: {
  template: { flowId: string | null };
}): Promise<{
  flowId: string;
  flowVersionId: string;
  flowName: string;
  flowCode: string;
  version: number;
  definition: FlowDefinition;
}> {
  if (!contract.template.flowId) {
    throw new ValidationError(
      "该合同使用的模板尚未关联审批流，请先在「合同模板」中选择流程",
      { flowId: "模板未关联审批流" },
    );
  }

  const flow = await prisma.approvalFlow.findFirst({
    where: { id: contract.template.flowId, deletedAt: null },
    select: {
      id: true,
      name: true,
      code: true,
      versions: {
        where: { status: "active", deletedAt: null },
        orderBy: { version: "desc" },
        take: 1,
        select: { id: true, version: true, definition: true },
      },
    },
  });

  if (!flow) {
    throw new ValidationError("模板关联的审批流不存在或已删除", {
      flowId: "审批流不存在",
    });
  }

  const active = flow.versions[0];
  if (!active) {
    throw new ValidationError(
      `审批流「${flow.name}」尚未发布版本，无法提交`,
      { flowId: "审批流未发布" },
    );
  }

  const parsed = flowDefinitionSchema.safeParse(active.definition);
  if (!parsed.success) {
    throw new ValidationError("已发布的流程定义不合法，请重新发布", {
      flowId: "流程定义不合法",
    });
  }

  return {
    flowId: flow.id,
    flowVersionId: active.id,
    flowName: flow.name,
    flowCode: flow.code,
    version: active.version,
    definition: parsed.data,
  };
}

async function buildPreview(
  contract: NonNullable<Awaited<ReturnType<typeof loadContract>>>,
  flow: Awaited<ReturnType<typeof loadActiveFlow>>,
): Promise<FlowPreview> {
  const context = conditionContextOf(contract);
  const assigneeContext = {
    initiatorId: contract.creator.id,
    departmentId: contract.creator.departmentId,
    managerUserId: contract.creator.managerUserId,
    formData: context.form,
  };

  const blocking: string[] = [];
  const warnings: string[] = [];
  const nodes: FlowPreviewNode[] = [];

  for (const issue of validateFlowDefinition(flow.definition)) {
    if (issue.level === "error") {
      blocking.push(issue.message);
    } else {
      warnings.push(issue.message);
    }
  }

  for (const node of flow.definition.nodes) {
    if (node.type !== "approval" && node.type !== "cc") {
      continue;
    }

    const dynamic =
      node.assignee.kind !== "role" &&
      node.assignee.kind !== "user" &&
      node.assignee.kind !== "initiator_self";
    const resolution = await resolveAssignees(prisma, node.assignee, assigneeContext);
    const names =
      resolution.userIds.length === 0
        ? []
        : (
            await prisma.user.findMany({
              where: { id: { in: resolution.userIds } },
              select: { name: true },
            })
          ).map((user) => user.name);

    const messages = [...resolution.notes];

    if (node.type === "approval") {
      let effective = resolution.userIds;
      if (effective.includes(contract.creator.id)) {
        if (node.selfApprovePolicy === "block") {
          blocking.push(`节点「${node.name}」的审批人只有发起人本人，流程被阻断`);
        } else {
          effective = effective.filter((id) => id !== contract.creator.id);
          messages.push("发起人是唯一审批人，按自审策略跳过");
        }
      }
      if (effective.length === 0) {
        const message = `节点「${node.name}」解析不到审批人`;
        if (node.emptyPolicy === "block_submit") {
          blocking.push(`${message}，提交会被阻断`);
        } else {
          warnings.push(`${message}，将按${node.emptyPolicy}处理`);
        }
      }
    }

    nodes.push({
      nodeId: node.id,
      name: node.name,
      type: node.type,
      summary:
        node.type === "approval"
          ? `${node.mode === "all" ? "会签" : node.mode === "sequential" ? "依次" : "或签"}`
          : "抄送",
      assigneeIds: resolution.userIds,
      assigneeNames: names,
      dynamic,
      messages,
    });
  }

  return {
    flowId: flow.flowId,
    flowName: flow.flowName,
    flowCode: flow.flowCode,
    version: flow.version,
    nodes,
    blocking: [...new Set(blocking)],
    warnings: [...new Set(warnings)],
  };
}

export async function previewContractFlow(
  access: AccessContext,
  contractId: string,
): Promise<{ preview: FlowPreview; contract: ContractSummaryForFlow }> {
  await requireContractAccess(access.userId, contractId, "submit");
  const contract = await loadContract(contractId);
  if (!isEditableContractStatus(contract.status as ContractStatus)) {
    throw new AppError(ERROR_CODES.CONFLICT, "只有草稿或被驳回的合同可以提交");
  }
  const flow = await loadActiveFlow(contract);
  const preview = await buildPreview(contract, flow);
  return { preview, contract: summaryOf(contract) };
}

export async function submitContract(
  access: AccessContext,
  contractId: string,
): Promise<{ instanceId: string; no: string }> {
  await requireContractAccess(access.userId, contractId, "submit");
  const full = await loadContract(contractId);
  if (!isEditableContractStatus(full.status as ContractStatus)) {
    throw new AppError(ERROR_CODES.CONFLICT, "只有草稿或被驳回的合同可以提交");
  }

  const flow = await loadActiveFlow(full);
  const preview = await buildPreview(full, flow);
  if (preview.blocking.length > 0) {
    throw new ValidationError(preview.blocking.slice(0, 3).join("；"), {
      flowId: preview.blocking[0] ?? "流程校验未通过",
    });
  }

  const context = conditionContextOf(full);
  const resubmitting = (full.status as ContractStatus) === "rejected";

  const result = await runWithFlowRetry(
    (fn) => prisma.$transaction(fn),
    async (tx) => {
      if (resubmitting) {
        await tx.contractVersion.updateMany({
          where: { contractId, version: 1 },
          data: { changeSummary: "驳回后重新提交" },
        });
      }

      const started = await startFlowInstance(tx, {
        contractId,
        flowId: flow.flowId,
        flowVersionId: flow.flowVersionId,
        definition: flow.definition,
        initiatorId: access.userId,
        context,
        options: { now: new Date() },
      });

      const submitted = await tx.contract.findUniqueOrThrow({
        where: { id: contractId },
        select: { status: true },
      });

      await recordAudit(tx, {
        actorId: access.userId,
        action: "contract.submit",
        entity: "Contract",
        entityId: contractId,
        before: { status: full.status, flowInstanceId: null },
        after: {
          status: submitted.status,
          flowInstanceId: started.instanceId,
          flowVersion: flow.version,
        },
      });

      return started;
    },
  );

  return { instanceId: result.instanceId, no: full.no };
}

const APPROVE_PERMISSION = "contract.approve";

export async function activePrincipalIds(
  userId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const rows = await prisma.delegate.findMany({
    where: {
      toUserId: userId,
      deletedAt: null,
      startAt: { lte: now },
      endAt: { gte: now },
      permissionKeys: { has: APPROVE_PERMISSION },
    },
    select: { fromUserId: true },
  });
  return rows.map((row) => row.fromUserId);
}

export type ApprovalTodoItem = {
  taskId: string;
  instanceId: string;
  contractId: string;
  contractNo: string;
  title: string;
  amount: string;
  currency: string;
  nodeName: string;
  mode: string;
  assigneeId: string;
  assigneeName: string;
  delegated: boolean;
  dueAt: Date | null;
  createdAt: Date;
  overdue: boolean;
};

export type InitiatedItem = {
  instanceId: string;
  contractId: string;
  contractNo: string;
  title: string;
  amount: string;
  currency: string;
  status: string;
  contractStatus: ContractStatus;
  startedAt: Date;
  currentNodeNames: string[];
};

export type CcItem = {
  contractId: string;
  contractNo: string;
  title: string;
  amount: string;
  currency: string;
  contractStatus: ContractStatus;
  createdAt: Date;
};

export type Workbench = {
  pending: ApprovalTodoItem[];
  overdue: ApprovalTodoItem[];
  initiated: InitiatedItem[];
  cc: CcItem[];
  counts: { pending: number; overdue: number; initiated: number; cc: number };
};

const TODO_INCLUDE = {
  instance: {
    select: {
      id: true,
      status: true,
      contract: {
        select: {
          id: true,
          no: true,
          title: true,
          amount: true,
          currency: true,
        },
      },
    },
  },
  nodeRun: { select: { id: true, nodeId: true, nodeName: true, result: true } },
  assignee: { select: { id: true, name: true } },
} satisfies Prisma.FlowTaskInclude;

type TodoRow = Prisma.FlowTaskGetPayload<{ include: typeof TODO_INCLUDE }>;

function toTodoItem(row: TodoRow, delegated: boolean, now: Date): ApprovalTodoItem {
  const contract = row.instance.contract;
  return {
    taskId: row.id,
    instanceId: row.instance.id,
    contractId: contract.id,
    contractNo: contract.no,
    title: contract.title,
    amount: contract.amount.toFixed(2),
    currency: contract.currency,
    nodeName: row.nodeRun.nodeName,
    mode:
      typeof row.nodeRun.result === "object" && row.nodeRun.result !== null
        ? String((row.nodeRun.result as Record<string, unknown>).mode ?? "")
        : "",
    assigneeId: row.assignee.id,
    assigneeName: row.assignee.name,
    delegated,
    dueAt: row.dueAt,
    createdAt: row.createdAt,
    overdue: row.dueAt !== null && row.dueAt.getTime() < now.getTime(),
  };
}

export async function getWorkbench(
  access: AccessContext,
  now: Date = new Date(),
): Promise<Workbench> {
  const principals = await activePrincipalIds(access.userId, now);
  const ownerIds = [access.userId, ...principals];

  const taskWhere = (overdue: boolean): Prisma.FlowTaskWhereInput => ({
    deletedAt: null,
    status: "pending",
    activatedAt: { not: null },
    assigneeId: { in: ownerIds },
    instance: { deletedAt: null, status: "running" },
    ...(overdue ? { dueAt: { lt: now } } : {}),
  });

  const [pendingRows, overdueRows, pendingTotal, overdueTotal] = await Promise.all([
    prisma.flowTask.findMany({
      where: taskWhere(false),
      include: TODO_INCLUDE,
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      take: 10,
    }),
    prisma.flowTask.findMany({
      where: taskWhere(true),
      include: TODO_INCLUDE,
      orderBy: { dueAt: "asc" },
      take: 10,
    }),
    prisma.flowTask.count({ where: taskWhere(false) }),
    prisma.flowTask.count({ where: taskWhere(true) }),
  ]);

  const initiatedWhere: Prisma.FlowInstanceWhereInput = {
    deletedAt: null,
    startedBy: access.userId,
    status: "running",
    contract: { deletedAt: null },
  };

  const [initiatedRows, initiatedTotal, ccRows, ccTotal] = await Promise.all([
    prisma.flowInstance.findMany({
      where: initiatedWhere,
      orderBy: { startedAt: "desc" },
      take: 10,
      select: {
        id: true,
        startedAt: true,
        status: true,
        contract: {
          select: {
            id: true,
            no: true,
            title: true,
            amount: true,
            currency: true,
            status: true,
          },
        },
        nodeRuns: {
          where: { status: { in: ["running", "waiting_join", "pending"] } },
          select: { nodeName: true },
        },
      },
    }),
    prisma.flowInstance.count({ where: initiatedWhere }),
    prisma.contractParticipant.findMany({
      where: { userId: access.userId, kind: "cc", contract: { deletedAt: null } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        createdAt: true,
        contract: {
          select: {
            id: true,
            no: true,
            title: true,
            amount: true,
            currency: true,
            status: true,
          },
        },
      },
    }),
    prisma.contractParticipant.count({
      where: { userId: access.userId, kind: "cc", contract: { deletedAt: null } },
    }),
  ]);

  return {
    pending: pendingRows.map((row) =>
      toTodoItem(row, row.assigneeId !== access.userId, now),
    ),
    overdue: overdueRows.map((row) =>
      toTodoItem(row, row.assigneeId !== access.userId, now),
    ),
    initiated: initiatedRows.map((row) => ({
      instanceId: row.id,
      contractId: row.contract.id,
      contractNo: row.contract.no,
      title: row.contract.title,
      amount: row.contract.amount.toFixed(2),
      currency: row.contract.currency,
      status: row.status,
      contractStatus: row.contract.status as ContractStatus,
      startedAt: row.startedAt,
      currentNodeNames: row.nodeRuns.map((node) => node.nodeName),
    })),
    cc: ccRows.map((row) => ({
      contractId: row.contract.id,
      contractNo: row.contract.no,
      title: row.contract.title,
      amount: row.contract.amount.toFixed(2),
      currency: row.contract.currency,
      contractStatus: row.contract.status as ContractStatus,
      createdAt: row.createdAt,
    })),
    counts: {
      pending: pendingTotal,
      overdue: overdueTotal,
      initiated: initiatedTotal,
      cc: ccTotal,
    },
  };
}
