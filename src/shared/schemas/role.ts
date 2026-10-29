import { z } from "zod";
import { PERMISSION_KEYS } from "../permissions";
import { nullableIdSchema } from "./department";

export const roleKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9_]{1,31}$/,
    "角色标识需以小写字母开头，仅含小写字母、数字和下划线，长度 2-32",
  );

export const roleCreateSchema = z.object({
  key: roleKeySchema,
  name: z.string().trim().min(1, "请输入角色名称").max(30, "角色名称不能超过 30 字"),
  permissionKeys: z
    .array(z.enum(PERMISSION_KEYS))
    .min(1, "至少选择一项权限"),
  scope: z.enum(["self", "dept", "dept_and_sub", "all"]),
  departmentId: nullableIdSchema,
});

export const roleUpdateSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1, "请输入角色名称").max(30, "角色名称不能超过 30 字"),
  permissionKeys: z
    .array(z.enum(PERMISSION_KEYS))
    .min(1, "至少选择一项权限"),
  scope: z.enum(["self", "dept", "dept_and_sub", "all"]),
  departmentId: nullableIdSchema,
});

export type RoleCreateInput = z.infer<typeof roleCreateSchema>;
export type RoleUpdateInput = z.infer<typeof roleUpdateSchema>;
