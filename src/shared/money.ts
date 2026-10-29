import Decimal from "decimal.js";

export { Decimal };
export type Money = Decimal;

export const MONEY_SCALE = 2;

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
};

export function toDecimal(value: string | Decimal): Decimal {
  const parsed = new Decimal(value);
  if (!parsed.isFinite()) {
    throw new Error(`非法金额: ${value}`);
  }
  return parsed;
}

export function formatMoney(value: string | Decimal, currency = "CNY"): string {
  const fixed = toDecimal(value).toFixed(MONEY_SCALE);
  const negative = fixed.startsWith("-");
  const unsigned = negative ? fixed.slice(1) : fixed;
  const [integerPart = "0", fractionPart = "00"] = unsigned.split(".");
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  return `${negative ? "-" : ""}${symbol}${grouped}.${fractionPart}`;
}
