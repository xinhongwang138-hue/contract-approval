import { z } from "zod";
import { isValidDateOnly } from "@/shared/contract-fields";
import { CONTRACT_STATUSES } from "@/shared/state-machines";

export const dateOnlySchema = z
  .string()
  .trim()
  .refine(isValidDateOnly, "请选择有效日期");

export const amountInputSchema = z
  .string()
  .trim()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, "金额需为数字，最多两位小数")
  .refine((value) => Number(value) > 0, "金额必须大于 0");

const currencySchema = z.preprocess(
  (value) =>
    typeof value === "string" ? value.trim().toUpperCase() : value,
  z
    .string()
    .regex(/^[A-Z]{3}$/, "币种需为 3 位字母代码")
    .default("CNY"),
);

const draftBaseSchema = z.object({
  templateId: z.string().trim().min(1, "请选择合同模板"),
  typeId: z.string().trim().min(1, "请选择合同类型"),
  title: z
    .string()
    .trim()
    .min(1, "请输入合同标题")
    .max(100, "合同标题不能超过 100 字"),
  partyAId: z.string().trim().min(1, "请选择甲方"),
  partyBId: z.string().trim().min(1, "请选择乙方"),
  amount: amountInputSchema,
  currency: currencySchema,
  signDate: dateOnlySchema,
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  formData: z.record(z.string(), z.unknown()).default({}),
  bodyMarkdown: z
    .string()
    .max(200_000, "正文不能超过 20 万字符")
    .default(""),
});

function refineDraft(
  value: {
    partyAId: string;
    partyBId: string;
    startDate: string;
    endDate: string;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.partyAId === value.partyBId) {
    ctx.addIssue({
      code: "custom",
      path: ["partyBId"],
      message: "乙方不能与甲方相同",
    });
  }
  if (value.endDate < value.startDate) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "结束日期不能早于开始日期",
    });
  }
}

export const contractDraftSchema = draftBaseSchema.superRefine(refineDraft);

export const contractUpdateSchema = draftBaseSchema
  .extend({ id: z.string().trim().min(1) })
  .superRefine(refineDraft);

export const CONTRACT_SORT_FIELDS = [
  "updatedAt",
  "createdAt",
  "amount",
  "endDate",
] as const;

export const CONTRACT_SORT_LABELS: Record<
  (typeof CONTRACT_SORT_FIELDS)[number],
  string
> = {
  updatedAt: "最近更新",
  createdAt: "创建时间",
  amount: "金额",
  endDate: "到期日",
};

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const contractListQuerySchema = z.object({
  q: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(80).optional(),
  ),
  status: z.preprocess(
    emptyToUndefined,
    z.enum(CONTRACT_STATUSES).optional(),
  ),
  page: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).default(1),
  ),
  pageSize: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(100).default(20),
  ),
  sort: z.preprocess(
    emptyToUndefined,
    z.enum(CONTRACT_SORT_FIELDS).default("updatedAt"),
  ),
  order: z.preprocess(
    emptyToUndefined,
    z.enum(["asc", "desc"]).default("desc"),
  ),
});

export type ContractDraftInput = z.infer<typeof contractDraftSchema>;
export type ContractUpdateInput = z.infer<typeof contractUpdateSchema>;
export type ContractListQuery = z.infer<typeof contractListQuerySchema>;
export type ContractSortField = (typeof CONTRACT_SORT_FIELDS)[number];
