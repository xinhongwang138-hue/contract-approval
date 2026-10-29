import { describe, expect, it } from "vitest";
import {
  collectNodeTargets,
  conditionExprSchema,
  flowDefinitionSchema,
  nextTargets,
  parseFlowDefinition,
} from "@/shared/flow-definition";

const nodes = [
  { id: "start", type: "start", name: "发起", next: "legal" },
  {
    id: "legal",
    type: "approval",
    name: "法务审核",
    assignee: { kind: "role", key: "legal" },
    mode: "all",
    minApproveRatio: 0.5,
    reject: { policy: "to_node:start" },
    timeout: { hours: 24, action: "remind" },
    requiredOpinionOn: ["reject", "return"],
    capabilities: { addSign: ["before", "after", "parallel"], transfer: true, return: true, delegate: true },
    visibleFieldKeys: ["amount"],
    next: ["gm", "finance"],
  },
  { id: "gm", type: "approval", name: "总经理", assignee: { kind: "user", ids: ["u-1"] }, next: "merge" },
  { id: "finance", type: "cc", name: "财务抄送", assignee: { kind: "initiator_self" }, next: "merge" },
  { id: "merge", type: "join", name: "汇聚", next: "end" },
  { id: "end", type: "end", name: "结束", result: "approved" },
];

describe("flow definition schema", () => {
  it("parses a definition with defaults filled in", () => {
    const parsed = parseFlowDefinition({ schemaVersion: 1, entry: "start", nodes });
    expect(parsed).not.toBeNull();
    const legal = parsed?.nodes.find((node) => node.id === "legal");
    expect(legal?.type === "approval" && legal.emptyPolicy).toBe("block_submit");
    expect(legal?.type === "approval" && legal.selfApprovePolicy).toBe("skip");
    const gm = parsed?.nodes.find((node) => node.id === "gm");
    expect(gm?.type === "approval" && gm.mode).toBe("any");
    expect(gm?.type === "approval" && gm.capabilities.transfer).toBe(false);
  });

  it("rejects duplicate node ids", () => {
    const result = flowDefinitionSchema.safeParse({
      schemaVersion: 1,
      entry: "start",
      nodes: [...nodes, nodes[0]].map((node, index) =>
        index === nodes.length ? { ...node, id: "start" } : node,
      ),
    });
    expect(result.success).toBe(false);
  });

  it("requires entry to point at the start node", () => {
    const result = flowDefinitionSchema.safeParse({
      schemaVersion: 1,
      entry: "legal",
      nodes,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === "entry")).toBe(true);
  });

  it("requires exactly one default condition branch", () => {
    const condition = {
      id: "route",
      type: "condition",
      name: "分支",
      branches: [
        { id: "b1", name: "大额", when: { left: "contract.amount", op: "gte", right: 1 }, next: "end" },
        { id: "b2", name: "默认", when: null, next: "end" },
        { id: "b3", name: "又一个默认", when: null, next: "end" },
      ],
    };
    const result = flowDefinitionSchema.safeParse({
      schemaVersion: 1,
      entry: "start",
      nodes: [nodes[0], condition, ...nodes.slice(2)],
    });
    expect(result.success).toBe(false);
  });

  it("requires at least two fork targets", () => {
    const result = flowDefinitionSchema.safeParse({
      schemaVersion: 1,
      entry: "start",
      nodes: [
        { id: "start", type: "start", name: "发起", next: ["legal"] },
        { id: "legal", type: "approval", name: "法务", assignee: { kind: "role", key: "legal" }, next: "end" },
        { id: "end", type: "end", name: "结束", result: "approved" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("validates reject policy and ratio ranges", () => {
    const base = {
      id: "legal",
      type: "approval",
      name: "法务",
      assignee: { kind: "role", key: "legal" },
      next: "end",
    };
    expect(
      flowDefinitionSchema.safeParse({
        schemaVersion: 1,
        entry: "start",
        nodes: [nodes[0], { ...base, reject: { policy: "to_node:1bad" } }, nodes[5]],
      }).success,
    ).toBe(false);
    expect(
      flowDefinitionSchema.safeParse({
        schemaVersion: 1,
        entry: "start",
        nodes: [nodes[0], { ...base, minApproveRatio: 1.5 }, nodes[5]],
      }).success,
    ).toBe(false);
    expect(
      flowDefinitionSchema.safeParse({
        schemaVersion: 1,
        entry: "start",
        nodes: [nodes[0], { ...base, reject: { policy: "to_node:legal2" } }, nodes[5]],
      }).success,
    ).toBe(true);
  });
});

describe("condition expression schema", () => {
  it("only allows controlled paths", () => {
    expect(conditionExprSchema.safeParse({ left: "amount", op: "eq", right: 1 }).success).toBe(
      false,
    );
    expect(
      conditionExprSchema.safeParse({ left: "contract.amount", op: "eq", right: 1 }).success,
    ).toBe(true);
    expect(
      conditionExprSchema.safeParse({ left: "contract.partyB.name", op: "eq", right: "x" })
        .success,
    ).toBe(true);
    expect(
      conditionExprSchema.safeParse({ left: "session.user", op: "eq", right: "x" }).success,
    ).toBe(false);
  });

  it("matches operand shape to the operator", () => {
    expect(
      conditionExprSchema.safeParse({ left: "contract.category", op: "in", right: "sales" })
        .success,
      ).toBe(false);
    expect(
      conditionExprSchema.safeParse({
        left: "contract.category",
        op: "in",
        right: ["sales"],
      }).success,
    ).toBe(true);
    expect(
      conditionExprSchema.safeParse({ left: "contract.title", op: "empty", right: "" }).success,
    ).toBe(false);
    expect(
      conditionExprSchema.safeParse({ left: "contract.title", op: "eq" }).success,
    ).toBe(false);
  });

  it("validates nested groups", () => {
    expect(
      conditionExprSchema.safeParse({
        all: [{ any: [{ left: "form.payType", op: "eq", right: "现结" }, { left: "initiator.level", op: "gte", right: 2 }] }],
      }).success,
    ).toBe(true);
    expect(conditionExprSchema.safeParse({ all: [] }).success).toBe(false);
  });
});

describe("node target helpers", () => {
  it("normalizes single and fork targets", () => {
    expect(nextTargets("legal")).toEqual(["legal"]);
    expect(nextTargets(["legal", "gm"])).toEqual(["legal", "gm"]);
  });

  it("collects fork targets from approval and condition nodes", () => {
    const parsed = parseFlowDefinition({ schemaVersion: 1, entry: "start", nodes })!;
    const legal = parsed.nodes.find((node) => node.id === "legal");
    expect(legal).toBeDefined();
    expect(collectNodeTargets(legal!)).toEqual(["gm", "finance"]);
  });

  it("returns no targets for end nodes", () => {
    const parsed = parseFlowDefinition({ schemaVersion: 1, entry: "start", nodes })!;
    const end = parsed.nodes.find((node) => node.type === "end");
    expect(end).toBeDefined();
    expect(collectNodeTargets(end!)).toEqual([]);
  });
});
