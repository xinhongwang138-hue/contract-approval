import { describe, expect, it } from "vitest";
import {
  addDays,
  formatDate,
  formatDateTime,
  shanghaiYearMonth,
} from "@/shared/datetime";

describe("时间处理", () => {
  it("按 Asia/Shanghai 展示 UTC 存储时间", () => {
    const utc = new Date("2026-01-31T16:30:00.000Z");
    expect(formatDateTime(utc)).toBe("2026-02-01 00:30");
    expect(formatDate(utc)).toBe("2026-02-01");
  });

  it("跨年时年月按月边界计算", () => {
    const utc = new Date("2025-12-31T16:00:00.000Z");
    expect(shanghaiYearMonth(utc)).toBe("202601");
  });

  it("addDays 不受夏令时影响（UTC 运算）", () => {
    const start = new Date("2026-03-08T00:00:00.000Z");
    expect(addDays(start, 1).toISOString()).toBe("2026-03-09T00:00:00.000Z");
  });
});
