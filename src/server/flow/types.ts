import type { Prisma } from "@/generated/prisma/client";
import type { FlowDefinition, FlowNode } from "@/shared/flow-definition";
import type { ContractStatus, FlowStatus } from "@/shared/state-machines";

export type FlowDb = Prisma.TransactionClient;

export type TransactionRunner = <T>(
  fn: (db: FlowDb) => Promise<T>,
) => Promise<T>;

export type FlowExecutionContext = {
  contract: Record<string, unknown>;
  form: Record<string, unknown>;
  initiator: Record<string, unknown>;
};

export type WebhookDispatcher = {
  post: (target: string, payload: Record<string, unknown>) => Promise<void>;
};

export type EngineCallOptions = {
  now?: Date;
  webhook?: WebhookDispatcher;
};

export type FlowDecisionAction = "approve" | "reject" | "return";

export type FlowActionResult = {
  instanceId: string;
  instanceStatus: FlowStatus;
  contractStatus: ContractStatus;
  activatedTaskIds: string[];
};

export type LoadedInstance = {
  id: string;
  contractId: string;
  startedBy: string;
  status: FlowStatus;
  version: number;
  definition: FlowDefinition;
  context: FlowExecutionContext;
};

export type NodeRunRow = {
  id: string;
  instanceId: string;
  nodeId: string;
  nodeType: string;
  nodeName: string;
  status: string;
  attempt: number;
  awaitingCount: number | null;
  joinedCount: number;
  result: unknown;
  version: number;
};

export type TaskRow = {
  id: string;
  instanceId: string;
  nodeRunId: string;
  assigneeId: string;
  status: string;
  action: string | null;
  opinion: string | null;
  sequenceIndex: number | null;
  activatedAt: Date | null;
  dueAt: Date | null;
  originTaskId: string | null;
  addSignType: string | null;
  blockedByNodeRunId: string | null;
  decidedAt: Date | null;
};

export type AddSignPosition = "before" | "after" | "parallel";

export function nodeRunResult(run: NodeRunRow): {
  baseNodeId?: string;
  afterAddSigns?: { assigneeIds: string[]; originTaskId: string }[];
  branchId?: string;
  reason?: string;
} {
  return typeof run.result === "object" && run.result !== null
    ? (run.result as ReturnType<typeof nodeRunResult>)
    : {};
}

export function definitionNode(
  definition: FlowDefinition,
  nodeId: string,
  runs: NodeRunRow[],
): FlowNode {
  const direct = definition.nodes.find((node) => node.id === nodeId);
  if (direct) {
    return direct;
  }
  const run = runs.find((item) => item.nodeId === nodeId);
  if (run) {
    const base = nodeRunResult(run).baseNodeId;
    const resolved = base ? definition.nodes.find((node) => node.id === base) : undefined;
    if (resolved) {
      return resolved;
    }
  }
  throw new Error(`流程定义中找不到节点 ${nodeId}`);
}
