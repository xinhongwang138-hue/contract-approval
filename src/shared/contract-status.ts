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

// 规格 4.4 第 6 条要求驳回后发起人可改后再提；状态表里 rejected 是终态前的可改窗口，
// 因此草稿与被驳回的合同都开放编辑，不额外引入 rejected -> draft 迁移。
export const EDITABLE_CONTRACT_STATUSES: readonly ContractStatus[] = [
  "draft",
  "rejected",
];

export function isEditableContractStatus(status: ContractStatus): boolean {
  return EDITABLE_CONTRACT_STATUSES.includes(status);
}

export function contractStatusLabel(status: ContractStatus): string {
  return CONTRACT_STATUS_LABELS[status] ?? status;
}
