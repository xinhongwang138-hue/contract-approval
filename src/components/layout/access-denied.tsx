import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function AccessDenied({ permission }: { permission: string }) {
  return (
    <Alert variant="destructive">
      <ShieldAlert />
      <AlertTitle>无权访问</AlertTitle>
      <AlertDescription>
        当前账号缺少「{permission}」权限，请联系系统管理员分配角色。
      </AlertDescription>
    </Alert>
  );
}
