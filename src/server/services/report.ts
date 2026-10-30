import type { Prisma } from "@/generated/prisma/client";
import type { AccessContext } from "@/server/auth/access";
import { buildContractScope } from "@/server/auth/access";
import { prisma } from "@/server/db/client";
import { AppError, ERROR_CODES } from "@/shared/errors";

// 报表在应用层聚合，但样本有上限：超出即标记截断，避免把整库任务读进内存。
const SAMPLE_CAP = 5000;

export const REPORT_WINDOWS = [7, 30, 90] as const;

export type ReportWindow = (typeof REPORT_WINDOWS)[number];

export function isReportWindow(value: string | undefined): value is `${ReportWindow}` {
  return REPORT_WINDOWS.some((day) => String(day) === value);
}

export type NodeEfficiency = {
  key: string;
  flowName: string;
  flowCode: string;
  nodeName: string;
  taskCount: number;
  decidedCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  expiredCount: number;
  overdueCount: number;
  avgHours: number | null;
  medianHours: number | null;
  slowestHours: number | null;
  rejectRate: number | null;
  overdueRate: number | null;
};

export type EfficiencyReport = {
  from: Date;
  to: Date;
  windowDays: ReportWindow;
  sampleSize: number;
  truncated: boolean;
  totals: {
    taskCount: number;
    decidedCount: number;
    pendingCount: number;
    overdueCount: number;
    rejectedCount: number;
    avgHours: number | null;
    overdueRate: number | null;
    rejectRate: number | null;
  };
  nodes: NodeEfficiency[];
  flows: { flowName: string; flowCode: string; avgHours: number | null; taskCount: number }[];
};

type TaskSample = {
  status: string;
  activatedAt: Date | null;
  decidedAt: Date | null;
  dueAt: Date | null;
  nodeRun: { nodeName: string };
  instance: { flowVersion: { version: number }; flow: { name: string; code: string } };
};

function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 3_600_000;
}

