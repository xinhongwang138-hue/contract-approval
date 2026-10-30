import { describe, expect, it } from "vitest";
import { expiryTone } from "@/shared/lifecycle";

const today = new Date("2026-10-30T00:00:00.000Z");

function endDate(daysFromToday: number): Date {
  return new Date(today.getTime() + daysFromToday * 86_400_000);
}

describe("expiryTone", () => {
  it("只给履行期内的合同上色", () => {
    for (const status of ["draft", "approving", "to_seal", "rejected", "archived"] as const) {
      expect(expiryTone(status, endDate(1), today, [30, 7])).toBeNull();
    }
  });

  it("分成已过期、临近与即将三档", () => {
    expect(expiryTone("active", endDate(-1), today, [30, 7])).toBe("expired");
    expect(expiryTone("active", endDate(0), today, [30, 7])).toBe("urgent");
    expect(expiryTone("active", endDate(7), today, [30, 7])).toBe("urgent");
    expect(expiryTone("active", endDate(8), today, [30, 7])).toBe("soon");
    expect(expiryTone("amended", endDate(30), today, [30, 7])).toBe("soon");
    expect(expiryTone("active", endDate(31), today, [30, 7])).toBeNull();
  });

  it("阈值顺序无关，空阈值不上色", () => {
    expect(expiryTone("active", endDate(20), today, [7, 30])).toBe("soon");
    expect(expiryTone("active", endDate(3), today, [7, 30])).toBe("urgent");
    expect(expiryTone("active", endDate(1), today, [])).toBeNull();
    expect(expiryTone("active", endDate(1), today, [0, -5])).toBeNull();
  });
});
