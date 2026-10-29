import type { FlowValidationIssue } from "@/server/flow/validate";
import { assigneeSummary } from "@/server/flow/assignee";
import type {
  AssigneeConfig,
  FlowNodeType,
} from "@/shared/flow-definition";

export type { FlowNodeType } from "@/shared/flow-definition";

export type NodeRecord = Record<string, unknown>;
export type DefinitionRecord = {
  schemaVersion: number;
  entry: string;
  nodes: NodeRecord[];
};

export type TargetRef = {
  nodeId?: string;
  branchId?: string;
  index?: number;
  entry?: boolean;
};

export const NODE_TYPE_LABELS: Record<FlowNodeType, string> = {
  start: "发起",
  approval: "审批",
  cc: "抄送",
  condition: "条件分支",
  join: "并行汇聚",
  action: "自动动作",
  end: "结束",
};

let idSeed = 0;

export function newNodeId(prefix: string): string {
  idSeed += 1;
  return `${prefix}${Date.now().toString(36).slice(-4)}${idSeed.toString(36)}`;
}

export function idOf(node: NodeRecord | undefined): string {
  return typeof node?.id === "string" ? node.id : "";
}

export function labelOf(node: NodeRecord | undefined, fallback = "未命名"): string {
  return typeof node?.name === "string" && node.name !== "" ? node.name : fallback;
}

export function isDefaultBranch(branch: NodeRecord): boolean {
  return branch.when === null || branch.when === undefined;
}

export function parseDefinition(raw: unknown): DefinitionRecord | null {
  const record = raw as Partial<DefinitionRecord> | null;
  if (
    !record ||
    typeof record.entry !== "string" ||
    !Array.isArray(record.nodes)
  ) {
    return null;
  }
  return {
    schemaVersion: typeof record.schemaVersion === "number" ? record.schemaVersion : 1,
    entry: record.entry,
    nodes: record.nodes as NodeRecord[],
  };
}

export function findNode(definition: DefinitionRecord, nodeId: string): NodeRecord | undefined {
  return definition.nodes.find((node) => node.id === nodeId);
}

export function nodeType(node: NodeRecord | undefined): FlowNodeType {
  const type = node?.type;
  return typeof type === "string" && type in NODE_TYPE_LABELS
    ? (type as FlowNodeType)
    : "approval";
}

export function nodeName(node: NodeRecord | undefined): string {
  return typeof node?.name === "string" ? node.name : String(node?.id ?? "未命名");
}

function readRef(definition: DefinitionRecord, ref: TargetRef): string | string[] | null {
  if (ref.entry) {
    return definition.entry;
  }
  const node = ref.nodeId ? findNode(definition, ref.nodeId) : undefined;
  if (!node) {
    return null;
  }
  if (ref.branchId && Array.isArray(node.branches)) {
    const branch = (node.branches as NodeRecord[]).find(
      (item) => item.id === ref.branchId,
    );
    return (branch?.next as string | string[] | undefined) ?? null;
  }
  if (typeof ref.index === "number" && Array.isArray(node.next)) {
    return (node.next as string[])[ref.index] ?? null;
  }
  return (node.next as string | string[] | null) ?? null;
}

function writeRef(
  definition: DefinitionRecord,
  ref: TargetRef,
  value: string | string[],
): void {
  if (ref.entry) {
    definition.entry = value as string;
    return;
  }
  const node = ref.nodeId ? findNode(definition, ref.nodeId) : undefined;
  if (!node) {
    return;
  }
  if (ref.branchId && Array.isArray(node.branches)) {
    const branch = (node.branches as NodeRecord[]).find(
      (item) => item.id === ref.branchId,
    );
    if (branch) {
      branch.next = value;
    }
    return;
  }
  if (typeof ref.index === "number" && Array.isArray(node.next)) {
    (node.next as string[])[ref.index] = value as string;
    return;
  }
  node.next = value;
}

export function cloneDefinition(definition: DefinitionRecord): DefinitionRecord {
  return JSON.parse(JSON.stringify(definition)) as DefinitionRecord;
}

