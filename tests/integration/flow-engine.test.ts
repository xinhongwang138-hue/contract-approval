import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import {
  addSignToTask,
  decideTask,
  processDueTasks,
  runWithFlowRetry,
  startFlowInstance,
  transferTask,
  withdrawInstance,
} from "@/server/flow/engine";
import { prepareFlowWorld, resetFlowData, type FlowWorld } from "../helpers/flow";

let world: FlowWorld;

function approval(
  id: string,
  assigneeIds: string[],
  next: string | string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    type: "approval",
    name: id,
    assignee: { kind: "user", ids: assigneeIds },
    next,
    ...extra,
  };
}

function definition(nodes: Record<string, unknown>[]): Record<string, unknown> {
  return { schemaVersion: 1, entry: "start", nodes };
}

function contextOf(contractId: string, amount: number, no = "HT-TEST") {
  return {
    contract: { id: contractId, no, amount, category: "sales", days: 10 },
    form: { contact: "张三" },
    initiator: { departmentId: "", managerUserId: "" },
  };
}

async function start(
  contractId: string,
  def: Record<string, unknown>,
  amount = 100000,
  managerUserId = "",
): Promise<{ instanceId: string; flowVersionId: string; flowId: string }> {
  const { flowId, flowVersionId } = await world.createFlow(def);
  const result = await prisma.$transaction((tx) =>
    startFlowInstance(tx, {
      contractId,
      flowId,
      flowVersionId,
      definition: def as never,
      initiatorId: world.initiatorId,
      context: {
        ...contextOf(contractId, amount),
        initiator: { departmentId: "", managerUserId },
      },
    }),
  );
  return { instanceId: result.instanceId, flowVersionId, flowId };
}

async function tasksOf(instanceId: string, nodeId: string) {
  return prisma.flowTask.findMany({
    where: { instanceId, nodeRun: { nodeId } },
    orderBy: { createdAt: "asc" },
  });
}

async function runOf(instanceId: string, nodeId: string) {
  const rows = await prisma.flowNodeRun.findMany({
    where: { instanceId, nodeId },
    orderBy: { attempt: "desc" },
  });
  return rows[0];
}

async function decide(taskId: string, actorId: string, action: "approve" | "reject" | "return", opinion?: string) {
  return prisma.$transaction((tx) =>
    decideTask(tx, { taskId, actorId, action, opinion }),
  );
}

function firstOf<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) {
    throw new Error("期望至少一条记录");
  }
  return row;
}

beforeAll(async () => {
  world = await prepareFlowWorld(["a", "b", "c", "d", "e", "f"]);
});

beforeEach(async () => {
  await resetFlowData();
});

// 流程行引用合同与相对方，必须在本套件结束时清掉，否则后续套件无法重置主数据。
afterAll(async () => {
  await resetFlowData();
});

