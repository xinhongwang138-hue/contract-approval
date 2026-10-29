import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAccessContext } from "@/server/auth/access";
import { prisma } from "@/server/db/client";
import { decideTask } from "@/server/flow/engine";
import {
  getApprovalDetail,
  getContractTimeline,
} from "@/server/services/approval-view";
import {
  getWorkbench,
  previewContractFlow,
  submitContract,
} from "@/server/services/approval";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/server/services/notification";
import { setTemplateFlow } from "@/server/services/flow";
import { parseShanghaiDate } from "@/shared/datetime";
import { prepareFlowWorld, resetFlowData, type FlowWorld } from "../helpers/flow";

let world: FlowWorld;

function approval(
  id: string,
  assigneeIds: string[],
  next: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    type: "approval",
    name: `${id}审批`,
    assignee: { kind: "user", ids: assigneeIds },
    mode: "any",
    next,
    ...extra,
  };
}

function definition(nodes: Record<string, unknown>[]): Record<string, unknown> {
  return { schemaVersion: 1, entry: "start", nodes };
}

async function bindFlow(def: Record<string, unknown>): Promise<void> {
  const { flowId, flowVersionId } = await world.createFlow(def);
  await prisma.approvalFlowVersion.update({
    where: { id: flowVersionId },
    data: { status: "active" },
  });
  await prisma.approvalFlow.update({
    where: { id: flowId },
    data: { latestVersion: 1 },
  });
  await setTemplateFlow(world.templateId, flowId, world.initiatorId);
}

async function submit(contractId: string): Promise<string> {
  const access = await getAccessContext(world.initiatorId);
  const result = await submitContract(access, contractId);
  return result.instanceId;
}

beforeAll(async () => {
  world = await prepareFlowWorld(["p1", "p2", "p3"]);
});

beforeEach(async () => {
  await resetFlowData();
});

describe("workbench todo ownership", () => {
  it("shows the task only to its assignee until it is decided", async () => {
    const approver = world.approverIds[0]!;
    const other = world.approverIds[1]!;
    const contractId = await world.createContract();
    await bindFlow(
      definition([
        { id: "start", type: "start", name: "发起", next: "legal" },
        approval("legal", [approver], "end"),
        { id: "end", type: "end", name: "结束", result: "approved" },
      ]),
    );

    const instanceId = await submit(contractId);

    const approverAccess = await getAccessContext(approver);
    const otherAccess = await getAccessContext(other);
    const initiatorAccess = await getAccessContext(world.initiatorId);

    const mine = await getWorkbench(approverAccess);
    expect(mine.counts.pending).toBe(1);
    expect(mine.pending[0]?.instanceId).toBe(instanceId);
    expect(mine.pending[0]?.contractId).toBe(contractId);

    expect((await getWorkbench(otherAccess)).counts.pending).toBe(0);

    const initiated = await getWorkbench(initiatorAccess);
    expect(initiated.counts.initiated).toBe(1);
    expect(initiated.initiated[0]?.currentNodeNames).toEqual(["legal审批"]);

    await prisma.$transaction((tx) =>
      decideTask(tx, { taskId: mine.pending[0]!.taskId, actorId: approver, action: "approve" }),
    );
    expect((await getWorkbench(approverAccess)).counts.pending).toBe(0);
  });

  it("surfaces delegated tasks and records the real operator", async () => {
    const principal = world.approverIds[0]!;
    const delegatee = world.approverIds[1]!;
    const contractId = await world.createContract();
    await bindFlow(
      definition([
        { id: "start", type: "start", name: "发起", next: "legal" },
        approval("legal", [principal], "end"),
        { id: "end", type: "end", name: "结束", result: "approved" },
      ]),
    );
    const instanceId = await submit(contractId);

    const delegateeAccess = await getAccessContext(delegatee);
    expect((await getWorkbench(delegateeAccess)).counts.pending).toBe(0);

    await prisma.delegate.create({
      data: {
        fromUserId: principal,
        toUserId: delegatee,
        permissionKeys: ["contract.approve"],
        startAt: parseShanghaiDate("2020-01-01"),
        endAt: parseShanghaiDate("2099-12-31", true),
        reason: "年假代审",
      },
    });

    const delegated = await getWorkbench(delegateeAccess);
    expect(delegated.counts.pending).toBe(1);
    expect(delegated.pending[0]?.delegated).toBe(true);

    const taskId = delegated.pending[0]!.taskId;
    await prisma.$transaction((tx) =>
      decideTask(tx, {
        taskId,
        actorId: principal,
        operatorId: delegatee,
        action: "approve",
        opinion: "代委托人同意",
      }),
    );

    const task = await prisma.flowTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe("approved");
    expect(task.assigneeId).toBe(principal);
    expect(task.decidedBy).toBe(delegatee);

    const event = await prisma.flowEventLog.findFirst({
      where: { taskId, action: "task.approve" },
    });
    expect(event?.actorId).toBe(delegatee);

    const detail = await getApprovalDetail(delegateeAccess, instanceId);
    expect(detail.myTask?.actedAs).not.toBeNull();
  });

  it("ignores delegations outside their window or without the approve key", async () => {
    const principal = world.approverIds[0]!;
    const delegatee = world.approverIds[1]!;
    const contractId = await world.createContract();
    await bindFlow(
      definition([
        { id: "start", type: "start", name: "发起", next: "legal" },
        approval("legal", [principal], "end"),
        { id: "end", type: "end", name: "结束", result: "approved" },
      ]),
    );
    await submit(contractId);

    await prisma.delegate.create({
      data: {
        fromUserId: principal,
        toUserId: delegatee,
        permissionKeys: ["contract.read"],
        startAt: parseShanghaiDate("2020-01-01"),
        endAt: parseShanghaiDate("2099-12-31", true),
        reason: "只给了查看权限",
      },
    });
    await prisma.delegate.create({
      data: {
        fromUserId: principal,
        toUserId: world.approverIds[2]!,
        permissionKeys: ["contract.approve"],
        startAt: parseShanghaiDate("2020-01-01"),
        endAt: parseShanghaiDate("2020-01-31", true),
        reason: "已过期",
      },
    });

    expect(
      (await getWorkbench(await getAccessContext(delegatee))).counts.pending,
    ).toBe(0);
  });
});

