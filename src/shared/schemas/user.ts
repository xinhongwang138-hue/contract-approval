import { z } from "zod";
import { nullableIdSchema } from "./department";

export const passwordSchema = z
  .string()
  .min(10, "密码至少 10 位")
  .max(100, "密码不能超过 100 位")
  .regex(/[A-Za-z]/, "密码需包含字母")
  .regex(/\d/, "密码需包含数字");

export const userCreateSchema = z.object({
  name: z.string().trim().min(1, "请输入姓名").max(50, "姓名不能超过 50 字"),
  email: z.string().trim().toLowerCase().pipe(z.email("请输入有效的邮箱地址")),
  password: passwordSchema,
  departmentId: nullableIdSchema,
  managerUserId: nullableIdSchema,
  status: z.enum(["active", "disabled"]).default("active"),
  roleIds: z
    .array(z.string().trim().min(1))
    .min(1, "至少选择一个角色")
    .max(10, "角色数量过多"),
});

export const userUpdateSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1, "请输入姓名").max(50, "姓名不能超过 50 字"),
  departmentId: nullableIdSchema,
  managerUserId: nullableIdSchema,
  status: z.enum(["active", "disabled"]),
  roleIds: z
    .array(z.string().trim().min(1))
    .min(1, "至少选择一个角色")
    .max(10, "角色数量过多"),
});

export const passwordResetSchema = z.object({
  userId: z.string().trim().min(1),
  password: passwordSchema,
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
