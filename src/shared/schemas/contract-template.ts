import { z } from "zod";
import { contractFieldArraySchema } from "@/shared/contract-fields";

export const TEMPLATE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,19}$/;

const templateCodeSchema = z.preprocess(
  (value) =>
    typeof value === "string" ? value.trim().toUpperCase() : value,
  z
    .string()
    .regex(
      TEMPLATE_CODE_PATTERN,
      "模板编码需以大写字母开头，仅含大写字母、数字、下划线，2-20 位",
    ),
);

const nameSchema = z
  .string()
  .trim()
  .min(1, "请输入模板名称")
  .max(60, "模板名称不能超过 60 字");

const categorySchema = z
  .string()
  .trim()
  .min(1, "请输入模板分类")
  .max(30, "模板分类不能超过 30 字");

const fieldsSchema = contractFieldArraySchema;

export const contractTemplateCreateSchema = z.object({
  code: templateCodeSchema,
  name: nameSchema,
  category: categorySchema,
  active: z.boolean().default(true),
  fields: fieldsSchema.default([]),
});

export const contractTemplateUpdateSchema = z.object({
  id: z.string().trim().min(1),
  name: nameSchema,
  category: categorySchema,
  active: z.boolean().default(true),
  // 元信息对话框不提交字段；缺省即保持 fieldSchema 不变。
  fields: fieldsSchema.optional(),
});

export const contractTemplateToggleSchema = z.object({
  id: z.string().trim().min(1),
  active: z.boolean(),
});

export const contractTemplateFieldsSchema = z.object({
  id: z.string().trim().min(1),
  fields: fieldsSchema,
});

export type ContractTemplateCreateInput = z.infer<
  typeof contractTemplateCreateSchema
>;
export type ContractTemplateUpdateInput = z.infer<
  typeof contractTemplateUpdateSchema
>;