describe("engine node entry", () => {
  it("creates a node run, one task per approver, a notification and an event log", async () => {
    const contractId = await world.createContract();
    const [a, b] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!, b!], "end"),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const tasks = await tasksOf(instanceId, "legal");
    expect(tasks.map((task) => task.assigneeId).sort()).toEqual([a!, b!].sort());
    expect(tasks.every((task) => task.activatedAt !== null)).toBe(true);

    const run = await runOf(instanceId, "legal");
    expect(run?.status).toBe("running");

    const notifications = await prisma.notification.findMany({
      where: { userId: { in: [a!, b!] }, kind: "task" },
    });
    expect(notifications).toHaveLength(2);

    const events = await prisma.flowEventLog.findMany({
      where: { instanceId, action: "node.entered" },
    });
    expect(events).toHaveLength(1);

    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe("approving");
    expect(contract.currentFlowInstanceId).toBe(instanceId);
  });

  it("blocks submission when an approval node resolves to nobody", async () => {
    const contractId = await world.createContract();
    const def = definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      {
        id: "legal",
        type: "approval",
        name: "法务",
        assignee: { kind: "role", key: `missing_role_${world.suffix.toLowerCase()}` },
        next: "end",
      },
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]);
    const { flowId, flowVersionId } = await world.createFlow(def);

    await expect(
      prisma.$transaction((tx) =>
        startFlowInstance(tx, {
          contractId,
          flowId,
          flowVersionId,
          definition: def as never,
          initiatorId: world.initiatorId,
          context: contextOf(contractId, 1),
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe("draft");
  });

  it("auto-passes an empty node when the policy allows it", async () => {
    const contractId = await world.createContract();
    const [a] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "empty" },
      {
        id: "empty",
        type: "approval",
        name: "空节点",
        assignee: { kind: "role", key: `missing_role_${world.suffix.toLowerCase()}` },
        emptyPolicy: "auto_pass",
        next: "legal",
      },
      approval("legal", [a!], "end"),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const emptyRun = await runOf(instanceId, "empty");
    expect(emptyRun?.status).toBe("approved");
    expect(await tasksOf(instanceId, "empty")).toHaveLength(0);
    expect(await tasksOf(instanceId, "legal")).toHaveLength(1);
  });

  it("skips the initiator when they are the only approver", async () => {
    const contractId = await world.createContract();
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "self" },
      approval("self", [world.initiatorId], "end"),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const instance = await prisma.flowInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(instance.status).toBe("approved");
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe("approved");
  });
});

describe("engine approval modes", () => {
  it("any-sign: one approval passes the node and cancels the rest", async () => {
    const contractId = await world.createContract();
    const [a, b, c] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!, b!, c!], "gm"),
      approval("gm", [world.bossId], "end"),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const tasks = await tasksOf(instanceId, "legal");
    const result = await decide(firstOf(tasks).id, a!, "approve");
    expect(result.instanceStatus).toBe("running");

    const after = await tasksOf(instanceId, "legal");
    expect(after.find((task) => task.id === firstOf(tasks).id)?.status).toBe("approved");
    expect(after.filter((task) => task.status === "cancelled")).toHaveLength(2);
    expect(await runOf(instanceId, "legal")).toMatchObject({ status: "approved" });
    expect(await tasksOf(instanceId, "gm")).toHaveLength(1);
  });

  it("all-sign: a single rejection rejects the node and cancels the third task", async () => {
    const contractId = await world.createContract();
    const [a, b, c] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!, b!, c!], "end", { mode: "all" }),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const tasks = await tasksOf(instanceId, "legal");
    await decide(firstOf(tasks).id, a!, "approve");
    await decide(tasks[1]!.id, b!, "reject", "条款不完整");

    const cancelled = tasks[2]!;
    expect((await prisma.flowTask.findUniqueOrThrow({ where: { id: cancelled.id } })).status).toBe(
      "cancelled",
    );
    await expect(decide(cancelled.id, c!, "approve")).rejects.toMatchObject({
      code: "TASK_ALREADY_DECIDED",
      status: 409,
    });

    const instance = await prisma.flowInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(instance.status).toBe("rejected");
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe("rejected");
  });

  it("all-sign with minApproveRatio 0.5 passes on the third of four votes", async () => {
    const contractId = await world.createContract();
    const [a, b, c, d] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!, b!, c!, d!], "end", { mode: "all", minApproveRatio: 0.5 }),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const tasks = await tasksOf(instanceId, "legal");
    await decide(firstOf(tasks).id, a!, "approve");
    const afterSecond = await decide(tasks[1]!.id, b!, "approve");
    expect(afterSecond.instanceStatus).toBe("running");
    expect((await prisma.flowTask.findUniqueOrThrow({ where: { id: tasks[2]!.id } })).status).toBe(
      "pending",
    );

    const third = await decide(tasks[2]!.id, c!, "approve");
    expect(third.instanceStatus).toBe("approved");
    expect((await prisma.flowTask.findUniqueOrThrow({ where: { id: tasks[3]!.id } })).status).toBe(
      "cancelled",
    );
  });

  it("sequential mode activates one approver at a time", async () => {
    const contractId = await world.createContract();
    const [a, b, c] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!, b!, c!], "end", { mode: "sequential" }),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const tasks = await tasksOf(instanceId, "legal");
    expect(tasks.filter((task) => task.activatedAt !== null)).toHaveLength(1);
    await expect(decide(tasks[2]!.id, c!, "approve")).rejects.toMatchObject({
      code: "CONFLICT",
    });

    await decide(firstOf(tasks).id, a!, "approve");
    const second = await tasksOf(instanceId, "legal");
    expect(second.find((task) => task.id === tasks[1]!.id)?.activatedAt).not.toBeNull();
    expect(await runOf(instanceId, "legal")).toMatchObject({ status: "running" });

    await decide(tasks[1]!.id, b!, "approve");
    await decide((await tasksOf(instanceId, "legal"))[2]!.id, c!, "approve");
    const instance = await prisma.flowInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(instance.status).toBe("approved");
  });
});

