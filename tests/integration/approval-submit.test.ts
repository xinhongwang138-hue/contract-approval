import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAccessContext } from "@/server/auth/access";
import { prisma } from "@/server/db/client";
import { previewContractFlow, submitContract } from "@/server/services/approval";
import { setTemplateFlow } from "@/server/services/flow";
import { prepareFlowWorld, resetFlowData, type FlowWorld } from "../helpers/flow";

let world: FlowWorld;

function linear(roleKey: string, next = "end") {
  return {
    schemaVersion: 1,
    entry: "start",
    nodes: [
      { id: "start", type: "start", name: "发起", next: "legal" },
      {
        id: "legal",
        type: "approval",
        name: "法务审核",
        assignee: { kind: "role", key: roleKey },
        mode: "any",
        next,
      },
      { id: "end", type: "end", name: "结束", result: "approved" },
    ],
  };
}

async function publishFlow(definition: Record<string, unknown>): Promise<string> {
  const { flowId, flowVersionId } = await world.createFlow(definition);
  await prisma.approvalFlowVersion.update({
    where: { id: flowVersionId },
    data: { status: "active" },
  });
  await prisma.approvalFlow.update({
    where: { id: flowId },
    data: { latestVersion: 1 },
  });
  return flowId;
}

beforeAll(async () => {
  world = await prepareFlowWorld(["s1", "s2", "s3"]);
});

beforeEach(async () => {
  await resetFlowData();
});

describe("contract submission", () => {
  it("refuses to submit when the template has no flow", async () => {
    const access = await getAccessContext(world.initiatorId);
    const contractId = await world.createContract();

    await expect(previewContractFlow(access, contractId)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(submitContract(access, contractId)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("refuses to submit when the flow has no published version", async () => {
    const access = await getAccessContext(world.initiatorId);
    const contractId = await world.createContract();
    const created = await prisma.approvalFlow.create({
      data: {
        name: "未发布流程",
        code: `FLOW_UNPUB_${world.suffix}`,
        category: "测试",
        draftDefinition: linear("manager"),
      },
      select: { id: true },
    });
    // 绕过绑定校验，模拟流程发布后被撤回版本的异常状态。
    await prisma.contractTemplate.update({
      where: { id: world.templateId },
      data: { flowId: created.id },
    });

    await expect(
      submitContract(access, contractId),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      setTemplateFlow(world.templateId, created.id, world.initiatorId),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("previews the resolved approvers and starts the instance on submit", async () => {
    const access = await getAccessContext(world.initiatorId);
    const contractId = await world.createContract();
    const roleKey = `flow_role_${world.suffix.toLowerCase()}`;
    await prisma.role.create({ data: { key: roleKey, name: "提交测试角色" } });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    for (const userId of world.approverIds.slice(0, 2)) {
      await prisma.userRole.create({ data: { userId, roleId: role.id } });
    }

    const flowId = await publishFlow(linear(roleKey));
    await setTemplateFlow(world.templateId, flowId, world.initiatorId);

    const { preview, contract } = await previewContractFlow(access, contractId);
    expect(preview.blocking).toEqual([]);
    expect(preview.nodes).toHaveLength(1);
    expect(preview.nodes[0]?.assigneeIds.sort()).toEqual(
      world.approverIds.slice(0, 2).sort(),
    );
    expect(contract.status).toBe("draft");

    const result = await submitContract(access, contractId);

    const row = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(row.status).toBe("approving");
    expect(row.currentFlowInstanceId).toBe(result.instanceId);

    const instance = await prisma.flowInstance.findUniqueOrThrow({
      where: { id: result.instanceId },
    });
    expect(instance.flowVersionId).not.toBeNull();
    expect(JSON.stringify(instance.definitionSnapshot)).toContain(roleKey);

    const tasks = await prisma.flowTask.findMany({ where: { instanceId: result.instanceId } });
    expect(tasks).toHaveLength(2);
    expect(tasks.every((task) => task.status === "pending" && task.activatedAt)).toBe(true);

    const participants = await prisma.contractParticipant.findMany({
      where: { contractId, kind: "approver" },
    });
    expect(participants).toHaveLength(2);

    const audit = await prisma.auditLog.findFirst({
      where: { entity: "Contract", entityId: contractId, action: "contract.submit" },
    });
    expect(audit?.after).toMatchObject({ status: "approving" });

    await prisma.contract.update({ where: { id: contractId }, data: { status: "approving" } });
    await expect(submitContract(access, contractId)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("blocks submit when a node resolves to nobody", async () => {
    const access = await getAccessContext(world.initiatorId);
    const contractId = await world.createContract();
    const emptyRole = `flow_nobody_${world.suffix.toLowerCase()}`;
    await prisma.role.create({ data: { key: emptyRole, name: "空角色" } });

    const flowId = await publishFlow(linear(emptyRole));
    await setTemplateFlow(world.templateId, flowId, world.initiatorId);

    const { preview } = await previewContractFlow(access, contractId);
    expect(preview.blocking.join()).toContain("解析不到审批人");

    await expect(submitContract(access, contractId)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(row.status).toBe("draft");
    expect(await prisma.flowInstance.count()).toBe(0);
  });

  it("lets the initiator resubmit a rejected contract as a new instance", async () => {
    const access = await getAccessContext(world.initiatorId);
    const contractId = await world.createContract();
    const roleKey = `flow_resub_${world.suffix.toLowerCase()}`;
    await prisma.role.create({ data: { key: roleKey, name: "重提角色" } });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await prisma.userRole.create({
      data: { userId: world.approverIds[0]!, roleId: role.id },
    });
    const flowId = await publishFlow(linear(roleKey));
    await setTemplateFlow(world.templateId, flowId, world.initiatorId);

    const first = await submitContract(access, contractId);
    await prisma.contract.update({
      where: { id: contractId },
      data: { status: "rejected", stage: "returned" },
    });
    await prisma.flowInstance.update({
      where: { id: first.instanceId },
      data: { status: "rejected", finishedAt: new Date() },
    });

    const second = await submitContract(access, contractId);
    expect(second.instanceId).not.toBe(first.instanceId);

    const instances = await prisma.flowInstance.findMany({ where: { contractId } });
    expect(instances).toHaveLength(2);
    const kept = instances.find((item) => item.id === first.instanceId);
    expect(kept?.status).toBe("rejected");
  });

  it("rejects submitters outside the data scope", async () => {
    const contractId = await world.createContract();
    const roleKey = `flow_scope_${world.suffix.toLowerCase()}`;
    await prisma.role.create({ data: { key: roleKey, name: "范围角色" } });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await prisma.userRole.create({
      data: { userId: world.approverIds[0]!, roleId: role.id },
    });
    const flowId = await publishFlow(linear(roleKey));
    await setTemplateFlow(world.templateId, flowId, world.initiatorId);

    const outsider = await prisma.user.create({
      data: {
        name: "无关员工",
        email: `flow-outsider-${world.suffix.toLowerCase()}@test.local`,
        emailVerified: true,
        status: "active",
      },
      select: { id: true },
    });
    const employeeRole = await prisma.role.findUniqueOrThrow({ where: { key: "employee" } });
    await prisma.userRole.create({ data: { userId: outsider.id, roleId: employeeRole.id } });

    const outsiderAccess = await getAccessContext(outsider.id);
    await expect(
      submitContract(outsiderAccess, contractId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
