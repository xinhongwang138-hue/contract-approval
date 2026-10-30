import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAccessContext } from "@/server/auth/access";
import { prisma } from "@/server/db/client";
import { requireEditableContract } from "@/server/services/contract";
import {
  archiveContract,
  getContractLifecycle,
  listArchive,
  listSealRecords,
  parseWarningDays,
  pickSealRecord,
  processContractExpiry,
  returnSealRecord,
} from "@/server/services/lifecycle";
import { prepareFlowWorld, resetFlowData, type FlowWorld } from "../helpers/flow";

let world: FlowWorld;

async function seedSeal(status: "to_seal" | "sealed" | "active" | "expired" | "draft") {
  const contractId = await world.createContract();
  await prisma.contract.update({ where: { id: contractId }, data: { status } });
  const seal =
    status !== "draft"
      ? await prisma.sealRecord.create({
          data: {
            contractId,
            sealType: status === "to_seal" ? "contract" : "company",
            copies: 2,
            applicantId: world.initiatorId,
            appliedAt: new Date("2026-10-20T02:00:00.000Z"),
            ...(status === "to_seal"
              ? {}
              : { pickedAt: new Date("2026-10-21T02:00:00.000Z") }),
          },
          select: { id: true },
        })
      : null;
  return { contractId, sealId: seal?.id ?? null };
}

beforeAll(async () => {
  world = await prepareFlowWorld(["l1"]);
});

beforeEach(async () => {
  await resetFlowData();
});