describe("engine branching, fork and join", () => {
  it("takes the amount branch and re-evaluates after the amount changes", async () => {
    const small = await world.createContract({ amount: "100000.00" });
    const [a, b] = world.approverIds;
    const def = definition([
      { id: "start", type: "start", name: "发起", next: "route" },
      {
        id: "route",
        type: "condition",
        name: "金额分支",
        branches: [
          {
            id: "big",
            name: "大额",
            when: { left: "contract.amount", op: "gte", right: 500000 },
            next: ["legal", "gm"],
          },
          { id: "default", name: "默认", when: null, next: "leader" },
        ],
      },
      approval("leader", [world.leaderId], "end"),
      approval("legal", [a!], "merge"),
      approval("gm", [b!], "merge"),
      { id: "merge", type: "join", name: "汇聚", next: "end" },
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]);

    const smallRun = await start(small, def, 100000);
    expect(await tasksOf(smallRun.instanceId, "leader")).toHaveLength(1);
    expect(await tasksOf(smallRun.instanceId, "legal")).toHaveLength(0);

    const big = await world.createContract({ amount: "600000.00" });
    const bigRun = await start(big, def, 600000);
    expect(await tasksOf(bigRun.instanceId, "legal")).toHaveLength(1);
    expect(await tasksOf(bigRun.instanceId, "gm")).toHaveLength(1);
    expect(await tasksOf(bigRun.instanceId, "leader")).toHaveLength(0);
  });

  it("waits at the join until every branch arrives", async () => {
    const contractId = await world.createContract({ amount: "600000.00" });
    const [a, b] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: ["legal", "finance"] },
      approval("legal", [a!], "merge"),
      approval("finance", [b!], "merge"),
      { id: "merge", type: "join", name: "汇聚", next: "boss" },
      approval("boss", [world.bossId], "end"),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const legalTask = firstOf(await tasksOf(instanceId, "legal"));
    await decide(legalTask.id, a!, "approve");

    const join = await runOf(instanceId, "merge");
    expect(join?.status).toBe("waiting_join");
    expect(join?.joinedCount).toBe(1);
    expect(await tasksOf(instanceId, "boss")).toHaveLength(0);

    const financeTask = firstOf(await tasksOf(instanceId, "finance"));
    await decide(financeTask.id, b!, "approve");
    expect(await tasksOf(instanceId, "boss")).toHaveLength(1);
  });

  it("counts every arrival when parallel branches are decided at the same time", async () => {
    const contractId = await world.createContract({ amount: "600000.00" });
    const [a, b] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: ["legal", "finance"] },
      approval("legal", [a!], "merge"),
      approval("finance", [b!], "merge"),
      { id: "merge", type: "join", name: "汇聚", next: "boss" },
      approval("boss", [world.bossId], "end"),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const legalTask = firstOf(await tasksOf(instanceId, "legal"));
    const financeTask = firstOf(await tasksOf(instanceId, "finance"));

    const results = await Promise.allSettled(
      [
        { taskId: legalTask.id, actorId: a! },
        { taskId: financeTask.id, actorId: b! },
      ].map((input) =>
        runWithFlowRetry(
          (fn) => prisma.$transaction(fn),
          (tx) => decideTask(tx, { ...input, action: "approve" }),
        ),
      ),
    );
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);

    // 汇聚计数是读-改-写，靠实例版本锁串行化；丢一次累加就会永远停在 waiting_join
    const joins = await prisma.flowNodeRun.findMany({
      where: { instanceId, nodeId: "merge" },
    });
    expect(joins).toHaveLength(1);
    expect(joins[0]?.joinedCount).toBe(2);
    expect(joins[0]?.status).toBe("approved");
    expect(await prisma.flowEventLog.count({ where: { instanceId, action: "node.joined" } })).toBe(1);
    expect(await tasksOf(instanceId, "boss")).toHaveLength(1);
  });

  it("cancels the in-flight sibling branch when one branch rejects", async () => {
    const contractId = await world.createContract({ amount: "600000.00" });
    const [a, b] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: ["legal", "finance"] },
      approval("legal", [a!], "merge"),
      approval("finance", [b!], "merge"),
      { id: "merge", type: "join", name: "汇聚", next: "boss" },
      approval("boss", [world.bossId], "end"),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const financeTask = firstOf(await tasksOf(instanceId, "finance"));
    const legalTask = firstOf(await tasksOf(instanceId, "legal"));
    await decide(legalTask.id, a!, "reject", "预算不足");

    expect((await prisma.flowTask.findUniqueOrThrow({ where: { id: financeTask.id } })).status).toBe(
      "cancelled",
    );
    expect(await runOf(instanceId, "merge")).toBeUndefined();
    expect(await tasksOf(instanceId, "boss")).toHaveLength(0);
    const instance = await prisma.flowInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(instance.status).toBe("rejected");
  });
});

