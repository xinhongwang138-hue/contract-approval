import type { ContractStatus } from "@/shared/state-machines";

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: "草稿",
  pending: "待审批",
  approving: "审批中",
  approved: "审批通过",
  to_seal: "待用印",
  sealed: "已用印",
  active: "履行中",
  rejected: "已驳回",
  withdrawn: "已撤回",
  amended: "变更中",
  expired: "已到期",
  terminated: "已终止",
  archived: "已归档",
};

export const CONTRACT_STAGE_LABELS: Record<string, string> = {
  normal: "正常",
  returned: "退回修改",
};

export function contractStatusLabel(status: ContractStatus): string {
  return CONTRACT_STATUS_LABELS[status] ?? status;
}
