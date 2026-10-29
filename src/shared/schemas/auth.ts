import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("请输入有效的邮箱地址")),
  password: z.string().min(1, "请输入密码").max(200, "密码过长"),
});

export type LoginInput = z.infer<typeof loginSchema>;
