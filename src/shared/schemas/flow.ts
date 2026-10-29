import { z } from "zod";

export const FLOW_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,29}$/;

const flowCodeSchema = z.preprocess(
  (value) =>
    typeof value === "string" ? value.trim().toUpperCase() : value,
  z
    .string()
    .regex(
      FLOW_CODE_PATTERN,
      "流程编码需以大写字母开头，仅含大写字母、数字、下划线，2-30 位",
    ),
);

const nameSchema = z
  .string()
  .trim()
  .min(1, "请输入流程名称")
  .max(60, "流程名称不能超过 60 字");

const categorySchema = z
  .string()
  .trim()
  .min(1, "请输入流程分类")
  .max(30, "流程分类不能超过 30 字");

const idSchema = z.string().trim().min(1, "缺少流程标识");

export const flowCreateSchema = z.object({
  code: flowCodeSchema,
  name: nameSchema,
  category: categorySchema,
});

export const flowUpdateSchema = z.object({
  id: idSchema,
  name: nameSchema,
  category: categorySchema,
});

export const flowIdSchema = z.object({ id: idSchema });

// 草稿允许保存未完成的图，严格校验在发布时执行。
export const flowDraftSchema = z.object({
  id: idSchema,
  definition: z.object({
    schemaVersion: z.number().int().positive(),
    entry: z.string().trim().min(1),
    nodes: z.array(z.record(z.string(), z.unknown())).max(80),
  }),
});

export const flowBindTemplateSchema = z.object({
  templateId: idSchema,
  flowId: z.string().trim().nullable(),
});

export type FlowCreateInput = z.infer<typeof flowCreateSchema>;
export type FlowUpdateInput = z.infer<typeof flowUpdateSchema>;
export type FlowDraftInput = z.infer<typeof flowDraftSchema>;
