import { describe, expect, it } from "vitest";
import { validateFlowDefinition } from "@/server/flow/validate";
import type { FlowNode } from "@/shared/flow-definition";

function definition(nodes: FlowNode[], entry = "start"): unknown {
  return { schemaVersion: 1, entry, nodes };
}

const start = (next: string | string[]): FlowNode => ({
  id: "start",
  type: "start",
  name: "发起",
  next,
});

const approval = (
  id: string,
  next: string | string[],
  overrides: Partial<Extract<FlowNode, { type: "approval" }>> = {},
): FlowNode => ({
  id,
  type: "approval",
  name: `${id}审批`,
  assignee: { kind: "role", key: "manager" },
  mode: "any",
  minApproveRatio: 1,
  emptyPolicy: "block_submit",
  selfApprovePolicy: "skip",
  reject: { policy: "to_initiator" },
  timeout: null,
  requiredOpinionOn: [],
  capabilities: { addSign: [], transfer: true, return: true, delegate: true },
  visibleFieldKeys: [],
  next,
  ...overrides,
});

const end = (id = "end", result: "approved" | "rejected" | "terminated" = "approved"): FlowNode => ({
  id,
  type: "end",
  name: "结束",
  result,
});

const join = (id: string, next: string | string[]): FlowNode => ({
  id,
  type: "join",
  name: `${id}汇聚`,
  next,
});

function codes(issues: ReturnType<typeof validateFlowDefinition>): string[] {
  return issues.map((issue) => issue.code);
}

describe("flow definition graph validation", () => {
  it("accepts a linear flow", () => {
    const issues = validateFlowDefinition(
      definition([start("legal"), approval("legal", "gm"), approval("gm", "end"), end()]),
    );
    expect(issues).toEqual([]);
  });

  it("reports unknown next targets with the source node id", () => {
    const issues = validateFlowDefinition(
      definition([start("ghost"), approval("ghost", "nowhere"), end()]),
    );
    expect(codes(issues)).toContain("UNKNOWN_TARGET");
    expect(
      issues.find((issue) => issue.code === "UNKNOWN_TARGET")?.nodeId,
    ).toBe("ghost");
  });

  it("reports unreachable nodes", () => {
    const issues = validateFlowDefinition(
      definition([start("a"), approval("a", "end"), end(), approval("orphan", "end")]),
    );
    expect(codes(issues)).toContain("UNREACHABLE_NODE");
    expect(issues.find((issue) => issue.code === "UNREACHABLE_NODE")?.nodeId).toBe("orphan");
  });

  it("reports when no end node is reachable", () => {
    const issues = validateFlowDefinition(
      definition([start("a"), approval("a", "b"), approval("b", "a")]),
    );
    expect(codes(issues)).toContain("END_UNREACHABLE");
  });

  it("reports cycles between approval nodes", () => {
    const issues = validateFlowDefinition(
      definition([start("a"), approval("a", "b"), approval("b", "a"), end()]),
    );
    expect(codes(issues)).toContain("CYCLE");
  });

  it("requires a join for parallel forks", () => {
    const forked = definition([
      start(["legal", "finance"]),
      approval("legal", "gm"),
      approval("finance", "gm"),
      approval("gm", "end"),
      end(),
    ]);
    expect(codes(validateFlowDefinition(forked))).toContain("FORK_WITHOUT_JOIN");

    const joined = definition([
      start(["legal", "finance"]),
      approval("legal", "merge"),
      approval("finance", "merge"),
      join("merge", "gm"),
      approval("gm", "end"),
      end(),
    ]);
    expect(validateFlowDefinition(joined)).toEqual([]);
  });

  it("flags a join that only has one incoming edge", () => {
    const issues = validateFlowDefinition(
      definition([
        start("legal"),
        approval("legal", "merge"),
        join("merge", "end"),
        end(),
      ]),
    );
    expect(codes(issues)).toContain("JOIN_SINGLE_INCOMING");
  });

  it("checks reject to_node targets exist", () => {
    const issues = validateFlowDefinition(
      definition([
        start("legal"),
        approval("legal", "gm", { reject: { policy: "to_node:ghost" } }),
        approval("gm", "end"),
        end(),
      ]),
    );
    expect(codes(issues)).toContain("REJECT_TARGET_UNKNOWN");
  });

  it("rejects a condition node without exactly one default branch", () => {
    const condition: FlowNode = {
      id: "route",
      type: "condition",
      name: "金额分支",
      branches: [
        {
          id: "big",
          name: "大额",
          when: { left: "contract.amount", op: "gte", right: 500000 },
          next: "legal",
        },
      ],
    };
    const issues = validateFlowDefinition(
      definition([start("route"), condition, approval("legal", "end"), end()]),
    );
    expect(codes(issues)).toContain("SCHEMA_INVALID");
  });

  it("surfaces schema problems for hand-edited JSON", () => {
    const issues = validateFlowDefinition({ schemaVersion: 1, entry: "start", nodes: [] });
    expect(codes(issues)).toContain("SCHEMA_INVALID");
  });
});

describe("flow definition approver validation", () => {
  it("blocks submission when an approval node resolves to nobody", () => {
    const issues = validateFlowDefinition(
      definition([start("legal"), approval("legal", "end"), end()]),
      { approvers: [{ nodeId: "legal", assigneeIds: [] }] },
    );
    expect(issues.find((issue) => issue.code === "EMPTY_APPROVER")?.level).toBe("error");
  });

  it("warns instead of blocking when the node auto-passes on empty approvers", () => {
    const issues = validateFlowDefinition(
      definition([
        start("legal"),
        approval("legal", "end", { emptyPolicy: "auto_pass" }),
        end(),
      ]),
      { approvers: [{ nodeId: "legal", assigneeIds: [] }] },
    );
    const issue = issues.find((i) => i.code === "EMPTY_APPROVER");
    expect(issue?.level).toBe("warning");
  });

  it("flags unresolved nodes and nodes without resolution data", () => {
    const issues = validateFlowDefinition(
      definition([start("legal"), approval("legal", "end"), end()]),
      { approvers: [] },
    );
    expect(issues.find((issue) => issue.code === "APPROVER_NOT_RESOLVED")?.nodeId).toBe(
      "legal",
    );
  });

  it("applies the self approve policy when the initiator is the only approver", () => {
    const nodes = definition([
      start("legal"),
      approval("legal", "end", { selfApprovePolicy: "block" }),
      end(),
    ]);
    const blocked = validateFlowDefinition(nodes, {
      approvers: [{ nodeId: "legal", assigneeIds: ["u-1"] }],
      initiatorId: "u-1",
    });
    expect(blocked.find((issue) => issue.code === "SELF_APPROVE_BLOCKED")?.level).toBe(
      "error",
    );

    const skipped = validateFlowDefinition(
      definition([
        start("legal"),
        approval("legal", "end", { selfApprovePolicy: "skip" }),
        end(),
      ]),
      { approvers: [{ nodeId: "legal", assigneeIds: ["u-1"] }], initiatorId: "u-1" },
    );
    expect(skipped.find((issue) => issue.code === "SELF_APPROVE_SKIPPED")?.level).toBe(
      "warning",
    );
  });
});
