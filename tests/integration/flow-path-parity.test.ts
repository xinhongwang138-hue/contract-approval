import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAccessContext } from "@/server/auth/access";
import { prisma } from "@/server/db/client";
import { decideTask, runWithFlowRetry } from "@/server/flow/engine";
import { previewContractFlow, submitContract } from "@/server/services/approval";
import { setTemplateFlow } from "@/server/services/flow";
import { prepareFlowWorld, resetFlowData, type FlowWorld } from "../helpers/flow";

let world: FlowWorld;

async function publish(definition: unknown): Promise<string> {
  const { flowId, flowVersionId } = await world.createFlow(definition);
  await prisma.approvalFlowVersion.update({
    where: { id: flowVersionId },
    data: { status: "active" },
  });
  await prisma.approvalFlow.update({ where: { id: flowId }, data: { latestVersion: 1 } });
  return flowId;
}

async function grantRole(label: string, approverCount: number): Promise<string> {
  const key = `parity_${label}_${world.suffix.toLowerCase()}`;
  const role = await prisma.role.create({ data: { key, name: `金标角色-${label}` } });
  for (const userId of world.approverIds.slice(0, approverCount)) {
    await prisma.userRole.create({ data: { userId, roleId: role.id } });
  }
  return key;
}

function approval(nodeId: string, name: string, roleKey: string, next: unknown, mode = "any") {
  return {
    id: nodeId,
    type: "approval",
    name,
    assignee: { kind: "role", key: roleKey },
    mode,
    next,
  };
}

/** 一路同意到实例结束，返回实际生成过待办的审批节点 id */
async function driveToCompletion(instanceId: string): Promise<string[]> {
  // 一次只处理一条并重新读状态：或签同意后会取消同节点其他待办，
  // 批量取列表再逐条决策会撞上「该任务已处理」。
  for (let step = 0; step < 50; step += 1) {
    const task = await prisma.flowTask.findFirst({
      where: {
        instanceId,
        status: "pending",
        activatedAt: { not: null },
        blockedByNodeRunId: null,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, assigneeId: true },
    });
    if (!task) {
      break;
    }
    await runWithFlowRetry(
      (fn) => prisma.$transaction(fn),
      (tx) =>
        decideTask(tx, {
          taskId: task.id,
          actorId: task.assigneeId,
          action: "approve",
          opinion: "金标用例同意",
        }),
    );
  }

  const runs = await prisma.flowNodeRun.findMany({
    where: { instanceId, tasks: { some: {} } },
    select: { nodeId: true },
  });
  return runs.map((run) => run.nodeId);
}

async function parity(input: {
  label: string;
  definition: unknown;
  amount: string;
  expected: string[];
  firstNode: string;
}): Promise<void> {
  const access = await getAccessContext(world.initiatorId);
  const flowId = await publish(input.definition);
  await setTemplateFlow(world.templateId, flowId, world.initiatorId);
  const contractId = await world.createContract({ amount: input.amount });

  const { preview } = await previewContractFlow(access, contractId);
  expect(preview.blocking).toEqual([]);
  const previewIds = preview.nodes
    .filter((node) => node.type === "approval")
    .map((node) => node.nodeId);
  expect(previewIds.sort()).toEqual([...input.expected].sort());

  const started = await submitContract(access, contractId);
  const firstTasks = await prisma.flowTask.findMany({
    where: { instanceId: started.instanceId, status: "pending" },
    select: { nodeRunId: true },
  });
  const firstRuns = await prisma.flowNodeRun.findMany({
    where: { id: { in: firstTasks.map((task) => task.nodeRunId) } },
    select: { nodeId: true },
  });
  expect([...new Set(firstRuns.map((run) => run.nodeId))]).toEqual([input.firstNode]);

  const actual = await driveToCompletion(started.instanceId);
  expect([...new Set(actual)].sort()).toEqual([...input.expected].sort());

  const instance = await prisma.flowInstance.findUniqueOrThrow({
    where: { id: started.instanceId },
  });
  expect(instance.status).toBe("approved");
}

beforeAll(async () => {
  world = await prepareFlowWorld(["p1", "p2", "p3", "p4"]);
});

beforeEach(async () => {
  await resetFlowData();
});

describe("flow path parity", () => {
  it("小额条件分支：预览与引擎都只走部门主管", async () => {
    const roleKey = await grantRole("small", 1);
    await parity({
      label: "small",
      amount: "180000.00",
      firstNode: "dept",
      expected: ["dept"],
      definition: {
        schemaVersion: 1,
        entry: "start",
        nodes: [
          { id: "start", type: "start", name: "发起", next: "amount" },
          {
            id: "amount",
            type: "condition",
            name: "金额分流",
            branches: [
              {
                id: "big",
                name: "50 万以上",
                when: { left: "contract.amount", op: "gte", right: 500000 },
                next: "legal",
              },
              { id: "small", name: "50 万以下", when: null, next: "dept" },
            ],
          },
          approval("legal", "法务审核", roleKey, "end"),
          approval("dept", "部门主管审批", roleKey, "end"),
          { id: "end", type: "end", name: "结束", result: "approved" },
        ],
      },
    });
  });

  it("大额条件分支：预览与引擎都走法务再到总经理", async () => {
    const roleKey = await grantRole("big", 1);
    await parity({
      label: "big",
      amount: "680000.00",
      firstNode: "legal",
      expected: ["legal", "ceo"],
      definition: {
        schemaVersion: 1,
        entry: "start",
        nodes: [
          { id: "start", type: "start", name: "发起", next: "amount" },
          {
            id: "amount",
            type: "condition",
            name: "金额分流",
            branches: [
              {
                id: "big",
                name: "50 万以上",
                when: { left: "contract.amount", op: "gte", right: 500000 },
                next: "legal",
              },
              { id: "small", name: "50 万以下", when: null, next: "dept" },
            ],
          },
          approval("legal", "法务审核", roleKey, "ceo"),
          approval("ceo", "总经理审批", roleKey, "end", "all"),
          approval("dept", "部门主管审批", roleKey, "end"),
          { id: "end", type: "end", name: "结束", result: "approved" },
        ],
      },
    });
  });

  it("并行 fork：预览列出的分支与汇聚后的节点都会真实生成待办", async () => {
    const roleKey = await grantRole("fork", 2);
    await parity({
      label: "fork",
      amount: "680000.00",
      firstNode: "legal",
      expected: ["legal", "finance", "risk"],
      definition: {
        schemaVersion: 1,
        entry: "start",
        nodes: [
          { id: "start", type: "start", name: "发起", next: "legal" },
          approval("legal", "法务审核", roleKey, ["finance", "risk"]),
          approval("finance", "财务审核", roleKey, "merge"),
          approval("risk", "风控审核", roleKey, "merge"),
          { id: "merge", type: "join", name: "并行汇聚", next: "end" },
          { id: "end", type: "end", name: "结束", result: "approved" },
        ],
      },
    });
  });

  it("四人会签：一个节点多条待办，预览只算一个节点", async () => {
    const roleKey = await grantRole("all", 4);
    await parity({
      label: "all",
      amount: "680000.00",
      firstNode: "board",
      expected: ["board"],
      definition: {
        schemaVersion: 1,
        entry: "start",
        nodes: [
          { id: "start", type: "start", name: "发起", next: "board" },
          approval("board", "四人会签", roleKey, "end", "all"),
          { id: "end", type: "end", name: "结束", result: "approved" },
        ],
      },
    });
  });
});
