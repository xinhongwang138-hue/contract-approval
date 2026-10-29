import { requireContractAccess, type AccessContext } from "@/server/auth/access";
import { prisma } from "@/server/db/client";
import { parseFieldSchema, formatContractFieldValue } from "@/shared/contract-fields";
import { AppError, ERROR_CODES } from "@/shared/errors";
import type { FlowDefinition } from "@/shared/flow-definition";
import {
  activePrincipalIds,
  loadContract,
  summaryOf,
  type ContractSummaryForFlow,
} from "./approval";

export type ApprovalTaskView = {
  id: string;
  assigneeId: string;
  assigneeName: string;
  status: string;
  action: string | null;
  opinion: string | null;
  decidedAt: Date | null;
  dueAt: Date | null;
  addSignType: string | null;
  actedAs: string | null;
};

export type ApprovalTrailEntry = {
  nodeRunId: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  tasks: ApprovalTaskView[];
};

export type ApprovalActionCapabilities = {
  addSign: string[];
  transfer: boolean;
  return: boolean;
  delegate: boolean;
  requiredOpinionOn: string[];
  visibleFieldKeys: string[];
  mode: string;
};

export type ApprovalDetailView = {
  instance: {
    id: string;
    status: string;
    startedAt: Date;
    startedBy: string;
    startedByName: string;
    flowName: string;
    flowCode: string;
    flowVersion: number;
  };
  contract: ContractSummaryForFlow & { templateName: string; templateCode: string };
  formEntries: { key: string; label: string; value: string }[];
  bodyMarkdown: string | null;
  attachments: { id: string; name: string; kind: string; size: number }[];
  fieldsRestricted: boolean;
  trail: ApprovalTrailEntry[];
  myTask: {
    taskId: string;
    nodeRunId: string;
    nodeName: string;
    status: string;
    dueAt: Date | null;
    actedAs: string | null;
    capabilities: ApprovalActionCapabilities;
  } | null;
  canWithdraw: boolean;
  withdrawBlockedReason: string | null;
};

const NO_CAPABILITIES: ApprovalActionCapabilities = {
  addSign: [],
  transfer: false,
  return: false,
  delegate: false,
  requiredOpinionOn: [],
  visibleFieldKeys: [],
  mode: "any",
};

function capabilitiesFor(
  definition: FlowDefinition,
  runNodeId: string,
): ApprovalActionCapabilities {
  const baseNodeId = runNodeId.split("#")[0] ?? runNodeId;
  const node = definition.nodes.find((item) => item.id === baseNodeId);
  if (!node || node.type !== "approval") {
    return NO_CAPABILITIES;
  }
  return {
    addSign: node.capabilities.addSign,
    transfer: node.capabilities.transfer,
    return: node.capabilities.return,
    delegate: node.capabilities.delegate,
    requiredOpinionOn: node.requiredOpinionOn,
    visibleFieldKeys: node.visibleFieldKeys,
    mode: node.mode,
  };
}

// 节点的 visibleFieldKeys 在服务端裁剪：空白名单表示全部可见，
// 正文与附件用伪字段 body / attachments 控制。
function filterByVisibility(
  allowed: string[],
  entries: { key: string; label: string; value: string }[],
  body: string | null,
  attachments: { id: string; name: string; kind: string; size: number }[],
): {
  formEntries: { key: string; label: string; value: string }[];
  bodyMarkdown: string | null;
  attachments: { id: string; name: string; kind: string; size: number }[];
  restricted: boolean;
} {
  if (allowed.length === 0) {
    return { formEntries: entries, bodyMarkdown: body, attachments, restricted: false };
  }
  const set = new Set(allowed);
  return {
    formEntries: entries.filter((entry) => set.has(entry.key)),
    bodyMarkdown: set.has("body") ? body : null,
    attachments: set.has("attachments") ? attachments : [],
    restricted: true,
  };
}

function visibleFormEntries(
  fieldSchema: unknown,
  rawForm: Record<string, unknown>,
): { key: string; label: string; value: string }[] {
  return parseFieldSchema(fieldSchema)
    .filter((field) =>
      field.visibleWhen === null
        ? true
        : rawForm[field.visibleWhen.field] !== undefined &&
          String(rawForm[field.visibleWhen.field]) === String(field.visibleWhen.equals),
    )
    .map((field) => ({
      key: field.key,
      label: field.label,
      value: formatContractFieldValue(field, rawForm[field.key]),
    }));
}

