import type { ContractStatus } from "./state-machines";

export const SEAL_TYPES = ["company", "contract", "finance", "legal"] as const;
export type SealType = (typeof SEAL_TYPES)[number];

export const SEAL_TYPE_LABELS: Record<SealType, string> = {
  company: "公章",
  contract: "合同专用章",
  finance: "财务章",
  legal: "法人章",
};

export const SEAL_STATES = ["pending_pick", "pending_return", "returned"] as const;
export type SealState = (typeof SEAL_STATES)[number];

export const SEAL_STATE_LABELS: Record<SealState, string> = {
  pending_pick: "待取件",
  pending_return: "已取件待归还",
  returned: "已归还",
};

export function sealStateOf(record: {
  pickedAt: Date | null;
  returnedAt: Date | null;
}): SealState {
  if (record.returnedAt !== null) {
    return "returned";
  }
  return record.pickedAt === null ? "pending_pick" : "pending_return";
}

export const MILESTONE_KIND_LABELS: Record<string, string> = {
  sealed: "已用印",
  effective: "已生效",
  paid: "已付款",
  expired: "已到期",
  archived: "已归档",
  terminated: "已终止",
  expiry_warning: "到期预警",
};

// 状态机里只有这四个状态能直接迁到 archived
export const ARCHIVABLE_CONTRACT_STATUSES: readonly ContractStatus[] = [
  "active",
  "amended",
  "expired",
  "terminated",
];

export function isArchivableContractStatus(status: ContractStatus): boolean {
  return ARCHIVABLE_CONTRACT_STATUSES.includes(status);
}
