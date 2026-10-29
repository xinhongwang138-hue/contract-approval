import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { allocateContractNo } from "@/server/services/contract-number";
import { prepareDatabase } from "../helpers/fixtures";

function sequenceOf(no: string): number {
  const last = no.split("-").at(-1);
  if (!last) {
    throw new Error(`unexpected contract no: ${no}`);
  }
  return Number(last);
}

describe("allocateContractNo", () => {
  beforeAll(async () => {
    await prepareDatabase();
    await prisma.contractNoSequence.deleteMany({
      where: { templateCode: "CONC" },
    });
  });

  it("allocates 100 unique numbers without gaps under concurrency", async () => {
    const at = new Date("2026-10-15T04:00:00.000Z");
    const numbers = await Promise.all(
      Array.from({ length: 100 }, () =>
        prisma.$transaction((tx) => allocateContractNo(tx, "CONC", at)),
      ),
    );

    expect(new Set(numbers).size).toBe(100);
    expect(numbers.every((no) => /^HT-CONC-202610-\d{4}$/.test(no))).toBe(true);

    const sequences = numbers.map(sequenceOf).sort((left, right) => left - right);
    expect(sequences).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 1),
    );
  }, 120_000);

  it("rolls over the sequence per Asia/Shanghai month", async () => {
    const beforeMonthEnd = new Date("2026-10-31T15:59:00.000Z");
    const afterMonthStart = new Date("2026-10-31T16:00:00.000Z");

    const october = await prisma.$transaction((tx) =>
      allocateContractNo(tx, "CONC", beforeMonthEnd),
    );
    const november = await prisma.$transaction((tx) =>
      allocateContractNo(tx, "CONC", afterMonthStart),
    );

    expect(october.startsWith("HT-CONC-202610-")).toBe(true);
    expect(november).toBe("HT-CONC-202611-0001");
  });
});
