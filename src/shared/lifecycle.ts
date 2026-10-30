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

/**
 * 台账里给到期日上色的档位。阈值与到期预警 worker 共用同一个环境变量，
 * 只对在履行期内的合同生效（草稿、已归档、已终止的合同谈不上"快到期"）。
 */
export function expiryTone(
  status: ContractStatus,
  endDate: Date,
  today: Date,
  warningDays: readonly number[],
): "expired" | "urgent" | "soon" | null {
  if (status !== "active" && status !== "amended") {
    return null;
  }
  const thresholds = warningDays.filter((days) => days > 0);
  if (thresholds.length === 0) {
    return null;
  }
  const daysLeft = Math.ceil((endDate.getTime() - today.getTime()) / 86_400_000);
  if (daysLeft < 0) {
    return "expired";
  }
  if (daysLeft <= Math.min(...thresholds)) {
    return "urgent";
  }
  if (daysLeft <= Math.max(...thresholds)) {
    return "soon";
  }
  return null;
}
