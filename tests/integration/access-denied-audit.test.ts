import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { requireContractAccess, requirePermission } from "@/server/auth/access";
import { prisma } from "@/server/db/client";
import { prepareFlowWorld, resetFlowData, type FlowWorld } from "../helpers/flow";

let world: FlowWorld;

async function createOutsider(label: string): Promise<string> {
  const employee = await prisma.role.findUniqueOrThrow({ where: { key: "employee" } });
  const user = await prisma.user.create({
    data: {
      name: `DENIED-${label}`,
      email: `denied-${label.toLowerCase()}@test.local`,
      emailVerified: true,
      status: "active",
    },
    select: { id: true },
  });
  await prisma.userRole.create({ data: { userId: user.id, roleId: employee.id } });
  return user.id;
}

async function deniedRows(actorId: string) {
  return prisma.auditLog.findMany({
    where: { actorId, action: "access.denied" },
    orderBy: { createdAt: "asc" },
    select: { entity: true, entityId: true, after: true },
  });
}

beforeAll(async () => {
  world = await prepareFlowWorld(["d1"]);
});

beforeEach(async () => {
  await resetFlowData();
});

describe("authorization denial audit", () => {
  it("records access.denied when a permission is missing", async () => {
    const userId = await createOutsider(`NOPERM${world.suffix}`);

    await expect(requirePermission(userId, "system.user.manage")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const rows = await deniedRows(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entity: "Permission",
      entityId: "system.user.manage",
    });
  });

  it("records access.denied when the contract is outside the data scope", async () => {
    const userId = await createOutsider(`SCOPE${world.suffix}`);
    const contractId = await world.createContract();

    await expect(
      requireContractAccess(userId, contractId, "read"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const rows = await deniedRows(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: "Contract", entityId: contractId });
    expect(rows[0]?.after).toMatchObject({ action: "read" });
  });

  it("lets the owner through without writing a denial", async () => {
    const contractId = await world.createContract();

    await expect(
      requireContractAccess(world.initiatorId, contractId, "read"),
    ).resolves.toMatchObject({ contract: { id: contractId } });

    expect(await deniedRows(world.initiatorId)).toEqual([]);
  });

  it("does not audit unauthenticated attempts", async () => {
    const disabled = await prisma.user.create({
      data: {
        name: `DENIED-DISABLED${world.suffix}`,
        email: `denied-disabled-${world.suffix.toLowerCase()}@test.local`,
        emailVerified: true,
        status: "disabled",
      },
      select: { id: true },
    });

    await expect(
      requirePermission(disabled.id, "contract.read"),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    // 未登录探测不该往这张不可删改的表里写东西
    expect(await deniedRows(disabled.id)).toEqual([]);
  });
});