describe("engine reject policies", () => {
  it("returns to the initiator and keeps the old instance for the trail", async () => {
    const contractId = await world.createContract();
    const [a] = world.approverIds;
    const def = definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!], "end"),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]);

    const first = await start(contractId, def);
    const task = firstOf(await tasksOf(first.instanceId, "legal"));
    await decide(task.id, a!, "reject", "金额与预算不符");

    const oldInstance = await prisma.flowInstance.findUniqueOrThrow({ where: { id: first.instanceId } });
    expect(oldInstance.status).toBe("rejected");
    expect(oldInstance.finishedAt).not.toBeNull();
    let contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe("rejected");

    const second = await start(contractId, def);
    contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe("approving");
    expect(contract.currentFlowInstanceId).toBe(second.instanceId);
    const instances = await prisma.flowInstance.findMany({ where: { contractId } });
    expect(instances).toHaveLength(2);
  });

  it("returns to a named node and re-runs it with a fresh attempt", async () => {
    const contractId = await world.createContract();
    const [a, b, c] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "dept" },
      approval("dept", [a!], "legal"),
      approval("legal", [b!], "gm", { reject: { policy: "to_node:dept" } }),
      approval("gm", [c!], "end", { reject: { policy: "terminate" } }),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    await decide(firstOf(await tasksOf(instanceId, "dept")).id, a!, "approve");
    const legalTask = firstOf(await tasksOf(instanceId, "legal"));
    await decide(legalTask.id, b!, "reject", "需要业务补充");

    const deptRuns = await prisma.flowNodeRun.findMany({
      where: { instanceId, nodeId: "dept" },
      orderBy: { attempt: "asc" },
    });
    expect(deptRuns).toHaveLength(2);
    expect(deptRuns[1]?.status).toBe("running");
    expect(deptRuns[1]?.attempt).toBe(2);

    const newTasks = await tasksOf(instanceId, "dept");
    expect(newTasks.filter((task) => task.nodeRunId === deptRuns[1]?.id)).toHaveLength(1);
    expect(newTasks.filter((task) => task.nodeRunId === deptRuns[0]?.id && task.status === "pending")).toHaveLength(0);

    const instance = await prisma.flowInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(instance.status).toBe("running");
  });

  it("terminates the instance when the policy is terminate", async () => {
    const contractId = await world.createContract();
    const [a, b] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "dept" },
      approval("dept", [a!], "legal"),
      approval("legal", [b!], "end", { reject: { policy: "terminate" } }),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    await decide(firstOf(await tasksOf(instanceId, "dept")).id, a!, "approve");
    await decide(firstOf(await tasksOf(instanceId, "legal")).id, b!, "reject", "不予通过");

    const instance = await prisma.flowInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(instance.status).toBe("terminated");
  });

  it("returns to the previous approver for a to_prev policy", async () => {
    const contractId = await world.createContract();
    const [a, b] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "dept" },
      approval("dept", [a!], "legal"),
      approval("legal", [b!], "end", { reject: { policy: "to_prev" } }),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    await decide(firstOf(await tasksOf(instanceId, "dept")).id, a!, "approve");
    await decide(firstOf(await tasksOf(instanceId, "legal")).id, b!, "reject", "信息不足");

    const deptRuns = await prisma.flowNodeRun.findMany({
      where: { instanceId, nodeId: "dept" },
      orderBy: { attempt: "asc" },
    });
    expect(deptRuns).toHaveLength(2);
    const rerunTasks = await tasksOf(instanceId, "dept");
    expect(rerunTasks.filter((task) => task.nodeRunId === deptRuns[1]?.id && task.status === "pending")).toHaveLength(1);
    const instance = await prisma.flowInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(instance.status).toBe("running");
  });

  it("marks the contract stage as returned on a return action", async () => {
    const contractId = await world.createContract();
    const [a] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!], "end", { requiredOpinionOn: ["return"] }),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const task = firstOf(await tasksOf(instanceId, "legal"));
    await expect(decide(task.id, a!, "return")).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await decide(task.id, a!, "return", "请补充交付计划");

    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe("rejected");
    expect(contract.stage).toBe("returned");
    const instance = await prisma.flowInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(instance.status).toBe("rejected");
  });
});

