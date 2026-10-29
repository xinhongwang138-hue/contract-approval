import { IllegalTransitionError } from "./errors";

export const CONTRACT_STATUSES = [
  "draft",
  "pending",
  "approving",
  "approved",
  "to_seal",
  "sealed",
  "active",
  "rejected",
  "withdrawn",
  "amended",
  "expired",
  "terminated",
  "archived",
] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const FLOW_STATUSES = [
  "running",
  "approved",
  "rejected",
  "withdrawn",
  "terminated",
  "cancelled",
] as const;

export type FlowStatus = (typeof FLOW_STATUSES)[number];

export const NODE_RUN_STATUSES = [
  "pending",
  "running",
  "waiting_join",
  "approved",
  "rejected",
  "skipped",
  "cancelled",
] as const;

export type NodeRunStatus = (typeof NODE_RUN_STATUSES)[number];

export const TASK_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "transferred",
  "cancelled",
  "expired",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type StateMachine<T extends string> = Record<T, readonly T[]>;

export const CONTRACT_TRANSITIONS: StateMachine<ContractStatus> = {
  draft: ["pending"],
  pending: ["approving", "withdrawn"],
  approving: ["approved", "rejected", "withdrawn"],
  approved: ["to_seal"],
  to_seal: ["sealed"],
  sealed: ["active"],
  active: ["amended", "expired", "terminated", "archived"],
  rejected: ["pending"],
  withdrawn: ["draft"],
  amended: ["archived"],
  expired: ["archived"],
  terminated: ["archived"],
  archived: [],
};

export const FLOW_TRANSITIONS: StateMachine<FlowStatus> = {
  running: ["approved", "rejected", "withdrawn", "terminated", "cancelled"],
  approved: [],
  rejected: [],
  withdrawn: [],
  terminated: [],
  cancelled: [],
};

export const NODE_RUN_TRANSITIONS: StateMachine<NodeRunStatus> = {
  pending: ["running", "skipped", "cancelled"],
  running: ["waiting_join", "approved", "rejected", "skipped", "cancelled"],
  waiting_join: ["approved", "skipped", "cancelled"],
  approved: [],
  rejected: [],
  skipped: [],
  cancelled: [],
};

export const TASK_TRANSITIONS: StateMachine<TaskStatus> = {
  pending: ["approved", "rejected", "transferred", "cancelled", "expired"],
  approved: [],
  rejected: [],
  transferred: [],
  cancelled: [],
  expired: [],
};

export function canTransition<T extends string>(
  machine: StateMachine<T>,
  from: T,
  to: T,
): boolean {
  return machine[from].includes(to);
}

export function assertTransition<T extends string>(
  machineName: string,
  machine: StateMachine<T>,
  from: T,
  to: T,
): void {
  if (!canTransition(machine, from, to)) {
    throw new IllegalTransitionError(machineName, from, to);
  }
}
