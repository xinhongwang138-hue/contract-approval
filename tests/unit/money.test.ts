import { describe, expect, it } from "vitest";
import { Decimal, formatMoney, toDecimal } from "@/shared/money";

describe("金额处理", () => {
  it("使用 Decimal 保留两位精度，不经过浮点", () => {
    const amount = toDecimal("1234567.891");
    expect(amount.toFixed(2)).toBe("1234567.89");
    expect(amount).toBeInstanceOf(Decimal);
  });

  it("拒绝非法金额", () => {
    expect(() => toDecimal("12a")).toThrow();
  });

  it("金额展示带千分位", () => {
    expect(formatMoney(toDecimal("1234567.5"))).toBe("¥1,234,567.50");
    expect(formatMoney(toDecimal("0"))).toBe("¥0.00");
    expect(formatMoney(toDecimal("-880.5"))).toBe("-¥880.50");
    expect(formatMoney(toDecimal("1000"), "USD")).toBe("$1,000.00");
  });
});