export function createNode(type: FlowNodeType, next: string): NodeRecord {
  const id = newNodeId(
    type === "approval" ? "appr" : type === "cc" ? "cc" : type === "condition" ? "cond" : type === "join" ? "join" : type === "action" ? "act" : "node",
  );

  switch (type) {
    case "approval":
      return {
        id,
        type: "approval",
        name: "审批节点",
        assignee: { kind: "role", key: "manager" } satisfies AssigneeConfig,
        mode: "any",
        minApproveRatio: 1,
        emptyPolicy: "block_submit",
        selfApprovePolicy: "skip",
        reject: { policy: "to_initiator" },
        timeout: null,
        requiredOpinionOn: [],
        capabilities: {
          addSign: ["before", "after", "parallel"],
          transfer: true,
          return: true,
          delegate: true,
        },
        visibleFieldKeys: [],
        next,
      };
    case "cc":
      return {
        id,
        type: "cc",
        name: "抄送",
        assignee: { kind: "role", key: "legal" } satisfies AssigneeConfig,
        next,
      };
    case "condition":
      return {
        id,
        type: "condition",
        name: "条件分支",
        branches: [
          {
            id: newNodeId("br"),
            name: "条件一",
            when: { left: "contract.amount", op: "gte", right: 500000 },
            next,
          },
          { id: newNodeId("br"), name: "默认", when: null, next },
        ],
      };
    case "join":
      return { id, type: "join", name: "并行汇聚", next: [next, next] };
    case "action":
      return {
        id,
        type: "action",
        name: "自动动作",
        kind: "notify",
        payload: {},
        next,
      };
    default:
      return { id, type: "approval", name: "审批节点", next };
  }
}

export function insertNode(
  definition: DefinitionRecord,
  ref: TargetRef,
  type: FlowNodeType,
): { definition: DefinitionRecord; nodeId: string } {
  const next = cloneDefinition(definition);
  const target = readRef(next, ref);
  const node = createNode(type, typeof target === "string" ? target : "end");
  if (Array.isArray(target)) {
    node.next = target;
  }
  next.nodes.push(node);
  const createdId = String(node.id);
  writeRef(next, ref, createdId);
  return { definition: next, nodeId: createdId };
}

export function forkBranch(
  definition: DefinitionRecord,
  ref: TargetRef,
): DefinitionRecord {
  const next = cloneDefinition(definition);
  const target = readRef(next, ref);
  if (Array.isArray(target)) {
    target.push(typeof target[0] === "string" ? target[0] : "end");
    return next;
  }
  writeRef(next, ref, [target as string, target as string]);
  return next;
}

export function removeNode(
  definition: DefinitionRecord,
  nodeId: string,
): { definition: DefinitionRecord; error?: string } {
  const node = findNode(definition, nodeId);
  if (!node) {
    return { definition, error: "节点不存在" };
  }
  if (node.type === "start" || node.type === "end") {
    return { definition, error: "发起与结束节点不可删除" };
  }
  const nextTarget = node.next;
  if (Array.isArray(nextTarget) || node.type === "condition") {
    return {
      definition,
      error: "该节点带分支，请先删除分支或改为串行后再删除节点",
    };
  }

  const next = cloneDefinition(definition);
  const replacement = typeof nextTarget === "string" ? nextTarget : "end";
  for (const candidate of next.nodes) {
    if (candidate.id === replacement) {
      continue;
    }
    if (candidate.next === nodeId) {
      candidate.next = replacement;
    } else if (Array.isArray(candidate.next)) {
      candidate.next = (candidate.next as string[]).map((item) =>
        item === nodeId ? replacement : item,
      );
    }
    if (Array.isArray(candidate.branches)) {
      for (const branch of candidate.branches as NodeRecord[]) {
        if (branch.next === nodeId) {
          branch.next = replacement;
        } else if (Array.isArray(branch.next)) {
          branch.next = (branch.next as string[]).map((item) =>
            item === nodeId ? replacement : item,
          );
        }
      }
    }
  }
  if (next.entry === nodeId) {
    next.entry = replacement;
  }
  next.nodes = next.nodes.filter((item) => item.id !== nodeId);
  return { definition: next };
}

export function updateNode(
  definition: DefinitionRecord,
  nodeId: string,
  patch: NodeRecord,
): DefinitionRecord {
  const next = cloneDefinition(definition);
  const node = findNode(next, nodeId);
  if (!node) {
    return next;
  }
  Object.assign(node, patch);
  return next;
}

