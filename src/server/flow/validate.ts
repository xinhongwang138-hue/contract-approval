import {
  collectNodeTargets,
  flowDefinitionSchema,
  type FlowDefinition,
  type FlowNode,
} from "@/shared/flow-definition";

export type FlowValidationLevel = "error" | "warning";

export type FlowValidationIssue = {
  level: FlowValidationLevel;
  code: string;
  message: string;
  nodeId?: string;
};

export type FlowApproverResolution = {
  nodeId: string;
  assigneeIds: string[];
};

export type FlowValidationOptions = {
  approvers?: FlowApproverResolution[];
  initiatorId?: string;
};

function indexNodes(definition: FlowDefinition): Map<string, FlowNode> {
  return new Map(definition.nodes.map((node) => [node.id, node]));
}

function reachableFrom(entry: string, nodes: Map<string, FlowNode>): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = [entry];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const node = nodes.get(id);
    if (!node) {
      continue;
    }
    queue.push(...collectNodeTargets(node));
  }
  return seen;
}

function findCycles(definition: FlowDefinition, nodes: Map<string, FlowNode>): Set<string> {
  const cyclic = new Set<string>();
  const state = new Map<string, "visiting" | "done">();

  const visit = (id: string, stack: string[]): void => {
    if (state.get(id) === "done") {
      return;
    }
    if (state.get(id) === "visiting") {
      const start = stack.indexOf(id);
      for (const member of stack.slice(start === -1 ? 0 : start)) {
        cyclic.add(member);
      }
      cyclic.add(id);
      return;
    }
    const node = nodes.get(id);
    if (!node) {
      state.set(id, "done");
      return;
    }
    state.set(id, "visiting");
    const nextStack = [...stack, id];
    for (const target of collectNodeTargets(node)) {
      visit(target, nextStack);
    }
    state.set(id, "done");
  };

  visit(definition.entry, []);
  return cyclic;
}

function incomingEdges(definition: FlowDefinition): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of definition.nodes) {
    for (const target of collectNodeTargets(node)) {
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
  }
  return counts;
}

function validateGraph(definition: FlowDefinition, issues: FlowValidationIssue[]): void {
  const nodes = indexNodes(definition);

  if (!nodes.has(definition.entry)) {
    issues.push({
      level: "error",
      code: "ENTRY_UNKNOWN",
      message: `入口节点 ${definition.entry} 不存在`,
    });
    return;
  }

  for (const node of definition.nodes) {
    for (const target of collectNodeTargets(node)) {
      if (!nodes.has(target)) {
        issues.push({
          level: "error",
          code: "UNKNOWN_TARGET",
          message: `节点「${node.name}」的下一跳 ${target} 不存在`,
          nodeId: node.id,
        });
      }
    }

    if (node.type === "approval") {
      const policy = node.reject.policy;
      if (policy.startsWith("to_node:")) {
        const target = policy.slice("to_node:".length);
        if (!nodes.has(target)) {
          issues.push({
            level: "error",
            code: "REJECT_TARGET_UNKNOWN",
            message: `节点「${node.name}」的驳回目标 ${target} 不存在`,
            nodeId: node.id,
          });
        } else if (target === node.id) {
          issues.push({
            level: "error",
            code: "REJECT_TARGET_SELF",
            message: `节点「${node.name}」不能驳回给自己`,
            nodeId: node.id,
          });
        }
      }
    }
  }

  const reachable = reachableFrom(definition.entry, nodes);
  for (const node of definition.nodes) {
    if (!reachable.has(node.id)) {
      issues.push({
        level: "error",
        code: "UNREACHABLE_NODE",
        message: `节点「${node.name}」从入口不可达`,
        nodeId: node.id,
      });
    }
  }

  const incoming = incomingEdges(definition);
  for (const node of definition.nodes) {
    if (node.type === "join" && (incoming.get(node.id) ?? 0) < 2) {
      issues.push({
        level: "error",
        code: "JOIN_SINGLE_INCOMING",
        message: `汇聚节点「${node.name}」需要至少两条入边`,
        nodeId: node.id,
      });
    }
  }

  for (const node of definition.nodes) {
    if (node.type === "end" || !reachable.has(node.id)) {
      continue;
    }
    const forks: string[][] = [];
    if (node.type === "condition") {
      for (const branch of node.branches) {
        if (Array.isArray(branch.next)) {
          forks.push(branch.next);
        }
      }
    } else if (Array.isArray(node.next)) {
      forks.push(node.next);
    }
    for (const branch of forks) {
      for (const target of branch) {
        const downstream = reachableFrom(target, nodes);
        const hasJoin = [...downstream].some((id) => nodes.get(id)?.type === "join");
        if (!hasJoin) {
          issues.push({
            level: "error",
            code: "FORK_WITHOUT_JOIN",
            message: `节点「${node.name}」的并行分支 ${target} 未汇聚到 join 节点`,
            nodeId: node.id,
          });
        }
      }
    }
  }

  const cycles = findCycles(definition, nodes);
  for (const id of cycles) {
    const node = nodes.get(id);
    if (node) {
      issues.push({
        level: "error",
        code: "CYCLE",
        message: `节点「${node.name}」位于环路中，退回与重跑由引擎处理，定义不允许成环`,
        nodeId: id,
      });
    }
  }

  const reachableEnds = [...reachable].filter((id) => nodes.get(id)?.type === "end");
  if (reachableEnds.length === 0) {
    issues.push({
      level: "error",
      code: "END_UNREACHABLE",
      message: "从入口无法到达任何 end 节点",
    });
  }
}

