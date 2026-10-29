export const APP_TIME_ZONE = "Asia/Shanghai";

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatDateTime(value: Date | string): string {
  return dateTimeFormatter.format(toDate(value)).replace(/\//g, "-");
}

export function formatDate(value: Date | string): string {
  return dateFormatter.format(toDate(value)).replace(/\//g, "-");
}

export function shanghaiYearMonth(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) {
    throw new Error("无法计算上海时区的年月");
  }
  return `${year}${month}`;
}

const dateInputFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// 给 <input type="date"> 用的上海时区 yyyy-MM-dd。
export function toDateInputValue(value: Date): string {
  return dateInputFormatter.format(value);
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

// Asia/Shanghai 固定 UTC+8（无夏令时），按日界换算成 UTC 存储。
export function parseShanghaiDate(value: string, endOfDay = false): Date {
  const hour = endOfDay ? 23 : 0;
  const minute = endOfDay ? 59 : 0;
  const second = endOfDay ? 59 : 0;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error(`无法解析日期：${value}`);
  }
  return new Date(
    Date.UTC(year, month - 1, day, hour - 8, minute, second),
  );
}
