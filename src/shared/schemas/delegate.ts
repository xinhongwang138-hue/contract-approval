import { z } from "zod";

export const DELEGATABLE_PERMISSIONS = ["contract.approve", "contract.read"] as const;
export type DelegatablePermission = (typeof DELEGATABLE_PERMISSIONS)[number];

export const DELEGATE_PERMISSION_LABELS: Record<DelegatablePermission, string> = {
  "contract.approve": "审批合同",
  "contract.read": "查看合同",
};

const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "请选择日期");

export const delegateFormSchema = z
  .object({
    id: z.string().trim().optional(),
    fromUserId: z.string().trim().min(1, "请选择委托人"),
    toUserId: z.string().trim().min(1, "请选择受托人"),
    permissionKeys: z.array(z.enum(DELEGATABLE_PERMISSIONS)).min(1, "至少选择一项权限"),
    startDate: dateSchema,
    endDate: dateSchema,
    reason: z.string().trim().min(2, "请填写委托原因").max(200, "原因不能超过 200 字"),
  })
  .refine((value) => value.fromUserId !== value.toUserId, {
    message: "不能委托给自己",
    path: ["toUserId"],
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: "结束日期不能早于开始日期",
    path: ["endDate"],
  });

export type DelegateFormInput = z.infer<typeof delegateFormSchema>;