export async function getApprovalDetail(
  access: AccessContext,
  instanceId: string,
  now: Date = new Date(),
): Promise<ApprovalDetailView> {
  const instance = await prisma.flowInstance.findFirst({
    where: { id: instanceId, deletedAt: null },
    include: {
      starter: { select: { id: true, name: true } },
      flow: { select: { name: true, code: true } },
      flowVersion: { select: { version: true } },
    },
  });
  if (!instance) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "审批实例不存在");
  }

  await requireContractAccess(access.userId, instance.contractId, "read");

  const contract = await loadContract(instance.contractId);
  const latestVersion = await prisma.contractVersion.findFirst({
    where: { contractId: contract.id, deletedAt: null },
    orderBy: { version: "desc" },
    select: { bodyMarkdown: true },
  });
  const attachments = await prisma.attachment.findMany({
    where: { contractId: contract.id, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, kind: true, size: true },
  });

  const definition = instance.definitionSnapshot as unknown as FlowDefinition;
  const principals = await activePrincipalIds(access.userId, now);
  const viewerIds = new Set([access.userId, ...principals]);

  const nodeRuns = await prisma.flowNodeRun.findMany({
    where: { instanceId, deletedAt: null },
    orderBy: [{ startedAt: "asc" }, { attempt: "asc" }],
    include: {
      tasks: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        include: { assignee: { select: { id: true, name: true } } },
      },
    },
  });

  const mine = nodeRuns
    .flatMap((run) => run.tasks.map((task) => ({ task, run })))
    .filter((item) => viewerIds.has(item.task.assigneeId))
    .sort((left, right) => {
      const leftOpen = left.task.status === "pending" ? 0 : 1;
      const rightOpen = right.task.status === "pending" ? 0 : 1;
      if (leftOpen !== rightOpen) {
        return leftOpen - rightOpen;
      }
      return right.run.startedAt.getTime() - left.run.startedAt.getTime();
    })[0] ?? null;

  const capabilities = mine
    ? capabilitiesFor(definition, mine.run.nodeId)
    : NO_CAPABILITIES;

  const allEntries = visibleFormEntries(
    contract.template.fieldSchema,
    (contract.formData ?? {}) as Record<string, unknown>,
  );
  const filtered = filterByVisibility(
    capabilities.visibleFieldKeys,
    allEntries,
    latestVersion?.bodyMarkdown ?? null,
    attachments,
  );

  const decided = await prisma.flowTask.count({
    where: { instanceId, decidedAt: { not: null }, deletedAt: null },
  });

  return {
    instance: {
      id: instance.id,
      status: instance.status,
      startedAt: instance.startedAt,
      startedBy: instance.startedBy,
      startedByName: instance.starter.name,
      flowName: instance.flow.name,
      flowCode: instance.flow.code,
      flowVersion: instance.flowVersion.version,
    },
    contract: {
      ...summaryOf(contract),
      templateName: contract.template.name,
      templateCode: contract.template.code,
    },
    formEntries: filtered.formEntries,
    bodyMarkdown: filtered.bodyMarkdown,
    attachments: filtered.attachments,
    fieldsRestricted: filtered.restricted,
    trail: nodeRuns.map((run) => ({
      nodeRunId: run.id,
      nodeId: run.nodeId,
      nodeName: run.nodeName,
      nodeType: run.nodeType,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      tasks: run.tasks.map((task) => ({
        id: task.id,
        assigneeId: task.assigneeId,
        assigneeName: task.assignee.name,
        status: task.status,
        action: task.action,
        opinion: task.opinion,
        decidedAt: task.decidedAt,
        dueAt: task.dueAt,
        addSignType: task.addSignType,
        actedAs: viewerIds.has(task.assigneeId) && task.assigneeId !== access.userId
          ? task.assignee.name
          : null,
      })),
    })),
    myTask: mine
      ? {
          taskId: mine.task.id,
          nodeRunId: mine.run.id,
          nodeName: mine.run.nodeName,
          status: mine.task.status,
          dueAt: mine.task.dueAt,
          actedAs:
            mine.task.assigneeId === access.userId
              ? null
              : mine.task.assignee.name,
          capabilities,
        }
      : null,
    canWithdraw:
      instance.startedBy === access.userId &&
      instance.status === "running" &&
      decided === 0,
    withdrawBlockedReason:
      instance.startedBy === access.userId &&
      instance.status === "running" &&
      decided > 0
        ? "已有审批人处理，无法撤回"
        : null,
  };
}

export async function getContractTimeline(
  access: AccessContext,
  contractId: string,
): Promise<{
  contract: ContractSummaryForFlow;
  instances: {
    instanceId: string;
    flowName: string;
    flowVersion: number;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    startedByName: string;
    trail: ApprovalTrailEntry[];
  }[];
}> {
  await requireContractAccess(access.userId, contractId, "read");
  const contract = await loadContract(contractId);

  const instances = await prisma.flowInstance.findMany({
    where: { contractId, deletedAt: null },
    orderBy: { startedAt: "asc" },
    include: {
      starter: { select: { name: true } },
      flow: { select: { name: true } },
      flowVersion: { select: { version: true } },
      nodeRuns: {
        where: { deletedAt: null },
        orderBy: [{ startedAt: "asc" }, { attempt: "asc" }],
        include: {
          tasks: {
            where: { deletedAt: null },
            orderBy: { createdAt: "asc" },
            include: { assignee: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });

  return {
    contract: summaryOf(contract),
    instances: instances.map((instance) => ({
      instanceId: instance.id,
      flowName: instance.flow.name,
      flowVersion: instance.flowVersion.version,
      status: instance.status,
      startedAt: instance.startedAt,
      finishedAt: instance.finishedAt,
      startedByName: instance.starter.name,
      trail: instance.nodeRuns.map((run) => ({
        nodeRunId: run.id,
        nodeId: run.nodeId,
        nodeName: run.nodeName,
        nodeType: run.nodeType,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        tasks: run.tasks.map((task) => ({
          id: task.id,
          assigneeId: task.assigneeId,
          assigneeName: task.assignee.name,
          status: task.status,
          action: task.action,
          opinion: task.opinion,
          decidedAt: task.decidedAt,
          dueAt: task.dueAt,
          addSignType: task.addSignType,
          actedAs: null,
        })),
      })),
    })),
  };
}
