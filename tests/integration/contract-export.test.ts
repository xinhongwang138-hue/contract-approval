import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAccessContext } from "@/server/auth/access";
import { prisma } from "@/server/db/client";
import { getContractLedger } from "@/server/services/contract-export";
import { ERROR_CODES } from "@/shared/errors";
import { prepareFlowWorld, resetFlowData, type FlowWorld } from "../helpers/flow";

let world: FlowWorld;

async function createReaderWithoutExport(): Promise<string> {
  const slug = world.suffix.toLowerCase();
  const role = await prisma.role.create({
    data: {
      key: `reader_${slug}`,
      name: "只读无导出",
      isSystem: false,
      dataScope: { create: { scope: "all" } },
      rolePermissions: {
        create: [{ permission: { connect: { key: "contract.read" } } }],
      },
    },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: {
      name: "只读用户",
      email: `reader-${slug}@test.local`,
      emailVerified: true,
      status: "active",
    },
    select: { id: true },
  });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user.id;
}

beforeAll(async () => {
  world = await prepareFlowWorld(["exp"]);
});

beforeEach(async () => {
  await resetFlowData();
});

describe("contract ledger export", () => {
  it("exports the same rows the list would show for that viewer", async () => {
    await world.createContract({ amount: "1000.00" });
    const theirs = await world.createContract({ amount: "2000.00" });
    await prisma.contract.update({
      where: { id: theirs },
      data: { createdBy: world.bossId, ownerDepartmentId: null },
    });

    const boss = await getAccessContext(world.bossId);
    const all = await getContractLedger(
      boss,
      { sort: "updatedAt", order: "desc" },
      1000,
    );
    expect(all.columns).toHaveLength(14);
    expect(all.rows).toHaveLength(2);
    expect(all.rows.map((row) => row[2])).toEqual(["草稿", "草稿"]);
    expect(all.rows.map((row) => row[3]).sort()).toEqual([1000, 2000]);

    const employee = await getAccessContext(world.initiatorId);
    const own = await getContractLedger(employee, { sort: "updatedAt", order: "desc" }, 1000);
    expect(own.rows).toHaveLength(1);
    expect(own.rows[0]?.[0]).toContain("HT-");

    expect(own.rows[0]?.[1]).toContain("FLOW合同");
  });

  it("honours the status filter", async () => {
    await world.createContract({ status: "draft" });
    await world.createContract({ status: "rejected" });

    const boss = await getAccessContext(world.bossId);
    const rejected = await getContractLedger(
      boss,
      { status: "rejected", sort: "updatedAt", order: "desc" },
      1000,
    );
    expect(rejected.rows).toHaveLength(1);
    expect(rejected.rows[0]?.[2]).toBe("已驳回");
  });

  it("refuses viewers without contract.export", async () => {
    const readerId = await createReaderWithoutExport();
    const reader = await getAccessContext(readerId);
    await expect(
      getContractLedger(reader, { sort: "updatedAt", order: "desc" }, 1000),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
  });

  it("refuses to silently truncate at the row cap", async () => {
    await world.createContract();
    await world.createContract();

    const boss = await getAccessContext(world.bossId);
    await expect(
      getContractLedger(boss, { sort: "updatedAt", order: "desc" }, 1),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });
});
