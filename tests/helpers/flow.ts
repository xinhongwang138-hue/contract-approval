import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import {
  createTestDepartment,
  createTestParty,
  createTestTemplate,
  createTestUser,
  ensureContractType,
  ensureTestDepartment,
  uniqueSuffix,
} from "./fixtures";
import { deleteAsOwner } from "./db";

export type FlowWorld = {
  suffix: string;
  initiatorId: string;
  leaderId: string;
  bossId: string;
  approverIds: string[];
  templateId: string;
  templateCode: string;
  typeId: string;
  partyAId: string;
  partyBId: string;
  createContract: (input?: {
    amount?: string;
    formValues?: Record<string, unknown>;
    status?: "draft" | "rejected";
  }) => Promise<string>;
  createFlow: (definition: unknown) => Promise<{ flowId: string; flowVersionId: string }>;
  publishVersion: (flowId: string, definition: unknown, version: number) => Promise<string>;
};

export async function prepareFlowWorld(userKeys: string[]): Promise<FlowWorld> {
  const suffix = uniqueSuffix();
  const slug = suffix.toLowerCase();

  const hq = await ensureTestDepartment();
  const boss = await createTestUser({
    name: "FLOW老板",
    email: `flow-boss-${slug}@test.local`,
    roleKey: "admin",
    departmentId: hq.id,
  });
  const leader = await createTestUser({
    name: "FLOW主管",
    email: `flow-leader-${slug}@test.local`,
    roleKey: "manager",
    departmentId: hq.id,
  });
  const sub = await createTestDepartment({
    name: `FLOW部门${suffix}`,
    path: `/test-hq/flow-${slug}`,
    parentId: hq.id,
    managerUserId: leader.id,
  });
  await createTestDepartment({
    name: "测试总部",
    path: hq.path,
    managerUserId: boss.id,
  });

  const initiator = await createTestUser({
    name: "FLOW发起人",
    email: `flow-initiator-${slug}@test.local`,
    roleKey: "employee",
    departmentId: sub.id,
    managerUserId: leader.id,
  });

  const approverIds: string[] = [];
  for (const key of userKeys) {
    const user = await createTestUser({
      name: `FLOW审批人-${key}`,
      email: `flow-${key}-${slug}@test.local`,
      roleKey: "manager",
      departmentId: hq.id,
    });
    await prisma.userRole.updateMany({ where: { userId: user.id }, data: { deletedAt: null } });
    approverIds.push(user.id);
  }

  const partyA = await createTestParty(`FLOW甲方${suffix}`);
  const partyB = await createTestParty(`FLOW乙方${suffix}`, "supplier");
  const type = await ensureContractType(`flow_type_${slug}`, "FLOW测试类型");
  const template = await createTestTemplate({
    code: `F${suffix}`,
    name: "FLOW测试模板",
    fields: [{ key: "contact", label: "联系人", type: "text", required: false }],
  });

  let sequence = 0;
  let flowSequence = 0;

  return {
    suffix,
    initiatorId: initiator.id,
    leaderId: leader.id,
    bossId: boss.id,
    approverIds,
    templateId: template.id,
    templateCode: template.code,
    typeId: type.id,
    partyAId: partyA.id,
    partyBId: partyB.id,

    async createContract(input = {}) {
      sequence += 1;
      const ym = "202610";
      const contract = await prisma.contract.create({
        data: {
          no: `HT-F${suffix}-${ym}-${String(sequence).padStart(4, "0")}`,
          title: `FLOW合同${suffix}-${sequence}`,
          templateId: template.id,
          typeId: type.id,
          partyAId: partyA.id,
          partyBId: partyB.id,
          amount: input.amount ?? "100000.00",
          currency: "CNY",
          signDate: new Date("2026-10-15T00:00:00.000Z"),
          startDate: new Date("2026-10-20T00:00:00.000Z"),
          endDate: new Date("2027-10-19T00:00:00.000Z"),
          status: input.status ?? "draft",
          formData: (input.formValues ?? {}) as Prisma.InputJsonValue,
          ownerDepartmentId: sub.id,
          createdBy: initiator.id,
        },
        select: { id: true },
      });
      await prisma.contractVersion.create({
        data: {
          contractId: contract.id,
          version: 1,
          bodyMarkdown: "FLOW 正文",
          changeSummary: "初始版本",
          createdBy: initiator.id,
        },
      });
      return contract.id;
    },

    async createFlow(definition) {
      flowSequence += 1;
      const flow = await prisma.approvalFlow.create({
        data: {
          name: `FLOW流程${suffix}`,
          code: `FLOW_${suffix}_${flowSequence}`,
          category: "测试",
          draftDefinition: definition as Prisma.InputJsonValue,
          latestVersion: 1,
        },
        select: { id: true },
      });
      const version = await prisma.approvalFlowVersion.create({
        data: {
          flowId: flow.id,
          version: 1,
          definition: definition as Prisma.InputJsonValue,
          publishedBy: initiator.id,
          status: "active",
        },
        select: { id: true },
      });
      return { flowId: flow.id, flowVersionId: version.id };
    },

    async publishVersion(flowId, definition, version) {
      const row = await prisma.approvalFlowVersion.create({
        data: {
          flowId,
          version,
          definition: definition as Prisma.InputJsonValue,
          publishedBy: initiator.id,
          status: "active",
        },
        select: { id: true },
      });
      await prisma.approvalFlowVersion.updateMany({
        where: { flowId, version: { lt: version } },
        data: { status: "archived" },
      });
      await prisma.approvalFlow.update({
        where: { id: flowId },
        data: { latestVersion: version },
      });
      return row.id;
    },
  };
}

export function contractContext(contract: {
  id: string;
  no: string;
  amount: number;
  category?: string;
}) {
  return {
    contract: {
      id: contract.id,
      no: contract.no,
      amount: contract.amount,
      category: contract.category ?? "sales",
      days: 10,
      signDate: "2026-10-15",
    },
    form: { contact: "张三" },
    initiator: { departmentId: "dept-1", managerUserId: "" },
  };
}

export async function resetFlowData(): Promise<void> {
  await deleteAsOwner('DELETE FROM "FlowEventLog"');
  await prisma.notification.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.flowTask.deleteMany();
  await prisma.flowNodeRun.deleteMany();
  await prisma.flowInstance.deleteMany();
  await prisma.approvalFlowVersion.deleteMany();
  await prisma.approvalFlow.deleteMany();
  await prisma.contractParticipant.deleteMany();
  await prisma.contractMilestone.deleteMany();
  await prisma.sealRecord.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.contractVersion.deleteMany();
  await prisma.contract.deleteMany();
}
