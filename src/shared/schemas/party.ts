import { z } from "zod";

const usccSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }
    const normalized = value.trim().toUpperCase();
    return normalized === "" ? null : normalized;
  },
  z
    .string()
    .length(18, "统一社会信用代码为 18 位")
    .regex(/^[0-9A-HJ-NPQRTUWXY]{18}$/, "统一社会信用代码格式不正确")
    .nullable()
    .optional(),
);

export const partyContactSchema = z.object({
  name: z.string().trim().min(1, "联系人姓名必填").max(30, "联系人姓名过长"),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s()]{5,25}$/, "联系电话格式不正确")
    .or(z.literal(""))
    .optional(),
  email: z
    .string()
    .trim()
    .pipe(z.email("联系人邮箱格式不正确"))
    .or(z.literal(""))
    .optional(),
});

export const partyFormSchema = z.object({
  name: z.string().trim().min(1, "请输入相对方名称").max(100, "名称不能超过 100 字"),
  uscc: usccSchema,
  type: z.enum(["customer", "supplier", "other"]),
  address: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().max(200, "地址不能超过 200 字").nullable().optional(),
  ),
  contacts: z.array(partyContactSchema).max(10, "联系人不能超过 10 个").default([]),
});

export const partyUpdateSchema = partyFormSchema.extend({
  id: z.string().trim().min(1),
});

export type PartyFormInput = z.infer<typeof partyFormSchema>;
export type PartyContactInput = z.infer<typeof partyContactSchema>;
