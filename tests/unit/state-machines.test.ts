import { describe, expect, it } from "vitest";
import { IllegalTransitionError } from "@/shared/errors";
import {
  CONTRACT_TRANSITIONS,
  FLOW_TRANSITIONS,
  NODE_RUN_TRANSITIONS,
  TASK_TRANSITIONS,
  assertTransition,
  canTransition,
  type ContractStatus,
  type FlowStatus,
} from "@/shared/state-machines";

const CONTRACT_ALLOWED: ReadonlyArray<readonly [ContractStatus, ContractStatus]> = [
  ["draft", "pending"],
  ["pending", "approving"],
  ["pending", "withdrawn"],
  ["approving", "approved"],
  ["approving", "rejected"],
  ["approving", "withdrawn"],
  ["approved", "to_seal"],
  ["to_seal", "sealed"],
  ["sealed", "active"],
  ["active", "amended"],
  ["active", "expired"],
  ["active", "terminated"],
  ["active", "archived"],
  ["rejected", "pending"],
  ["withdrawn", "draft"],
  ["amended", "archived"],
  ["expired", "archived"],
  ["terminated", "archived"],
];

describe("合同状态机", () => {
  it.each(CONTRACT_ALLOWED)("允许 %s -> %s", (from, to) => {
    expect(canTransition(CONTRACT_TRANSITIONS, from, to)).toBe(true);
    expect(() =>
      assertTransition("contract", CONTRACT_TRANSITIONS, from, to),
    ).not.toThrow();
  });

  it("拒绝 approved -> draft", () => {
    expect(canTransition(CONTRACT_TRANSITIONS, "approved", "draft")).toBe(false);
  });

  it("归档后不可再迁移", () => {
    expect(CONTRACT_TRANSITIONS.archived).toEqual([]);
  });

  it("非法迁移抛出 IllegalTransitionError", () => {
    expect(() =>
      assertTransition("contract", CONTRACT_TRANSITIONS, "approved", "draft"),
    ).toThrow(IllegalTransitionError);
    expect(() =>
      assertTransition("contract", CONTRACT_TRANSITIONS, "archived", "active"),
    ).toThrow(/非法状态迁移/);
  });
});

describe("流程实例状态机", () => {
  const allowed: ReadonlyArray<readonly [FlowStatus, FlowStatus]> = [
    ["running", "approved"],
    ["running", "rejected"],
    ["running", "withdrawn"],
    ["running", "terminated"],
    ["running", "cancelled"],
  ];

  it.each(allowed)("允许 %s -> %s", (from, to) => {
    expect(canTransition(FLOW_TRANSITIONS, from, to)).toBe(true);
  });

  it("已 approved 的实例不能改回 running", () => {
    expect(canTransition(FLOW_TRANSITIONS, "approved", "running")).toBe(false);
    expect(() =>
      assertTransition("flow", FLOW_TRANSITIONS, "approved", "running"),
    ).toThrow(IllegalTransitionError);
  });

  it("终态不可再次迁移", () => {
    for (const terminal of ["approved", "rejected", "withdrawn", "terminated", "cancelled"] as const) {
      expect(FLOW_TRANSITIONS[terminal]).toEqual([]);
    }
  });
});

describe("节点与任务状态机", () => {
  it("节点运行态允许进入汇聚等待", () => {
    expect(canTransition(NODE_RUN_TRANSITIONS, "running", "waiting_join")).toBe(true);
    expect(canTransition(NODE_RUN_TRANSITIONS, "waiting_join", "approved")).toBe(true);
  });

  it("任务只能从 pending 决策一次", () => {
    expect(canTransition(TASK_TRANSITIONS, "pending", "approved")).toBe(true);
    expect(canTransition(TASK_TRANSITIONS, "approved", "rejected")).toBe(false);
  });
});
