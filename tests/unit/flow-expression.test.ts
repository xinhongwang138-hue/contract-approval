import { describe, expect, it } from "vitest";
import {
  evaluateCondition,
  resolveBranch,
  type ExpressionRoots,
} from "@/server/flow/expression";
import type { ConditionExpr } from "@/shared/flow-definition";

const roots: ExpressionRoots = {
  contract: {
    amount: 600000,
    category: "sales",
    days: 20,
    signDate: new Date("2026-10-15T00:00:00.000Z"),
    title: "年度框架协议",
    tags: ["urgent", "renew"],
    partyB: { name: "杭州云诚" },
    missingLater: undefined,
  },
  form: {
    payType: "现结",
    rebateRate: 12.5,
    note: "",
    attachments: [],
  },
  initiator: {
    departmentId: "dept-1",
    level: 3,
  },
};

function evalExpr(expr: ConditionExpr): boolean {
  return evaluateCondition(expr, roots);
}

describe("condition expression ops", () => {
  it("compares numbers with eq/ne/gt/gte/lt/lte", () => {
    expect(evalExpr({ left: "contract.amount", op: "eq", right: 600000 })).toBe(true);
    expect(evalExpr({ left: "contract.amount", op: "ne", right: 600000 })).toBe(false);
    expect(evalExpr({ left: "contract.amount", op: "gte", right: 500000 })).toBe(true);
    expect(evalExpr({ left: "contract.amount", op: "gt", right: 600000 })).toBe(false);
    expect(evalExpr({ left: "contract.amount", op: "lt", right: 600000 })).toBe(false);
    expect(evalExpr({ left: "form.rebateRate", op: "lte", right: 12.5 })).toBe(true);
  });

  it("compares ISO date objects against date-only strings", () => {
    expect(
      evalExpr({ left: "contract.signDate", op: "lt", right: "2026-11-01" }),
    ).toBe(true);
    expect(
      evalExpr({ left: "contract.signDate", op: "eq", right: "2026-10-15" }),
    ).toBe(true);
  });

  it("matches strings exactly and arrays with in/not_in", () => {
    expect(evalExpr({ left: "contract.category", op: "in", right: ["sales", "service"] })).toBe(
      true,
    );
    expect(evalExpr({ left: "contract.category", op: "not_in", right: ["purchase"] })).toBe(true);
    expect(evalExpr({ left: "form.payType", op: "eq", right: "月结" })).toBe(false);
    expect(evalExpr({ left: "initiator.level", op: "in", right: [1, 2, 3] })).toBe(true);
  });

  it("supports contains on strings and arrays", () => {
    expect(evalExpr({ left: "contract.title", op: "contains", right: "框架" })).toBe(true);
    expect(evalExpr({ left: "contract.tags", op: "contains", right: "urgent" })).toBe(true);
    expect(evalExpr({ left: "contract.tags", op: "contains", right: "vip" })).toBe(false);
  });

  it("detects empty and not_empty", () => {
    expect(evalExpr({ left: "form.note", op: "empty" })).toBe(true);
    expect(evalExpr({ left: "form.attachments", op: "empty" })).toBe(true);
    expect(evalExpr({ left: "contract.tags", op: "not_empty" })).toBe(true);
    expect(evalExpr({ left: "form.payType", op: "empty" })).toBe(false);
  });

  it("reads nested dot paths only", () => {
    expect(evalExpr({ left: "contract.partyB.name", op: "eq", right: "杭州云诚" })).toBe(true);
    expect(evalExpr({ left: "contract.partyB.address", op: "empty" })).toBe(true);
  });
});

describe("condition expression grouping and missing paths", () => {
  it("evaluates nested all/any", () => {
    expect(
      evalExpr({
        all: [
          { left: "contract.amount", op: "gte", right: 500000 },
          {
            any: [
              { left: "contract.category", op: "in", right: ["sales", "service"] },
              { left: "contract.days", op: "lt", right: 30 },
            ],
          },
        ],
      }),
    ).toBe(true);

    expect(
      evalExpr({
        all: [
          { left: "contract.amount", op: "gte", right: 5000000 },
          { left: "contract.category", op: "eq", right: "sales" },
        ],
      }),
    ).toBe(false);
  });

  it("treats unknown paths as false and reports the reason", () => {
    const issues: { path: string; message: string }[] = [];
    expect(
      evaluateCondition(
        { left: "contract.notThere", op: "gt", right: 1 },
        roots,
        issues,
      ),
    ).toBe(false);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("contract.notThere");
  });

  it("treats a declared-but-undefined value as empty, not as an error", () => {
    const issues: { path: string; message: string }[] = [];
    expect(
      evaluateCondition({ left: "contract.missingLater", op: "empty" }, roots, issues),
    ).toBe(true);
    expect(issues).toHaveLength(0);
  });

  it("keeps boolean operands strict", () => {
    expect(evaluateCondition({ left: "initiator.level", op: "eq", right: "3" }, roots)).toBe(
      true,
    );
    expect(evaluateCondition({ left: "form.rebateRate", op: "eq", right: 12 }, roots)).toBe(
      false,
    );
  });
});

describe("branch resolution", () => {
  it("picks the first matching branch and falls back to the default", () => {
    const branches = [
      { id: "big", name: "大额", when: { left: "contract.amount", op: "gte", right: 500000 } as ConditionExpr, next: "legal" },
      { id: "small", name: "小额", when: { left: "contract.amount", op: "lt", right: 100 } as ConditionExpr, next: "manager" },
      { id: "default", name: "默认", when: null, next: "manager" },
    ];
    expect(resolveBranch(branches, roots)?.id).toBe("big");
    expect(
      resolveBranch(
        [
          { id: "huge", name: "巨款", when: { left: "contract.amount", op: "gte", right: 9999999 } as ConditionExpr, next: "legal" },
          ...branches.slice(1),
        ],
        roots,
      )?.id,
    ).toBe("default");
  });

  it("returns null when no branch and no default match", () => {
    expect(
      resolveBranch(
        [{ id: "x", name: "x", when: { left: "contract.amount", op: "gt", right: 1e9 } as ConditionExpr, next: "legal" }],
        roots,
      ),
    ).toBeNull();
  });
});