describe("engine add-sign and transfer", () => {
  it("before add-sign keeps the original task blocked until the add-sign finishes", async () => {
    const contractId = await world.createContract();
    const [a, b] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!], "end", {
        capabilities: { addSign: ["before", "after", "parallel"], transfer: true, return: true, delegate: true },
      }),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const original = firstOf(await tasksOf(instanceId, "legal"));
    await prisma.$transaction((tx) =>
      addSignToTask(tx, {
        taskId: original.id,
        actorId: a!,
        position: "before",
        assigneeIds: [b!],
        reason: "请先出法务意见",
      }),
    );

    const blocked = await prisma.flowTask.findUniqueOrThrow({ where: { id: original.id } });
    expect(blocked.activatedAt).toBeNull();
    expect(blocked.blockedByNodeRunId).not.toBeNull();
    await expect(decide(original.id, a!, "approve")).rejects.toMatchObject({ code: "CONFLICT" });

    const addSignTasks = await prisma.flowTask.findMany({
      where: { instanceId, originTaskId: original.id, addSignType: "before" },
    });
    expect(addSignTasks).toHaveLength(1);
    const addSignTask = firstOf(addSignTasks);
    expect(addSignTask.originTaskId).toBe(original.id);

    await decide(addSignTask.id, b!, "approve");

    const released = await prisma.flowTask.findUniqueOrThrow({ where: { id: original.id } });
    expect(released.blockedByNodeRunId).toBeNull();
    expect(released.activatedAt).not.toBeNull();
    await decide(released.id, a!, "approve");
    const instance = await prisma.flowInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(instance.status).toBe("approved");
  });

  it("parallel add-sign joins the same node judgement", async () => {
    const contractId = await world.createContract();
    const [a, b, c] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!, b!], "end", {
        mode: "all",
        capabilities: { addSign: ["parallel"], transfer: false, return: false, delegate: false },
      }),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const taskA = firstOf(await tasksOf(instanceId, "legal"));
    await prisma.$transaction((tx) =>
      addSignToTask(tx, {
        taskId: taskA.id,
        actorId: a!,
        position: "parallel",
        assigneeIds: [c!],
        reason: "财务并签",
      }),
    );

    const tasks = await tasksOf(instanceId, "legal");
    expect(tasks).toHaveLength(3);
    const added = tasks.find((task) => task.assigneeId === c);
    expect(added?.addSignType).toBe("parallel");
    expect(added?.originTaskId).toBe(taskA.id);

    await decide(taskA.id, a!, "approve");
    await decide(firstOf(tasks.filter((task) => task.assigneeId === b)).id, b!, "approve");
    expect((await prisma.flowInstance.findUniqueOrThrow({ where: { id: instanceId } })).status).toBe(
      "running",
    );
    await decide(added!.id, c!, "approve");
    expect((await prisma.flowInstance.findUniqueOrThrow({ where: { id: instanceId } })).status).toBe(
      "approved",
    );
  });

  it("after add-sign runs before the flow advances", async () => {
    const contractId = await world.createContract();
    const [a, b] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!], "boss", {
        capabilities: { addSign: ["after"], transfer: false, return: false, delegate: false },
      }),
      approval("boss", [world.bossId], "end"),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const taskA = firstOf(await tasksOf(instanceId, "legal"));
    await prisma.$transaction((tx) =>
      addSignToTask(tx, {
        taskId: taskA.id,
        actorId: a!,
        position: "after",
        assigneeIds: [b!],
        reason: "补一个复核",
      }),
    );
    await decide(taskA.id, a!, "approve");

    expect(await tasksOf(instanceId, "boss")).toHaveLength(0);
    const addSignTasks = await prisma.flowTask.findMany({
      where: { instanceId, addSignType: "after" },
    });
    expect(addSignTasks).toHaveLength(1);
    await decide(firstOf(addSignTasks).id, b!, "approve");
    expect(await tasksOf(instanceId, "boss")).toHaveLength(1);
  });

  it("transfer moves the task to the new assignee and their rejection rejects the node", async () => {
    const contractId = await world.createContract();
    const [a, b] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!], "end", {
        capabilities: { addSign: [], transfer: true, return: true, delegate: true },
      }),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const original = firstOf(await tasksOf(instanceId, "legal"));
    await prisma.$transaction((tx) =>
      transferTask(tx, {
        taskId: original.id,
        actorId: a!,
        targetUserId: b!,
        reason: "出差，转给同事",
      }),
    );

    expect((await prisma.flowTask.findUniqueOrThrow({ where: { id: original.id } })).status).toBe(
      "transferred",
    );
    const incoming = await tasksOf(instanceId, "legal");
    const target = incoming.find((task) => task.assigneeId === b);
    expect(target?.status).toBe("pending");
    expect(target?.activatedAt).not.toBeNull();
    expect(target?.originTaskId).toBe(original.id);

    await decide(target!.id, b!, "reject", "条款有风险");
    const instance = await prisma.flowInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(instance.status).toBe("rejected");
  });

  it("refuses transfer when the node does not allow it", async () => {
    const contractId = await world.createContract();
    const [a, b] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!], "end"),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const legalTask = firstOf(await tasksOf(instanceId, "legal"));
    await expect(
      prisma.$transaction((tx) =>
        transferTask(tx, {
          taskId: legalTask.id,
          actorId: a!,
          targetUserId: b!,
          reason: "转签",
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("engine withdraw, idempotency and snapshot", () => {
  it("withdraws only while nobody has acted", async () => {
    const contractId = await world.createContract();
    const [a, b] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!, b!], "end", { mode: "all" }),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const tasks = await tasksOf(instanceId, "legal");
    await expect(
      prisma.$transaction((tx) =>
        withdrawInstance(tx, { instanceId, actorId: world.leaderId }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await decide(tasks[0]!.id, a!, "approve");
    await expect(
      prisma.$transaction((tx) =>
        withdrawInstance(tx, { instanceId, actorId: world.initiatorId }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const other = await world.createContract();
    const started = await start(other, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!], "end"),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));
    const result = await prisma.$transaction((tx) =>
      withdrawInstance(tx, { instanceId: started.instanceId, actorId: world.initiatorId }),
    );
    expect(result.contractStatus).toBe("draft");
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: other } });
    expect(contract.status).toBe("draft");
    const pending = await prisma.flowTask.count({
      where: { instanceId: started.instanceId, status: "pending" },
    });
    expect(pending).toBe(0);
  });

  it("rejects decisions from non-assignees and repeats of the same task", async () => {
    const contractId = await world.createContract();
    const [a, b] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!], "end"),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const task = firstOf(await tasksOf(instanceId, "legal"));
    await expect(decide(task.id, b!, "approve")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await decide(task.id, a!, "approve");
    await expect(decide(task.id, a!, "approve")).rejects.toMatchObject({
      code: "TASK_ALREADY_DECIDED",
    });
  });

  it("lets exactly one of fifty concurrent decisions win", async () => {
    const contractId = await world.createContract();
    const [a] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!], "end", { mode: "any" }),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const task = firstOf(await tasksOf(instanceId, "legal"));
    const attempts = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        runWithFlowRetry(
          (fn) => prisma.$transaction(fn),
          (tx) => decideTask(tx, { taskId: task.id, actorId: a!, action: "approve" }),
        ),
      ),
    );

    const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
    const rejectedCodes = attempts
      .filter((attempt) => attempt.status === "rejected")
      .map((attempt) => (attempt as PromiseRejectedResult).reason as { code?: string });

    expect(fulfilled).toHaveLength(1);
    expect(rejectedCodes).toHaveLength(49);
    expect(rejectedCodes.every((error) => error.code === "TASK_ALREADY_DECIDED")).toBe(true);

    const approvedCount = await prisma.flowTask.count({
      where: { id: task.id, status: "approved" },
    });
    expect(approvedCount).toBe(1);
    const events = await prisma.flowEventLog.count({
      where: { taskId: task.id, action: "task.approve" },
    });
    expect(events).toBe(1);
  });

  it("keeps running on the frozen snapshot after a new version is published", async () => {
    const contractId = await world.createContract();
    const [a, b] = world.approverIds;
    const v1 = definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!], "boss"),
      approval("boss", [world.bossId], "end"),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]);
    const { instanceId, flowId } = await start(contractId, v1);

    const v2 = definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [b!], "end"),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]);
    await world.publishVersion(flowId, v2, 2);

    const snapshot = await prisma.flowInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(JSON.stringify(snapshot.definitionSnapshot)).toContain(world.bossId);
    expect(JSON.stringify(snapshot.definitionSnapshot)).not.toContain('"version":2');

    await decide(firstOf(await tasksOf(instanceId, "legal")).id, a!, "approve");
    const bossTasks = await tasksOf(instanceId, "boss");
    expect(bossTasks).toHaveLength(1);
    expect(firstOf(bossTasks).assigneeId).toBe(world.bossId);
  });
});