export function addConditionBranch(
  definition: DefinitionRecord,
  nodeId: string,
): DefinitionRecord {
  const next = cloneDefinition(definition);
  const node = findNode(next, nodeId);
  if (!node || !Array.isArray(node.branches)) {
    return next;
  }
  const branches = node.branches as NodeRecord[];
  const fallbackIndex = branches.findIndex((branch) => branch.when === null);
  const template = fallbackIndex === -1 ? branches[0] : branches[fallbackIndex];
  const created: NodeRecord = {
    id: newNodeId("br"),
    name: `条件${branches.length + 1}`,
    when: { left: "contract.amount", op: "gte", right: 100000 },
    next: template?.next ?? "end",
  };
  if (fallbackIndex === -1) {
    branches.push({
      id: newNodeId("br"),
      name: "默认",
      when: null,
      next: template?.next ?? "end",
    });
    branches.push(created);
  } else {
    branches.splice(fallbackIndex, 0, created);
  }
  return next;
}

export function removeConditionBranch(
  definition: DefinitionRecord,
  nodeId: string,
  branchId: string,
): DefinitionRecord {
  const next = cloneDefinition(definition);
  const node = findNode(next, nodeId);
  if (!node || !Array.isArray(node.branches)) {
    return next;
  }
  const branches = node.branches as NodeRecord[];
  if (branches.length <= 2) {
    return next;
  }
  const target = branches.find((branch) => branch.id === branchId);
  if (!target || target.when === null) {
    return next;
  }
  node.branches = branches.filter((branch) => branch.id !== branchId);
  return next;
}

export function nodeSummary(node: NodeRecord): string {
  const type = nodeType(node);
  if (type === "approval") {
    const parts = [summarizeAssignee(node.assignee)];
    const mode = node.mode;
    if (mode === "all") {
      parts.push(`会签${typeof node.minApproveRatio === "number" && node.minApproveRatio < 1 ? ` ≥${node.minApproveRatio}` : ""}`);
    } else if (mode === "sequential") {
      parts.push("依次");
    } else {
      parts.push("或签");
    }
    const timeout = node.timeout as { hours?: number; action?: string } | null;
    if (timeout?.hours) {
      parts.push(`${timeout.hours}h ${timeout.action ?? "remind"}`);
    }
    return parts.filter(Boolean).join(" · ");
  }
  if (type === "cc") {
    return `抄送给 ${summarizeAssignee(node.assignee)}`;
  }
  if (type === "condition") {
    const branches = Array.isArray(node.branches) ? node.branches : [];
    return `${branches.length} 个分支`;
  }
  if (type === "join") {
    return "等待所有入边完成";
  }
  if (type === "action") {
    return `动作：${String(node.kind ?? "notify")}`;
  }
  if (type === "end") {
    return `结果：${String(node.result ?? "approved")}`;
  }
  return "流程入口";
}

function summarizeAssignee(raw: unknown): string {
  if (!raw || typeof raw !== "object") {
    return "未配置";
  }
  try {
    return assigneeSummary(raw as AssigneeConfig);
  } catch {
    return "未配置";
  }
}

export function issuesForNode(
  issues: FlowValidationIssue[],
  nodeId: string,
): FlowValidationIssue[] {
  return issues.filter((issue) => issue.nodeId === nodeId);
}

export function readBranches(node: NodeRecord | undefined): NodeRecord[] {
  return Array.isArray(node?.branches) ? (node?.branches as NodeRecord[]) : [];
}

export function readTargets(node: NodeRecord | undefined, branchId?: string): string[] {
  if (!node) {
    return [];
  }
  if (branchId) {
    const branch = readBranches(node).find((item) => item.id === branchId);
    const next = branch?.next;
    return Array.isArray(next) ? (next as string[]) : next ? [next as string] : [];
  }
  const next = node.next;
  return Array.isArray(next) ? (next as string[]) : next ? [next as string] : [];
}

export function isFork(node: NodeRecord | undefined, branchId?: string): boolean {
  if (!node) {
    return false;
  }
  const value = branchId
    ? readBranches(node).find((item) => item.id === branchId)?.next
    : node.next;
  return Array.isArray(value);
}
