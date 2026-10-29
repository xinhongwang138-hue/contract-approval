import { collectNodeTargets, type FlowDefinition } from "@/shared/flow-definition";

export function incomingEdgeCount(definition: FlowDefinition, nodeId: string): number {
  let count = 0;
  for (const node of definition.nodes) {
    if (node.id === nodeId) {
      continue;
    }
    if (collectNodeTargets(node).includes(nodeId)) {
      count += 1;
    }
  }
  return count;
}

export function isJoinReady(joined: number, awaiting: number): boolean {
  return joined >= awaiting;
}

export function nextAttempt(
  runs: { nodeId: string; attempt: number }[],
  nodeId: string,
): number {
  const attempts = runs.filter((run) => run.nodeId === nodeId).map((run) => run.attempt);
  return attempts.length === 0 ? 1 : Math.max(...attempts) + 1;
}

export function addSignRunId(
  baseNodeId: string,
  position: "before" | "after",
  originTaskId: string,
  assigneeId: string,
): string {
  return `${baseNodeId}#${position}#${originTaskId.slice(-6)}#${assigneeId.slice(-6)}`;
}

export function addSignBaseNodeId(runNodeId: string): string | null {
  const hash = runNodeId.indexOf("#");
  return hash === -1 ? null : runNodeId.slice(0, hash);
}

export function forkTargets(definition: FlowDefinition, nodeId: string): string[][] {
  const node = definition.nodes.find((item) => item.id === nodeId);
  if (!node || node.type === "end") {
    return [];
  }
  if (node.type === "condition") {
    return node.branches
      .map((branch) => branch.next)
      .filter((next): next is string[] => Array.isArray(next));
  }
  return Array.isArray(node.next) ? [node.next] : [];
}
