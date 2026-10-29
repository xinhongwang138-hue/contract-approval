import { z } from "zod";

export const nullableIdSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? null : value,
  z.string().trim().min(1).nullable().optional(),
);

export const departmentFormSchema = z.object({
  name: z.string().trim().min(1, "请输入部门名称").max(50, "部门名称不能超过 50 字"),
  parentId: nullableIdSchema,
  managerUserId: nullableIdSchema,
  sortOrder: z.coerce
    .number()
    .int("排序必须是整数")
    .min(0, "排序不能小于 0")
    .max(9999, "排序不能大于 9999")
    .default(0),
});

export const departmentUpdateSchema = departmentFormSchema.extend({
  id: z.string().trim().min(1),
});

export type DepartmentFormInput = z.infer<typeof departmentFormSchema>;
export type DepartmentUpdateInput = z.infer<typeof departmentUpdateSchema>;
