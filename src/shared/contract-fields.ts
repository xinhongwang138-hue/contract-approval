import { z } from "zod";

export const CONTRACT_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
] as const;

export type ContractFieldType = (typeof CONTRACT_FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<ContractFieldType, string> = {
  text: "单行文本",
  textarea: "多行文本",
  number: "数字",
  date: "日期",
  select: "下拉选择",
};

const FIELD_KEY_PATTERN = /^[a-z][a-zA-Z0-9_]{0,39}$/;

export const contractFieldSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(
        FIELD_KEY_PATTERN,
        "字段标识需以小写字母开头，仅含字母、数字、下划线",
      ),
    label: z
      .string()
      .trim()
      .min(1, "请输入字段名称")
      .max(40, "字段名称不能超过 40 字"),
    type: z.enum(CONTRACT_FIELD_TYPES),
    required: z.boolean().default(false),
    options: z
      .array(z.string().trim().min(1, "选项不能为空").max(40, "选项过长"))
      .max(20, "选项不能超过 20 个")
      .default([]),
    min: z.number().finite().nullable().default(null),
    max: z.number().finite().nullable().default(null),
    visibleWhen: z
      .object({
        field: z.string().trim().min(1),
        equals: z.union([z.string(), z.number(), z.boolean()]),
      })
      .nullable()
      .default(null),
  })
  .superRefine((field, ctx) => {
    if (field.type === "select" && field.options.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "下拉字段至少需要一个选项",
      });
    }
    if (field.type !== "select" && field.options.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "只有下拉字段可以配置选项",
      });
    }
    if (field.type !== "number" && (field.min !== null || field.max !== null)) {
      ctx.addIssue({
        code: "custom",
        path: ["min"],
        message: "只有数字字段可以配置最小/最大值",
      });
    }
    if (field.min !== null && field.max !== null && field.min > field.max) {
      ctx.addIssue({
        code: "custom",
        path: ["max"],
        message: "最大值不能小于最小值",
      });
    }
  });

export const contractFieldArraySchema = z
  .array(contractFieldSchema)
  .max(30, "字段不能超过 30 个")
  .superRefine((fields, ctx) => {
    const positions = new Map<string, number>();
    fields.forEach((field, index) => {
      if (positions.has(field.key)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "key"],
          message: `字段标识重复：${field.key}`,
        });
      }
      positions.set(field.key, index);
    });

    fields.forEach((field, index) => {
      if (!field.visibleWhen) {
        return;
      }
      const dependencyIndex = positions.get(field.visibleWhen.field);
      if (dependencyIndex === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [index, "visibleWhen"],
          message: `可见条件引用了不存在的字段：${field.visibleWhen.field}`,
        });
      } else if (dependencyIndex >= index) {
        ctx.addIssue({
          code: "custom",
          path: [index, "visibleWhen"],
          message: "可见条件只能引用排在前面的字段",
        });
      }
    });
  });

export type ContractField = z.infer<typeof contractFieldSchema>;
export type ContractFieldInput = z.input<typeof contractFieldSchema>;

export function parseFieldSchema(value: unknown): ContractField[] {
  const parsed = contractFieldArraySchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export type ContractFormValue = string | number;
export type ContractFormData = Record<string, ContractFormValue>;

export type FormValuesResult =
  | { ok: true; data: ContractFormData }
  | { ok: false; errors: Record<string, string> };

export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  );
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (isEmpty(left)) {
    return false;
  }
  return String(left) === String(right);
}

export function validateContractFormValues(
  fields: ContractField[],
  raw: Record<string, unknown>,
): FormValuesResult {
  const data: ContractFormData = {};
  const errors: Record<string, string> = {};
  const visibility = new Map<string, boolean>();

  for (const field of fields) {
    const condition = field.visibleWhen;
    const visible =
      condition === null ||
      (visibility.get(condition.field) === true &&
        valuesEqual(raw[condition.field], condition.equals));
    visibility.set(field.key, visible);

    if (!visible) {
      continue;
    }

    const value = raw[field.key];
    if (isEmpty(value)) {
      if (field.required) {
        errors[field.key] = `请填写${field.label}`;
      }
      continue;
    }

    switch (field.type) {
      case "text":
      case "textarea": {
        if (typeof value !== "string") {
          errors[field.key] = `${field.label}格式不正确`;
          break;
        }
        const trimmed = value.trim();
        const limit = field.type === "text" ? 200 : 5000;
        if (trimmed.length > limit) {
          errors[field.key] = `${field.label}不能超过 ${limit} 字`;
          break;
        }
        data[field.key] = trimmed;
        break;
      }
      case "date": {
        if (typeof value !== "string" || !isValidDateOnly(value)) {
          errors[field.key] = `请选择有效的${field.label}`;
          break;
        }
        data[field.key] = value;
        break;
      }
      case "number": {
        const parsed =
          typeof value === "number" ? value : Number(String(value).trim());
        if (!Number.isFinite(parsed)) {
          errors[field.key] = `${field.label}必须是数字`;
          break;
        }
        if (field.min !== null && parsed < field.min) {
          errors[field.key] = `${field.label}不能小于 ${field.min}`;
          break;
        }
        if (field.max !== null && parsed > field.max) {
          errors[field.key] = `${field.label}不能大于 ${field.max}`;
          break;
        }
        data[field.key] = parsed;
        break;
      }
      case "select": {
        if (typeof value !== "string" || !field.options.includes(value)) {
          errors[field.key] = `请选择有效的${field.label}`;
          break;
        }
        data[field.key] = value;
        break;
      }
    }
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, data };
}

export function formatContractFieldValue(
  field: ContractField,
  value: unknown,
): string {
  if (isEmpty(value)) {
    return "—";
  }
  if (field.type === "number" && typeof value === "number") {
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(
      value,
    );
  }
  return String(value);
}