describe("engine action nodes", () => {
  it("runs notify, seal record and archive actions in order", async () => {
    const contractId = await world.createContract();
    const [a] = world.approverIds;

    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!], "seal"),
      {
        id: "seal",
        type: "action",
        name: "登记用印",
        kind: "create_seal_record",
        payload: { sealType: "contract", copies: 2 },
        next: "end",
      },
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    await decide(firstOf(await tasksOf(instanceId, "legal")).id, a!, "approve");

    const seal = await prisma.sealRecord.findFirst({ where: { contractId } });
    expect(seal).toMatchObject({ sealType: "contract", copies: 2, applicantId: world.initiatorId });
    const instance = await prisma.flowInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(instance.status).toBe("approved");
  });

  it("fails the whole decision transaction when a webhook target is not allowed", async () => {
    delete process.env.WEBHOOK_ALLOWED_HOSTS;
    const contractId = await world.createContract();
    const [a] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!], "hook"),
      {
        id: "hook",
        type: "action",
        name: "外部回调",
        kind: "webhook",
        payload: { target: "https://hooks.internal/contract" },
        next: "end",
      },
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const task = firstOf(await tasksOf(instanceId, "legal"));
    await expect(decide(task.id, a!, "approve")).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });

    const reloaded = await prisma.flowTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(reloaded.status).toBe("pending");
    const instance = await prisma.flowInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(instance.status).toBe("running");
  });
});

