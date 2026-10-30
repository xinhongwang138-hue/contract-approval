import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAccessContext } from "@/server/auth/access";
import { prisma } from "@/server/db/client";
import { startFlowInstance } from "@/server/flow/engine";
import { listAuditLogs, listFlowEvents } from "@/server/services/audit-log";
import { getEfficiencyReport } from "@/server/services/report";
import { ERROR_CODES } from "@/shared/errors";
import { prepareFlowWorld, resetFlowData, type FlowWorld } from "../helpers/flow";

let world: FlowWorld;

const T0 = new Date("2026-10-10T00:00:00.000Z");

function definition(): Record<string, unknown> {
  const [approver] = world.approverIds;
  return {
    schemaVersion: 1,
    entry: "start",
    nodes: [
      { id: "start", type: "start", name: "发起", next: "legal" },
      {
        id: "legal",
        type: "approval",
        name: "法务复核",
        assignee: { kind: "user", ids: [approver] },
        mode: "any",
        next: "end",
      },
      { id: "end", type: "end", name: "结束", result: "approved" },
    ],
  };
}

async function createFlow(): Promise<{ flowId: string; flowVersionId: string; def: Record<string, unknown> }> {
  const def = definition();
  const { flowId, flowVersionId } = await world.createFlow(def);
  return { flowId, flowVersionId, def };
}

async function startInstance(
  contractId: string,
  flow: Awaited<ReturnType<typeof createFlow>>,
): Promise<string> {
  const result = await prisma.$transaction((tx) =>
    startFlowInstance(tx, {
      contractId,
      flowId: flow.flowId,
      flowVersionId: flow.flowVersionId,
      definition: flow.def as never,
      initiatorId: world.initiatorId,
      context: {
        contract: { id: contractId, no: "HT-RPT", amount: 100000, category: "purchase", days: 10 },
        form: {},
        initiator: { departmentId: "", managerUserId: "" },
      },
      options: { now: T0 },
    }),
  );
  return result.instanceId;
}

async function stampTask(
  instanceId: string,
  input: { hours: number; overdue: boolean; status: "approved" | "rejected" },
): Promise<void> {
  const task = await prisma.flowTask.findFirstOrThrow({
    where: { instanceId, status: "pending" },
    select: { id: true },
  });
  const decidedAt = new Date(T0.getTime() + input.hours * 3_600_000);
  await prisma.flowTask.update({
    where: { id: task.id },
    data: {
      status: input.status,
      activatedAt: T0,
      decidedAt,
      dueAt: new Date(T0.getTime() + (input.overdue ? 1 : 100) * 3_600_000),
      decidedBy: world.approverIds[0] as string,
    },
  });
}

async function createScopedAuditor(): Promise<string> {
  const slug = world.suffix.toLowerCase();
  const role = await prisma.role.create({
    data: {
      key: `auditor_${slug}`,
      name: "受限审计员",
      isSystem: false,
      dataScope: { create: { scope: "self" } },
      rolePermissions: {
        create: [
          { permission: { connect: { key: "audit.read" } } },
          { permission: { connect: { key: "contract.read" } } },
        ],
      },
    },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: {
      name: "受限审计员",
      email: `auditor-${slug}@test.local`,
      emailVerified: true,
      status: "active",
    },
    select: { id: true },
  });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user.id;
}

beforeAll(async () => {
  world = await prepareFlowWorld(["rpt"]);
});

beforeEach(async () => {
  await resetFlowData();
});

afterAll(async () => {
  await resetFlowData();
});

