import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { startFlowInstance } from "@/server/flow/engine";
import { deleteAsOwner } from "../helpers/db";
import { prepareFlowWorld, resetFlowData, type FlowWorld } from "../helpers/flow";

let world: FlowWorld;

const PROBE_ACTOR = "append-only-probe";

// 测试库里的 prisma 客户端用的就是应用角色 contract_app，
// 所以这里的报错来自数据库的 REVOKE，而不是应用层拦的。
async function expectDenied(promise: Promise<unknown>, table: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!error) {
    throw new Error(`${table} 的应用层写入没有被数据库拒绝，REVOKE 失效了`);
  }
  expect(String(error)).toContain("permission denied for table");
}

async function startInstance(): Promise<string> {
  const definition = {
    schemaVersion: 1,
    entry: "start",
    nodes: [
      { id: "start", type: "start", name: "发起", next: "legal" },
      {
        id: "legal",
        type: "approval",
        name: "法务审核",
        assignee: { kind: "user", ids: [world.approverIds[0] as string] },
        mode: "any",
        next: "end",
      },
      { id: "end", type: "end", name: "结束", result: "approved" },
    ],
  };
  const contractId = await world.createContract();
  const { flowId, flowVersionId } = await world.createFlow(definition);
  const result = await prisma.$transaction((tx) =>
    startFlowInstance(tx, {
      contractId,
      flowId,
      flowVersionId,
      definition: definition as never,
      initiatorId: world.initiatorId,
      context: {
        contract: { id: contractId, no: "HT-AUDIT", amount: 100000, category: "采购", days: 30 },
        form: {},
        initiator: { id: world.initiatorId, departmentId: "", managerUserId: "" },
      },
    }),
  );
  return result.instanceId;
}

beforeAll(async () => {
  await deleteAsOwner('DELETE FROM "AuditLog" WHERE "actorId" = $1', [PROBE_ACTOR]);
  world = await prepareFlowWorld(["audit"]);
});

beforeEach(async () => {
  await resetFlowData();
});

describe("append-only audit tables", () => {
  it("accepts inserts from the app role but the database refuses updates and deletes", async () => {
    const row = await prisma.auditLog.create({
      data: {
        actorId: PROBE_ACTOR,
        action: "probe.insert",
        entity: "Probe",
        entityId: "audit-append-probe",
        after: { ok: true },
      },
      select: { id: true, action: true },
    });
    expect(row.action).toBe("probe.insert");

    await expectDenied(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: "tampered" } }),
      "AuditLog",
    );
    await expectDenied(prisma.auditLog.delete({ where: { id: row.id } }), "AuditLog");
    await expectDenied(
      prisma.auditLog.updateMany({ where: { id: row.id }, data: { action: "tampered" } }),
      "AuditLog",
    );
    await expectDenied(
      prisma.$executeRaw`UPDATE "AuditLog" SET "action" = 'tampered' WHERE "id" = ${row.id}`,
      "AuditLog",
    );

    // 失败语句没有污染连接：同一客户端随后仍能读
    const stillThere = await prisma.auditLog.findUniqueOrThrow({
      where: { id: row.id },
      select: { action: true },
    });
    expect(stillThere.action).toBe("probe.insert");

    await deleteAsOwner('DELETE FROM "AuditLog" WHERE "id" = $1', [row.id]);
  });

  it("protects FlowEventLog the same way", async () => {
    const instanceId = await startInstance();
    const event = await prisma.flowEventLog.findFirstOrThrow({
      where: { instanceId },
      select: { id: true, action: true },
    });

    await expectDenied(
      prisma.flowEventLog.update({ where: { id: event.id }, data: { action: "tampered" } }),
      "FlowEventLog",
    );
    await expectDenied(prisma.flowEventLog.delete({ where: { id: event.id } }), "FlowEventLog");

    const untouched = await prisma.flowEventLog.count({ where: { instanceId } });
    expect(untouched).toBeGreaterThan(0);

    await deleteAsOwner('DELETE FROM "FlowEventLog" WHERE "id" = $1', [event.id]);
  });

  it("keeps the owner role able to clean up for migrations and test resets", async () => {
    const row = await prisma.auditLog.create({
      data: {
        actorId: PROBE_ACTOR,
        action: "probe.insert",
        entity: "Probe",
        entityId: "owner-cleanup-probe",
      },
      select: { id: true },
    });

    await deleteAsOwner('DELETE FROM "AuditLog" WHERE "id" = $1', [row.id]);
    expect(await prisma.auditLog.count({ where: { actorId: PROBE_ACTOR } })).toBe(0);
  });
});