describe("engine timeouts", () => {
  it("reminds once per due window and stays idempotent across reruns", async () => {
    const contractId = await world.createContract();
    const [a] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!], "end", { timeout: { hours: 1, action: "remind" } }),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const storedDueAt = (await tasksOf(instanceId, "legal"))[0]?.dueAt;
    expect(storedDueAt).toBeInstanceOf(Date);
    expect(Math.abs(storedDueAt!.getTime() - Date.now())).toBeGreaterThan(59 * 60 * 1000);
    const dueAt = new Date(storedDueAt!.getTime());

    const now = new Date(dueAt.getTime() + 60 * 1000);
    const first = await prisma.$transaction((tx) => processDueTasks(tx, { now }));
    expect(first.handled).toBeGreaterThanOrEqual(1);
    const reminders = await prisma.notification.count({ where: { userId: a!, kind: "timeout" } });
    expect(reminders).toBe(1);

    const second = await prisma.$transaction((tx) => processDueTasks(tx, { now }));
    expect(second.handled).toBe(0);
    expect(second.skipped).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.notification.count({ where: { userId: a!, kind: "timeout" } }),
    ).toBe(1);
  });

  it("auto-approves a task whose timeout action is auto_approve", async () => {
    const contractId = await world.createContract();
    const [a] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!], "end", { timeout: { hours: 1, action: "auto_approve" } }),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    const result = await prisma.$transaction((tx) =>
      processDueTasks(tx, { now: new Date(Date.now() + 2 * 60 * 60 * 1000) }),
    );
    expect(result.handled).toBe(1);
    const instance = await prisma.flowInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(instance.status).toBe("approved");
    expect((await tasksOf(instanceId, "legal"))[0]?.action).toBe("auto_approve");
  });

  it("transfers to the initiator's manager when the timeout action says so", async () => {
    const contractId = await world.createContract();
    const [a] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!], "end", { timeout: { hours: 1, action: "transfer_to_manager" } }),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]), 100000, world.leaderId);

    await prisma.$transaction((tx) =>
      processDueTasks(tx, { now: new Date(Date.now() + 2 * 60 * 60 * 1000) }),
    );

    const tasks = await tasksOf(instanceId, "legal");
    const original = tasks.find((task) => task.assigneeId === a);
    const taken = tasks.find((task) => task.assigneeId === world.leaderId);
    expect(original?.status).toBe("transferred");
    expect(taken?.status).toBe("pending");
    expect(taken?.originTaskId).toBe(original?.id);
  });

  it("auto-rejects a task whose timeout action is auto_reject", async () => {
    const contractId = await world.createContract();
    const [a] = world.approverIds;
    const { instanceId } = await start(contractId, definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [a!], "end", { timeout: { hours: 1, action: "auto_reject" } }),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]));

    await prisma.$transaction((tx) =>
      processDueTasks(tx, { now: new Date(Date.now() + 2 * 60 * 60 * 1000) }),
    );
    const instance = await prisma.flowInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(instance.status).toBe("rejected");
  });
});