describe("efficiency report", () => {
  it("aggregates duration, overdue and reject rates per node", async () => {
    const flow = await createFlow();
    const first = await startInstance(await world.createContract(), flow);
    await stampTask(first, { hours: 2, overdue: false, status: "approved" });

    const second = await startInstance(await world.createContract(), flow);
    await stampTask(second, { hours: 6, overdue: true, status: "rejected" });

    const access = await getAccessContext(world.bossId);
    const report = await getEfficiencyReport(access, {
      windowDays: 7,
      now: new Date(T0.getTime() + 7 * 86_400_000),
    });

    expect(report.sampleSize).toBe(2);
    expect(report.truncated).toBe(false);
    expect(report.totals.decidedCount).toBe(2);
    expect(report.totals.rejectedCount).toBe(1);
    expect(report.totals.overdueCount).toBe(1);
    expect(report.totals.avgHours).toBeCloseTo(4, 6);
    expect(report.totals.rejectRate).toBeCloseTo(0.5, 6);

    const node = report.nodes.find((item) => item.nodeName === "法务复核");
    expect(node?.taskCount).toBe(2);
    expect(node?.medianHours).toBeCloseTo(4, 6);
    expect(node?.slowestHours).toBeCloseTo(6, 6);
    expect(node?.pendingCount).toBe(0);
    expect(node?.overdueRate).toBeCloseTo(0.5, 6);
  });

  it("keeps the sample inside the viewer's data scope", async () => {
    const flow = await createFlow();
    await stampTask(await startInstance(await world.createContract(), flow), {
      hours: 3,
      overdue: false,
      status: "approved",
    });

    const outside = await world.createContract();
    await stampTask(await startInstance(outside, flow), {
      hours: 5,
      overdue: false,
      status: "approved",
    });
    // 把第二份合同挪出主管的部门子树
    await prisma.contract.update({
      where: { id: outside },
      data: { ownerDepartmentId: null },
    });

    const boss = await getAccessContext(world.bossId);
    const all = await getEfficiencyReport(boss, {
      windowDays: 7,
      now: new Date(T0.getTime() + 7 * 86_400_000),
    });
    expect(all.sampleSize).toBe(2);

    const leader = await getAccessContext(world.leaderId);
    const scoped = await getEfficiencyReport(leader, {
      windowDays: 7,
      now: new Date(T0.getTime() + 7 * 86_400_000),
    });
    expect(scoped.sampleSize).toBe(1);
  });

  it("refuses the report without report.read", async () => {
    const employee = await getAccessContext(world.initiatorId);
    await expect(getEfficiencyReport(employee, { windowDays: 7 })).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
  });
});

describe("audit queries", () => {
  it("filters audit rows by entity, action and actor", async () => {
    const contractId = await world.createContract();
    const access = await getAccessContext(world.bossId);
    await prisma.auditLog.create({
      data: {
        actorId: world.initiatorId,
        action: "contract.create",
        entity: "Contract",
        entityId: contractId,
        after: { status: "draft" },
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: world.bossId,
        action: "role.update",
        entity: "Role",
        entityId: "role-1",
      },
    });

    const contracts = await listAuditLogs(access, { page: 1, pageSize: 20, entity: "Contract" });
    expect(contracts.total).toBeGreaterThanOrEqual(1);
    expect(contracts.rows.every((row) => row.entity === "Contract")).toBe(true);
    expect(contracts.rows[0]?.actorName).toBe("FLOW发起人");

    // 其它套件也会往 AuditLog 写 role.*，所以同时按本套件独有的操作人收窄
    const byAction = await listAuditLogs(access, {
      page: 1,
      pageSize: 20,
      action: "role.update",
      actorId: world.bossId,
    });
    expect(byAction.rows).toHaveLength(1);
    expect(byAction.rows[0]?.entity).toBe("Role");

    const byContract = await listAuditLogs(access, {
      page: 1,
      pageSize: 20,
      entity: "Contract",
      q: contractId,
    });
    expect(byContract.rows).toHaveLength(1);
    expect(byContract.rows[0]?.action).toBe("contract.create");

    const byActor = await listAuditLogs(access, {
      page: 1,
      pageSize: 20,
      actorId: world.bossId,
    });
    expect(byActor.rows.every((row) => row.actorId === world.bossId)).toBe(true);
  });

  it("applies the contract scope to flow events", async () => {
    const contractId = await world.createContract();
    const instanceId = await startInstance(contractId, await createFlow());

    const boss = await getAccessContext(world.bossId);
    const bossView = await listFlowEvents(boss, { page: 1, pageSize: 20 });
    expect(bossView.total).toBeGreaterThanOrEqual(1);
    expect(bossView.rows.some((row) => row.instanceId === instanceId)).toBe(true);

    // 有 audit.read 但数据范围是 self 的自定义角色，看不到别人的流程事件
    const auditorId = await createScopedAuditor();
    const auditor = await getAccessContext(auditorId);
    const auditorView = await listFlowEvents(auditor, { page: 1, pageSize: 20 });
    expect(auditorView.total).toBe(0);
    expect(auditorView.rows).toHaveLength(0);
  });

  it("refuses audit reads without audit.read", async () => {
    const employee = await getAccessContext(world.initiatorId);
    await expect(listAuditLogs(employee, { page: 1, pageSize: 20 })).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
    await expect(listFlowEvents(employee, { page: 1, pageSize: 20 })).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
  });
});