describe("seal lifecycle", () => {
  it("moves to_seal → sealed on pick and sealed → active on return", async () => {
    const access = await getAccessContext(world.bossId);
    const { contractId, sealId } = await seedSeal("to_seal");

    const picked = await pickSealRecord(access, sealId!, new Date("2026-10-22T02:00:00.000Z"));
    expect(picked.contractStatus).toBe("sealed");

    const afterPick = await prisma.contract.findUniqueOrThrow({
      where: { id: contractId },
      select: { status: true },
    });
    expect(afterPick.status).toBe("sealed");
    expect(
      await prisma.contractMilestone.count({ where: { contractId, kind: "sealed" } }),
    ).toBe(1);
    expect(await prisma.notification.count({ where: { userId: world.initiatorId } })).toBe(1);

    const returned = await returnSealRecord(
      access,
      { id: sealId!, notaryNo: "YZ-2026-0001" },
      new Date("2026-10-25T02:00:00.000Z"),
    );
    expect(returned.contractStatus).toBe("active");

    const lifecycle = await getContractLifecycle(contractId);
    expect(lifecycle.sealRecords[0]?.notaryNo).toBe("YZ-2026-0001");
    expect(lifecycle.sealRecords[0]?.state).toBe("returned");
    expect(lifecycle.milestones.map((milestone) => milestone.kind)).toEqual([
      "sealed",
      "effective",
    ]);
  });

  it("rejects a second pick of the same seal record", async () => {
    const access = await getAccessContext(world.bossId);
    const { sealId } = await seedSeal("to_seal");

    await pickSealRecord(access, sealId!);
    await expect(pickSealRecord(access, sealId!)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("lets exactly one of two concurrent picks succeed", async () => {
    const access = await getAccessContext(world.bossId);
    const { contractId, sealId } = await seedSeal("to_seal");

    const results = await Promise.allSettled([
      pickSealRecord(access, sealId!),
      pickSealRecord(access, sealId!),
    ]);
    const ok = results.filter((result) => result.status === "fulfilled").length;
    expect(ok).toBe(1);

    expect(
      await prisma.contractMilestone.count({ where: { contractId, kind: "sealed" } }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { entityId: sealId!, action: "seal.pick" } }),
    ).toBe(1);
  });

  it("requires a pick before a return", async () => {
    const access = await getAccessContext(world.bossId);
    const { sealId } = await seedSeal("to_seal");

    await expect(returnSealRecord(access, { id: sealId! })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "请先登记取件",
    });
  });

  it("refuses to pick a seal without contract.seal permission", async () => {
    const { sealId } = await seedSeal("to_seal");
    const employee = await getAccessContext(world.initiatorId);

    await expect(pickSealRecord(employee, sealId!)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("keeps seal records outside the viewer's data scope out of the list", async () => {
    const boss = await getAccessContext(world.bossId);
    const mine = await seedSeal("to_seal");
    const theirs = await seedSeal("to_seal");
    await prisma.contract.update({
      where: { id: theirs.contractId },
      data: { createdBy: world.leaderId },
    });

    const employee = await getAccessContext(world.initiatorId);
    const own = await listSealRecords(employee, { page: 1, pageSize: 20, state: null, q: "" });
    expect(own.rows.map((row) => row.contractId)).toEqual([mine.contractId]);

    const all = await listSealRecords(boss, { page: 1, pageSize: 20, state: null, q: "" });
    expect(all.total).toBe(2);
  });

  it("lists seal records by state with scope applied", async () => {
    const access = await getAccessContext(world.bossId);
    await seedSeal("to_seal");
    await seedSeal("sealed");

    const all = await listSealRecords(access, { page: 1, pageSize: 20, state: null, q: "" });
    expect(all.total).toBe(2);
    expect(all.counts.pending_pick).toBe(1);
    expect(all.counts.pending_return).toBe(1);

    const pendingReturn = await listSealRecords(access, {
      page: 1,
      pageSize: 20,
      state: "pending_return",
      q: "",
    });
    expect(pendingReturn.rows).toHaveLength(1);
    expect(pendingReturn.rows[0]?.contractStatus).toBe("sealed");
  });
});

describe("archive", () => {
  it("archives an active contract and closes it for editing", async () => {
    const access = await getAccessContext(world.bossId);
    const { contractId } = await seedSeal("active");

    await archiveContract(access, contractId, "履行完毕，纸质件移交档案室");

    const contract = await prisma.contract.findUniqueOrThrow({
      where: { id: contractId },
      select: { status: true },
    });
    expect(contract.status).toBe("archived");
    expect(
      await prisma.contractMilestone.count({ where: { contractId, kind: "archived" } }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { entityId: contractId, action: "contract.archive" } }),
    ).toBe(1);

    // 归档后只读：编辑、补附件、再提交都走同一个守卫
    await expect(requireEditableContract(access, contractId)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(archiveContract(access, contractId)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "合同已归档",
    });
  });

  it("refuses to archive a contract that has not reached the post-performance states", async () => {
    const access = await getAccessContext(world.bossId);
    const { contractId } = await seedSeal("draft");

    await expect(archiveContract(access, contractId)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(
      await prisma.contractMilestone.count({ where: { contractId, kind: "archived" } }),
    ).toBe(0);
  });

  it("splits pending and archived counts for the archive page", async () => {
    const access = await getAccessContext(world.bossId);
    const pending = await seedSeal("active");
    const done = await seedSeal("expired");
    await archiveContract(access, done.contractId);

    const pendingList = await listArchive(access, {
      page: 1,
      pageSize: 20,
      tab: "pending",
      q: "",
    });
    expect(pendingList.pendingTotal).toBe(1);
    expect(pendingList.archivedTotal).toBe(1);
    expect(pendingList.rows.map((row) => row.id)).toEqual([pending.contractId]);

    const archivedList = await listArchive(access, {
      page: 1,
      pageSize: 20,
      tab: "archived",
      q: "",
    });
    expect(archivedList.rows).toHaveLength(1);
    expect(archivedList.rows[0]?.archivedAt).not.toBeNull();
  });
});

describe("expiry worker", () => {
  const NOW = new Date("2026-10-30T02:00:00.000Z");

  async function seedActive(endDate: Date): Promise<string> {
    const { contractId } = await seedSeal("active");
    await prisma.contract.update({ where: { id: contractId }, data: { endDate } });
    return contractId;
  }

  function sweep(input: { now: Date; warningDays?: string }) {
    return prisma.$transaction((tx) =>
      processContractExpiry(tx, { ...input, limit: 50 }),
    );
  }

  it("parses the threshold list defensively", () => {
    expect(parseWarningDays("30,7")).toEqual([30, 7]);
    expect(parseWarningDays("7, 7, 0, -3, abc, 400")).toEqual([7]);
    expect(parseWarningDays(undefined)).toEqual([30, 7]);
  });

  it("warns once per threshold and repeats nothing on the next sweep", async () => {
    const contractId = await seedActive(new Date("2026-11-28T02:00:00.000Z"));

    const first = await sweep({ now: NOW, warningDays: "30,7" });
    expect(first.warned).toBe(1);
    expect(first.expired).toBe(0);

    const again = await sweep({ now: NOW, warningDays: "30,7" });
    expect(again.warned).toBe(0);

    // 进入 7 天窗口后，同一合同还能拿到第二条不同阈值的提醒
    const later = await sweep({ now: new Date("2026-11-22T02:00:00.000Z"), warningDays: "30,7" });
    expect(later.warned).toBe(1);

    expect(
      await prisma.contractMilestone.count({ where: { contractId, kind: "expiry_warning" } }),
    ).toBe(2);
    // 两次预警 × （发起人 + 部门主管）各一条
    expect(
      await prisma.notification.count({ where: { userId: world.initiatorId, kind: "expiry" } }),
    ).toBe(2);
    expect(
      await prisma.notification.count({ where: { userId: world.leaderId, kind: "expiry" } }),
    ).toBe(2);
  });

  it("flips past-due contracts to expired exactly once", async () => {
    const contractId = await seedActive(new Date("2026-10-01T02:00:00.000Z"));

    const first = await sweep({ now: NOW, warningDays: "30,7" });
    expect(first.expired).toBe(1);
    const after = await prisma.contract.findUniqueOrThrow({
      where: { id: contractId },
      select: { status: true },
    });
    expect(after.status).toBe("expired");

    const again = await sweep({ now: NOW, warningDays: "30,7" });
    expect(again.expired).toBe(0);
    expect(again.scanned).toBe(0);

    expect(
      await prisma.contractMilestone.count({ where: { contractId, kind: "expired" } }),
    ).toBe(1);

    // 到期后即可归档，形成 active → expired → archived 闭环
    const boss = await getAccessContext(world.bossId);
    await archiveContract(boss, contractId, "到期归档");
    const final = await prisma.contract.findUniqueOrThrow({
      where: { id: contractId },
      select: { status: true },
    });
    expect(final.status).toBe("archived");
  });

  it("keeps sweeping when an already-seen key appears in the same transaction", async () => {
    // 旧实现用 try/catch P2002 判重：在交互事务里唯一键冲突会把整轮事务标记为 aborted，
    // 同批其它合同的预警要么直接报错，要么在提交时被静默回滚。
    const preWarned = await seedActive(new Date("2026-11-27T02:00:00.000Z"));
    const fresh = await seedActive(new Date("2026-11-28T02:00:00.000Z"));
    await sweep({ now: new Date("2026-10-29T03:00:00.000Z"), warningDays: "29" });

    const result = await sweep({ now: NOW, warningDays: "29" });
    expect(result.warned).toBe(1);
    expect(
      await prisma.contractMilestone.count({ where: { contractId: preWarned, kind: "expiry_warning" } }),
    ).toBe(1);
    expect(
      await prisma.contractMilestone.count({ where: { contractId: fresh, kind: "expiry_warning" } }),
    ).toBe(1);
    // 两轮各一条给发起人，说明第二轮的预警确实提交成功而非被回滚
    expect(
      await prisma.notification.count({ where: { userId: world.initiatorId, kind: "expiry" } }),
    ).toBe(2);
  });

  it("leaves contracts outside both windows untouched", async () => {
    await seedActive(new Date("2027-06-01T02:00:00.000Z"));

    const result = await sweep({ now: NOW, warningDays: "30,7" });
    expect(result).toEqual({ scanned: 0, warned: 0, expired: 0 });
  });
});