describe("approval detail visibility", () => {
  it("restricts fields, body and attachments to the node whitelist", async () => {
    const approver = world.approverIds[0]!;
    const contractId = await world.createContract({
      formValues: { contact: "李四" },
    });
    await prisma.attachment.create({
      data: {
        contractId,
        kind: "appendix",
        storageKey: `${"0".repeat(36)}.pdf`,
        sha256: "a".repeat(64),
        name: "内部附件.pdf",
        mime: "application/pdf",
        size: 10,
        uploadedBy: world.initiatorId,
      },
    });
    await bindFlow(
      definition([
        { id: "start", type: "start", name: "发起", next: "legal" },
        approval("legal", [approver], "end", { visibleFieldKeys: ["amount"] }),
        { id: "end", type: "end", name: "结束", result: "approved" },
      ]),
    );
    const instanceId = await submit(contractId);

    const detail = await getApprovalDetail(
      await getAccessContext(approver),
      instanceId,
    );
    expect(detail.fieldsRestricted).toBe(true);
    expect(detail.formEntries).toEqual([]);
    expect(detail.bodyMarkdown).toBeNull();
    expect(detail.attachments).toEqual([]);
    expect(detail.contract.partyBName).toBeTruthy();

    const unrestricted = definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", [approver], "end"),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]);
    const secondContract = await world.createContract({ formValues: { contact: "王五" } });
    await bindFlow(unrestricted);
    const secondInstance = await submit(secondContract);
    const secondDetail = await getApprovalDetail(
      await getAccessContext(approver),
      secondInstance,
    );
    expect(secondDetail.fieldsRestricted).toBe(false);
    expect(secondDetail.formEntries.map((entry) => entry.value)).toContain("王五");
    expect(secondDetail.bodyMarkdown).toContain("FLOW 正文");
  });

  it("keeps the trail and timeline readable for the initiator", async () => {
    const approver = world.approverIds[0]!;
    const contractId = await world.createContract();
    await bindFlow(
      definition([
        { id: "start", type: "start", name: "发起", next: "legal" },
        approval("legal", [approver], "gm"),
        approval("gm", [world.bossId], "end"),
        { id: "end", type: "end", name: "结束", result: "approved" },
      ]),
    );
    const instanceId = await submit(contractId);

    const task = await prisma.flowTask.findFirstOrThrow({ where: { instanceId } });
    await prisma.$transaction((tx) =>
      decideTask(tx, { taskId: task.id, actorId: approver, action: "approve", opinion: "条款没问题" }),
    );

    const initiatorAccess = await getAccessContext(world.initiatorId);
    const detail = await getApprovalDetail(initiatorAccess, instanceId);
    expect(detail.myTask).toBeNull();
    expect(detail.canWithdraw).toBe(false);
    expect(detail.trail.map((entry) => entry.nodeName)).toEqual([
      "发起",
      "legal审批",
      "gm审批",
    ]);
    const legalEntry = detail.trail.find((entry) => entry.nodeName === "legal审批");
    expect(legalEntry?.status).toBe("approved");
    expect(legalEntry?.tasks[0]?.opinion).toBe("条款没问题");
    const gmEntry = detail.trail.find((entry) => entry.nodeName === "gm审批");
    expect(gmEntry?.tasks[0]?.assigneeId).toBe(world.bossId);

    const timeline = await getContractTimeline(initiatorAccess, contractId);
    expect(timeline.instances).toHaveLength(1);
    expect(timeline.instances[0]?.trail).toHaveLength(3);
  });

  it("refuses the detail page for out-of-scope users", async () => {
    const approver = world.approverIds[0]!;
    const contractId = await world.createContract();
    await bindFlow(
      definition([
        { id: "start", type: "start", name: "发起", next: "legal" },
        approval("legal", [approver], "end"),
        { id: "end", type: "end", name: "结束", result: "approved" },
      ]),
    );
    const instanceId = await submit(contractId);

    const outsider = await prisma.user.create({
      data: {
        name: "越权访客",
        email: `flow-peek-${world.suffix.toLowerCase()}@test.local`,
        emailVerified: true,
        status: "active",
      },
      select: { id: true },
    });
    const employeeRole = await prisma.role.findUniqueOrThrow({ where: { key: "employee" } });
    await prisma.userRole.create({ data: { userId: outsider.id, roleId: employeeRole.id } });

    await expect(
      getApprovalDetail(await getAccessContext(outsider.id), instanceId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("notifications", () => {
  it("lists, filters and marks notifications read", async () => {
    const approver = world.approverIds[0]!;
    const contractId = await world.createContract();
    await bindFlow(
      definition([
        { id: "start", type: "start", name: "发起", next: "legal" },
        approval("legal", [approver], "end"),
        { id: "end", type: "end", name: "结束", result: "approved" },
      ]),
    );
    const instanceId = await submit(contractId);

    const first = await listNotifications(approver, {
      page: 1,
      pageSize: 20,
      unreadOnly: false,
    });
    expect(first.unread).toBe(1);
    expect(first.items[0]?.kind).toBe("task");
    expect(first.items[0]?.link).toBe(`/approvals/${instanceId}`);

    await markNotificationRead(approver, first.items[0]!.id);
    const afterRead = await listNotifications(approver, {
      page: 1,
      pageSize: 20,
      unreadOnly: true,
    });
    expect(afterRead.total).toBe(0);

    const task = await prisma.flowTask.findFirstOrThrow({ where: { instanceId } });
    await prisma.$transaction((tx) =>
      decideTask(tx, { taskId: task.id, actorId: approver, action: "approve" }),
    );
    const flowNotified = await listNotifications(world.initiatorId, {
      page: 1,
      pageSize: 20,
      unreadOnly: false,
    });
    expect(flowNotified.items.some((item) => item.kind === "flow")).toBe(true);

    await markAllNotificationsRead(world.initiatorId);
    expect(
      (await listNotifications(world.initiatorId, { page: 1, pageSize: 20, unreadOnly: true }))
        .total,
    ).toBe(0);
  });
});

describe("submission preview", () => {
  it("marks nodes that resolve at runtime", async () => {
    const contractId = await world.createContract();
    await bindFlow(
      definition([
        { id: "start", type: "start", name: "发起", next: "leader" },
        {
          id: "leader",
          type: "approval",
          name: "主管审批",
          assignee: { kind: "dept_manager", level: 1 },
          mode: "any",
          next: "end",
        },
        { id: "end", type: "end", name: "结束", result: "approved" },
      ]),
    );

    const access = await getAccessContext(world.initiatorId);
    const { preview } = await previewContractFlow(access, contractId);
    expect(preview.blocking).toEqual([]);
    expect(preview.nodes[0]?.dynamic).toBe(true);
    expect(preview.nodes[0]?.assigneeIds).toEqual([world.leaderId]);
  });
});
