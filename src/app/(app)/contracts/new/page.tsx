import Link from "next/link";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ContractForm } from "@/components/contract/contract-form";
import { getAccessContext } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/session";
import { listContractFormOptions } from "@/server/services/contract";

export const metadata = { title: "新建合同" };

export default async function NewContractPage() {
  const { user } = await requirePageAuth();
  const access = await getAccessContext(user.id);

  if (!access.permissions.has("contract.create")) {
    return <AccessDenied permission="contract.create" />;
  }

  const options = await listContractFormOptions(access);

  return (
    <div className="space-y-6">
      <PageHeader
        title="新建合同"
        description="选择模板后填写动态字段；保存后生成合同编号与初始版本。"
        actions={
          <Button asChild variant="outline">
            <Link href="/contracts">返回列表</Link>
          </Button>
        }
      />
      <ContractForm options={options} initial={null} />
    </div>
  );
}