function validateApprovers(
  definition: FlowDefinition,
  options: FlowValidationOptions,
  issues: FlowValidationIssue[],
): void {
  if (!options.approvers) {
    return;
  }

  const resolutions = new Map(options.approvers.map((item) => [item.nodeId, item]));
  for (const node of definition.nodes) {
    if (node.type !== "approval") {
      continue;
    }
    const resolution = resolutions.get(node.id);
    if (!resolution) {
      issues.push({
        level: "error",
        code: "APPROVER_NOT_RESOLVED",
        message: `节点「${node.name}」尚未解析审批人，无法确认是否为空`,
        nodeId: node.id,
      });
      continue;
    }

    if (resolution.assigneeIds.length === 0) {
      issues.push({
        level: node.emptyPolicy === "block_submit" ? "error" : "warning",
        code: "EMPTY_APPROVER",
        message:
          node.emptyPolicy === "block_submit"
            ? `节点「${node.name}」解析不到审批人，提交会被阻断`
            : `节点「${node.name}」解析不到审批人，将按 ${node.emptyPolicy} 处理`,
        nodeId: node.id,
      });
      continue;
    }

    const onlyInitiator =
      options.initiatorId !== undefined &&
      resolution.assigneeIds.length === 1 &&
      resolution.assigneeIds[0] === options.initiatorId;
    if (onlyInitiator) {
      issues.push({
        level: node.selfApprovePolicy === "block" ? "error" : "warning",
        code: node.selfApprovePolicy === "block" ? "SELF_APPROVE_BLOCKED" : "SELF_APPROVE_SKIPPED",
        message:
          node.selfApprovePolicy === "block"
            ? `节点「${node.name}」的审批人只有发起人本人，流程被阻断`
            : `节点「${node.name}」的审批人只有发起人本人，将按自审策略跳过`,
        nodeId: node.id,
      });
    }
  }
}

export function validateFlowDefinition(
  raw: unknown,
  options: FlowValidationOptions = {},
): FlowValidationIssue[] {
  const issues: FlowValidationIssue[] = [];
  const parsed = flowDefinitionSchema.safeParse(raw);

  if (!parsed.success) {
    const nodes = Array.isArray((raw as { nodes?: unknown[] })?.nodes)
      ? (raw as { nodes: FlowNode[] }).nodes
      : [];
    for (const issue of parsed.error.issues) {
      const index = issue.path[1];
      const nodeId = typeof index === "number" ? nodes[index]?.id : undefined;
      issues.push({
        level: "error",
        code: "SCHEMA_INVALID",
        message: `${issue.path.join(".")}: ${issue.message}`,
        ...(nodeId ? { nodeId } : {}),
      });
    }
    return issues;
  }

  validateGraph(parsed.data, issues);
  validateApprovers(parsed.data, options, issues);
  return issues;
}

export function hasBlockingIssue(issues: FlowValidationIssue[]): boolean {
  return issues.some((issue) => issue.level === "error");
}