function rate(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

function median(sorted: number[]): number | null {
  const n = sorted.length;
  if (n === 0) {
    return null;
  }
  const middle = Math.floor(n / 2);
  return n % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function isOverdue(task: TaskSample): boolean {
  if (task.status === "expired") {
    return true;
  }
  return task.dueAt !== null && task.decidedAt !== null && task.decidedAt > task.dueAt;
}

function summarize(nodes: NodeEfficiency[]): {
  taskCount: number;
  decidedCount: number;
  pendingCount: number;
  overdueCount: number;
  rejectedCount: number;
  avgHours: number | null;
  overdueRate: number | null;
  rejectRate: number | null;
} {
  const taskCount = nodes.reduce((sum, node) => sum + node.taskCount, 0);
  const decidedCount = nodes.reduce((sum, node) => sum + node.decidedCount, 0);
  const pendingCount = nodes.reduce((sum, node) => sum + node.pendingCount, 0);
  const overdueCount = nodes.reduce((sum, node) => sum + node.overdueCount, 0);
  const rejectedCount = nodes.reduce((sum, node) => sum + node.rejectedCount, 0);
  const durationSum = nodes.reduce(
    (sum, node) => sum + (node.avgHours === null ? 0 : node.avgHours * node.decidedCount),
    0,
  );
  return {
    taskCount,
    decidedCount,
    pendingCount,
    overdueCount,
    rejectedCount,
    avgHours: decidedCount === 0 ? null : durationSum / decidedCount,
    overdueRate: rate(overdueCount, decidedCount),
    rejectRate: rate(rejectedCount, decidedCount),
  };
}

type NodeAccumulator = {
  key: string;
  flowName: string;
  flowCode: string;
  nodeName: string;
  taskCount: number;
  decidedCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  expiredCount: number;
  overdueCount: number;
  durationSum: number;
  durations: number[];
};

function emptyAccumulator(task: TaskSample): NodeAccumulator {
  return {
    key: `${task.instance.flow.code}::${task.nodeRun.nodeName}`,
    flowName: task.instance.flow.name,
    flowCode: task.instance.flow.code,
    nodeName: task.nodeRun.nodeName,
    taskCount: 0,
    decidedCount: 0,
    pendingCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    expiredCount: 0,
    overdueCount: 0,
    durationSum: 0,
    durations: [],
  };
}

function toNodeEfficiency(node: NodeAccumulator): NodeEfficiency {
  const sorted = [...node.durations].sort((a, b) => a - b);
  return {
    key: node.key,
    flowName: node.flowName,
    flowCode: node.flowCode,
    nodeName: node.nodeName,
    taskCount: node.taskCount,
    decidedCount: node.decidedCount,
    pendingCount: node.pendingCount,
    approvedCount: node.approvedCount,
    rejectedCount: node.rejectedCount,
    expiredCount: node.expiredCount,
    overdueCount: node.overdueCount,
    avgHours: node.decidedCount === 0 ? null : node.durationSum / node.decidedCount,
    medianHours: median(sorted),
    slowestHours: sorted.length === 0 ? null : sorted[sorted.length - 1] ?? null,
    rejectRate: rate(node.rejectedCount, node.decidedCount),
    overdueRate: rate(node.overdueCount, node.decidedCount),
  };
}

export async function getEfficiencyReport(
  access: AccessContext,
  input: { windowDays: ReportWindow; flowId?: string; now?: Date },
): Promise<EfficiencyReport> {
  requireReportAccess(access);
  const now = input.now ?? new Date();
  const from = new Date(now.getTime() - input.windowDays * 86_400_000);
  const scope = await buildContractScope(access);

  const instanceWhere: Prisma.FlowInstanceWhereInput = {
    deletedAt: null,
    startedAt: { gte: from },
    contract: scope,
    ...(input.flowId ? { flowId: input.flowId } : {}),
  };

  const rows = await prisma.flowTask.findMany({
    where: {
      deletedAt: null,
      activatedAt: { not: null },
      instance: instanceWhere,
    },
    orderBy: { activatedAt: "desc" },
    take: SAMPLE_CAP,
    select: {
      status: true,
      activatedAt: true,
      decidedAt: true,
      dueAt: true,
      nodeRun: { select: { nodeName: true } },
      instance: {
        select: {
          flowVersion: { select: { version: true } },
          flow: { select: { name: true, code: true } },
        },
      },
    },
  });

  const buckets = new Map<string, NodeAccumulator>();
  for (const task of rows) {
    const bucket = buckets.get(taskKeyOf(task)) ?? emptyAccumulator(task);
    bucket.taskCount += 1;
    if (task.status === "pending") {
      bucket.pendingCount += 1;
    } else {
      bucket.decidedCount += 1;
      if (task.status === "approved") {
        bucket.approvedCount += 1;
      }
      if (task.status === "rejected") {
        bucket.rejectedCount += 1;
      }
      if (task.status === "expired") {
        bucket.expiredCount += 1;
      }
      if (isOverdue(task)) {
        bucket.overdueCount += 1;
      }
      if (task.activatedAt !== null && task.decidedAt !== null) {
        const hours = hoursBetween(task.activatedAt, task.decidedAt);
        if (hours >= 0) {
          bucket.durationSum += hours;
          bucket.durations.push(hours);
        }
      }
    }
    buckets.set(bucket.key, bucket);
  }

  const nodes = [...buckets.values()].map(toNodeEfficiency);
  nodes.sort((a, b) => b.taskCount - a.taskCount || a.flowCode.localeCompare(b.flowCode));

  const flowBuckets = new Map<string, { flowName: string; flowCode: string; durationSum: number; decidedCount: number; taskCount: number }>();
  for (const node of nodes) {
    const current = flowBuckets.get(node.flowCode) ?? {
      flowName: node.flowName,
      flowCode: node.flowCode,
      durationSum: 0,
      decidedCount: 0,
      taskCount: 0,
    };
    current.taskCount += node.taskCount;
    current.decidedCount += node.decidedCount;
    current.durationSum += node.avgHours === null ? 0 : node.avgHours * node.decidedCount;
    flowBuckets.set(node.flowCode, current);
  }

  return {
    from,
    to: now,
    windowDays: input.windowDays,
    sampleSize: rows.length,
    truncated: rows.length >= SAMPLE_CAP,
    totals: summarize(nodes),
    nodes,
    flows: [...flowBuckets.values()]
      .map((flow) => ({
        flowName: flow.flowName,
        flowCode: flow.flowCode,
        taskCount: flow.taskCount,
        avgHours: flow.decidedCount === 0 ? null : flow.durationSum / flow.decidedCount,
      }))
      .sort((a, b) => b.taskCount - a.taskCount),
  };
}

function taskKeyOf(task: TaskSample): string {
  return `${task.instance.flow.code}::${task.nodeRun.nodeName}`;
}

function requireReportAccess(access: AccessContext): void {
  if (!access.permissions.has("report.read")) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "没有查看报表的权限");
  }
}

export async function listReportFlowOptions(access: AccessContext): Promise<
  { id: string; name: string; code: string }[]
> {
  requireReportAccess(access);
  const flows = await prisma.approvalFlow.findMany({
    where: { deletedAt: null, latestVersion: { gt: 0 } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true },
  });
  return flows;
}
