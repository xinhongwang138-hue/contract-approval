import { describe, expect, it } from "vitest";
import {
  contractFieldArraySchema,
  formatContractFieldValue,
  isValidDateOnly,
  parseFieldSchema,
  validateContractFormValues,
  type ContractField,
} from "@/shared/contract-fields";

function fields(input: unknown): ContractField[] {
  const parsed = contractFieldArraySchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`fixture invalid: ${parsed.error.issues[0]?.message}`);
  }
  return parsed.data;
}

const simpleFields = fields([
  { key: "contact", label: "联系人", type: "text", required: true },
  { key: "days", label: "账期天数", type: "number", min: 0, max: 180 },
  { key: "signedAt", label: "签署日期", type: "date", required: true },
  {
    key: "payType",
    label: "付款方式",
    type: "select",
    options: ["月结", "现结"],
    required: true,
  },
]);

describe("contractFieldArraySchema", () => {
  it("apply defaults", () => {
    const [field] = fields([{ key: "note", label: "备注", type: "textarea" }]);
    expect(field).toEqual({
      key: "note",
      label: "备注",
      type: "textarea",
      required: false,
      options: [],
      min: null,
      max: null,
      visibleWhen: null,
    });
  });

  it("rejects invalid key and blank label", () => {
    const keyResult = contractFieldArraySchema.safeParse([
      { key: "1abc", label: "甲", type: "text" },
    ]);
    expect(keyResult.success).toBe(false);

    const labelResult = contractFieldArraySchema.safeParse([
      { key: "abc", label: "  ", type: "text" },
    ]);
    expect(labelResult.success).toBe(false);
  });

  it("rejects duplicate keys", () => {
    const result = contractFieldArraySchema.safeParse([
      { key: "same", label: "甲", type: "text" },
      { key: "same", label: "乙", type: "text" },
    ]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([1, "key"]);
  });

  it("requires options for select and forbids them elsewhere", () => {
    expect(
      contractFieldArraySchema.safeParse([
        { key: "s", label: "选择", type: "select" },
      ]).success,
    ).toBe(false);

    expect(
      contractFieldArraySchema.safeParse([
        { key: "t", label: "文本", type: "text", options: ["a"] },
      ]).success,
    ).toBe(false);
  });

  it("only allows min/max on number fields with min <= max", () => {
    expect(
      contractFieldArraySchema.safeParse([
        { key: "t", label: "文本", type: "text", min: 1 },
      ]).success,
    ).toBe(false);

    expect(
      contractFieldArraySchema.safeParse([
        { key: "n", label: "数字", type: "number", min: 10, max: 5 },
      ]).success,
    ).toBe(false);
  });

  it("requires visibleWhen to reference an earlier field", () => {
    const forward = contractFieldArraySchema.safeParse([
      {
        key: "a",
        label: "甲",
        type: "text",
        visibleWhen: { field: "b", equals: "x" },
      },
      { key: "b", label: "乙", type: "text" },
    ]);
    expect(forward.success).toBe(false);

    const missing = contractFieldArraySchema.safeParse([
      {
        key: "a",
        label: "甲",
        type: "text",
        visibleWhen: { field: "ghost", equals: "x" },
      },
    ]);
    expect(missing.success).toBe(false);
  });

  it("parseFieldSchema falls back to empty array on garbage", () => {
    expect(parseFieldSchema(null)).toEqual([]);
    expect(parseFieldSchema([{ nothing: true }])).toEqual([]);
  });
});

describe("validateContractFormValues", () => {
  it("accepts a complete submission and strips unknown keys", () => {
    const result = validateContractFormValues(simpleFields, {
      contact: "  张三 ",
      days: "30",
      signedAt: "2026-11-01",
      payType: "月结",
      ghost: "x",
    });
    expect(result).toEqual({
      ok: true,
      data: {
        contact: "张三",
        days: 30,
        signedAt: "2026-11-01",
        payType: "月结",
      },
    });
  });

  it("reports missing required fields", () => {
    const result = validateContractFormValues(simpleFields, { contact: " " });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors["contact"]).toBe("请填写联系人");
      expect(result.errors["signedAt"]).toBe("请填写签署日期");
      expect(result.errors["payType"]).toBe("请填写付款方式");
    }
    expect(result.ok ? null : result.errors["days"]).toBeUndefined();
  });

  it("validates number bounds and date format", () => {
    const tooBig = validateContractFormValues(simpleFields, {
      contact: "张三",
      days: "365",
      signedAt: "2026-11-01",
      payType: "现结",
    });
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) {
      expect(tooBig.errors["days"]).toBe("账期天数不能大于 180");
    }

    const badDate = validateContractFormValues(simpleFields, {
      contact: "张三",
      days: "10",
      signedAt: "2026-02-30",
      payType: "现结",
    });
    expect(badDate.ok).toBe(false);
    if (!badDate.ok) {
      expect(badDate.errors["signedAt"]).toBe("请选择有效的签署日期");
    }
  });

  it("rejects select values outside options", () => {
    const result = validateContractFormValues(simpleFields, {
      contact: "张三",
      days: "10",
      signedAt: "2026-11-01",
      payType: "年结",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors["payType"]).toBe("请选择有效的付款方式");
    }
  });

  it("skips hidden fields and cascades visibility", () => {
    const conditional = fields([
      { key: "mode", label: "模式", type: "select", options: ["标准", "定制"] },
      {
        key: "detail",
        label: "定制说明",
        type: "text",
        required: true,
        visibleWhen: { field: "mode", equals: "定制" },
      },
      {
        key: "detailNote",
        label: "补充说明",
        type: "text",
        required: true,
        visibleWhen: { field: "detail", equals: "需要" },
      },
    ]);

    const hidden = validateContractFormValues(conditional, { mode: "标准" });
    expect(hidden).toEqual({ ok: true, data: { mode: "标准" } });

    const visible = validateContractFormValues(conditional, {
      mode: "定制",
    });
    expect(visible.ok).toBe(false);
    if (!visible.ok) {
      expect(visible.errors["detail"]).toBe("请填写定制说明");
    }

    const cascaded = validateContractFormValues(conditional, {
      mode: "定制",
      detail: "需要",
    });
    expect(cascaded.ok).toBe(false);
    if (!cascaded.ok) {
      expect(cascaded.errors["detailNote"]).toBe("请填写补充说明");
    }

    const fullyHidden = validateContractFormValues(conditional, {
      mode: "标准",
      detail: "需要",
      detailNote: "注",
    });
    expect(fullyHidden).toEqual({ ok: true, data: { mode: "标准" } });
  });
});

describe("date helpers", () => {
  it("accepts real dates only", () => {
    expect(isValidDateOnly("2026-02-28")).toBe(true);
    expect(isValidDateOnly("2024-02-29")).toBe(true);
    expect(isValidDateOnly("2026-02-30")).toBe(false);
    expect(isValidDateOnly("2026-2-3")).toBe(false);
    expect(isValidDateOnly("2026-02-28T00:00:00Z")).toBe(false);
  });
});

describe("formatContractFieldValue", () => {
  it("renders placeholders, numbers and text", () => {
    const [numberField] = fields([
      { key: "n", label: "数字", type: "number" },
    ]);
    expect(formatContractFieldValue(numberField!, 12345.6)).toBe("12,345.6");
    expect(formatContractFieldValue(numberField!, null)).toBe("—");
    expect(formatContractFieldValue(numberField!, undefined)).toBe("—");
    expect(formatContractFieldValue(numberField!, "")).toBe("—");

    const [textField] = fields([{ key: "t", label: "文本", type: "text" }]);
    expect(formatContractFieldValue(textField!, "月结")).toBe("月结");
  });
});
