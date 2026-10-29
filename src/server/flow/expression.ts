import type { ConditionExpr } from "@/shared/flow-definition";

export type ExpressionRoots = {
  contract: Record<string, unknown>;
  form: Record<string, unknown>;
  initiator: Record<string, unknown>;
};

export type ExpressionIssue = { path: string; message: string };

export type ConditionBranchLike = { id: string; when: ConditionExpr | null };

const ROOT_KEYS = ["contract", "form", "initiator"] as const;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T/;

function readPath(roots: ExpressionRoots, path: string): {
  present: boolean;
  value: unknown;
} {
  const segments = path.split(".");
  const root = segments[0];
  if (!root || !ROOT_KEYS.includes(root as (typeof ROOT_KEYS)[number])) {
    return { present: false, value: undefined };
  }

  let current: unknown = roots[root as keyof ExpressionRoots];
  for (const segment of segments.slice(1)) {
    if (current === null || typeof current !== "object" || !(segment in current)) {
      return { present: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { present: true, value: current };
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return null;
}

// 日期时间戳与 date-only 字符串比较时按天对齐，否则同一天会因为时:分:秒判不等。
function alignDates(left: string, right: string): [string, string] {
  if (DATE_ONLY_PATTERN.test(right) && ISO_TIMESTAMP_PATTERN.test(left)) {
    return [left.slice(0, 10), right];
  }
  if (DATE_ONLY_PATTERN.test(left) && ISO_TIMESTAMP_PATTERN.test(right)) {
    return [left, right.slice(0, 10)];
  }
  return [left, right];
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim() === "";
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (value instanceof Date || typeof value !== "object") {
    return false;
  }
  return Object.keys(value).length === 0;
}

function equals(left: unknown, right: unknown): boolean {
  if (left === undefined || left === null || right === undefined || right === null) {
    return (left ?? null) === (right ?? null);
  }
  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);
  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber === rightNumber;
  }
  const leftText = toText(left);
  const rightText = toText(right);
  if (leftText === null || rightText === null) {
    return false;
  }
  const [alignedLeft, alignedRight] = alignDates(leftText, rightText);
  return alignedLeft === alignedRight;
}

function compare(left: unknown, right: unknown): number | null {
  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);
  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber === rightNumber ? 0 : leftNumber < rightNumber ? -1 : 1;
  }
  const leftText = toText(left);
  const rightText = toText(right);
  if (leftText === null || rightText === null) {
    return null;
  }
  const [alignedLeft, alignedRight] = alignDates(leftText, rightText);
  if (alignedLeft === alignedRight) {
    return 0;
  }
  return alignedLeft < alignedRight ? -1 : 1;
}

function includesValue(list: unknown[], value: unknown): boolean {
  return list.some((item) => equals(item, value));
}

function evaluateLeaf(
  expr: Extract<ConditionExpr, { left: string }>,
  roots: ExpressionRoots,
  issues?: ExpressionIssue[],
): boolean {
  const { present, value } = readPath(roots, expr.left);

  if (expr.op === "empty") {
    return isEmptyValue(value);
  }
  if (expr.op === "not_empty") {
    return !isEmptyValue(value);
  }
  if (!present) {
    issues?.push({ path: expr.left, message: `路径 ${expr.left} 不存在，按 false 处理` });
    return false;
  }

  switch (expr.op) {
    case "eq":
      return equals(value, expr.right);
    case "ne":
      return !equals(value, expr.right);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const order = compare(value, expr.right);
      if (order === null) {
        issues?.push({
          path: expr.left,
          message: `路径 ${expr.left} 无法与右值比较，按 false 处理`,
        });
        return false;
      }
      if (expr.op === "gt") return order > 0;
      if (expr.op === "gte") return order >= 0;
      if (expr.op === "lt") return order < 0;
      return order <= 0;
    }
    case "in":
      return Array.isArray(expr.right) && includesValue(expr.right, value);
    case "not_in":
      return Array.isArray(expr.right) && !includesValue(expr.right, value);
    case "contains": {
      if (Array.isArray(value)) {
        return includesValue(value, expr.right);
      }
      const text = toText(value);
      const needle = toText(expr.right);
      return text !== null && needle !== null && text.includes(needle);
    }
  }
}

export function evaluateCondition(
  expr: ConditionExpr,
  roots: ExpressionRoots,
  issues?: ExpressionIssue[],
): boolean {
  if ("all" in expr) {
    return expr.all.every((child) => evaluateCondition(child, roots, issues));
  }
  if ("any" in expr) {
    return expr.any.some((child) => evaluateCondition(child, roots, issues));
  }
  return evaluateLeaf(expr, roots, issues);
}

export function resolveBranch<B extends ConditionBranchLike>(
  branches: readonly B[],
  roots: ExpressionRoots,
  issues?: ExpressionIssue[],
): B | null {
  for (const branch of branches) {
    if (branch.when !== null && evaluateCondition(branch.when, roots, issues)) {
      return branch;
    }
  }
  return branches.find((branch) => branch.when === null) ?? null;
}
