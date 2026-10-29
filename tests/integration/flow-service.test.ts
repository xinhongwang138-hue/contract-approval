import { beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import {
  createFlow,
  deleteFlow,
  getFlow,
  listFlowVersions,
  publishFlow,
  saveFlowDraft,
  setTemplateFlow,
  updateFlow,
} from "@/server/services/flow";
import {
  createTestUser,
  ensureTestDepartment,
  prepareDatabase,
  uniqueSuffix,
} from "../helpers/fixtures";

const suffix = uniqueSuffix();
const slug = suffix.toLowerCase();

let actorId = "";
let memberId = "";
let emptyRoleKey = "";
let staffRoleKey = "";

function definition(nodes: Record<string, unknown>[], entry = "start") {
  return { schemaVersion: 1, entry, nodes };
}

function approval(
  id: string,
  assignee: Record<string, unknown>,
  next: string | string[],
): Record<string, unknown> {
  return { id, type: "approval", name: `${id}审批`, assignee, next };
}

function linear(roleKey: string, next = "end") {
  return definition([
    { id: "start", type: "start", name: "发起", next: "legal" },
    approval("legal", { kind: "role", key: roleKey }, next),
    { id: "end", type: "end", name: "结束", result: "approved" },
  ]);
}

async function createRole(key: string): Promise<void> {
  await prisma.role.create({ data: { key, name: `测试角色${key}`, isSystem: false } });
}

beforeAll(async () => {
  await prepareDatabase();

  const department = await ensureTestDepartment();
  actorId = (
    await createTestUser({
      name: "流程管理员",
      email: `flow-admin-${slug}@test.local`,
      roleKey: "admin",
      departmentId: department.id,
    })
  ).id;
  memberId = (
    await createTestUser({
      name: "流程成员",
      email: `flow-member-${slug}@test.local`,
      roleKey: "employee",
      departmentId: department.id,
    })
  ).id;

  emptyRoleKey = `flow_empty_${slug}`;
  staffRoleKey = `flow_staff_${slug}`;
  await createRole(emptyRoleKey);
  await createRole(staffRoleKey);

  const staffRole = await prisma.role.findUniqueOrThrow({ where: { key: staffRoleKey } });
  await prisma.userRole.create({ data: { userId: memberId, roleId: staffRole.id } });
});

describe("flow draft and publish", () => {
  it("creates a flow with a valid starter definition", async () => {
    const created = await createFlow(
      { code: `FLOW_STARTER_${slug}`, name: "起始流程", category: "通用" },
      actorId,
    );

    const detail = await getFlow(created.id);
    expect(detail.latestVersion).toBe(0);
    expect(detail.draftIssues).toEqual([]);
    expect(detail.draftDefinition).toMatchObject({ entry: "start" });
  });

  it("saves an incomplete draft but refuses to publish it", async () => {
    const created = await createFlow(
      { code: `FLOW_INCOMPLETE_${slug}`, name: "未完成流程", category: "通用" },
      actorId,
    );

    const broken = definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", { kind: "role", key: staffRoleKey }, "ghost"),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]);
    const saved = await saveFlowDraft({ id: created.id, definition: broken }, actorId);
    expect(saved.issues.map((issue) => issue.code)).toContain("UNKNOWN_TARGET");

    await expect(publishFlow(created.id, actorId)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    const detail = await getFlow(created.id);
    expect(detail.latestVersion).toBe(0);
  });

  it("blocks publishing a node whose role has no active member", async () => {
    const created = await createFlow(
      { code: `FLOW_EMPTY_${slug}`, name: "空审批人流程", category: "通用" },
      actorId,
    );
    await saveFlowDraft(
      { id: created.id, definition: linear(emptyRoleKey) },
      actorId,
    );

    await expect(publishFlow(created.id, actorId)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });

    const versions = await listFlowVersions(created.id);
    expect(versions).toHaveLength(0);
  });

  it("keeps published versions immutable while the draft keeps changing", async () => {
    const created = await createFlow(
      { code: `FLOW_VERSIONS_${slug}`, name: "版本流程", category: "通用" },
      actorId,
    );
    await saveFlowDraft({ id: created.id, definition: linear(staffRoleKey) }, actorId);

    const first = await publishFlow(created.id, actorId);
    expect(first.version).toBe(1);
    const firstRow = await prisma.approvalFlowVersion.findFirstOrThrow({
      where: { flowId: created.id, version: 1 },
    });

    const secondDefinition = definition([
      { id: "start", type: "start", name: "发起", next: "legal" },
      approval("legal", { kind: "role", key: staffRoleKey }, "gm"),
      approval("gm", { kind: "user", ids: [memberId] }, "end"),
      { id: "end", type: "end", name: "结束", result: "approved" },
    ]);
    await saveFlowDraft(
      { id: created.id, definition: secondDefinition },
      actorId,
    );
    const second = await publishFlow(created.id, actorId);
    expect(second.version).toBe(2);

    const afterSecondRow = await prisma.approvalFlowVersion.findFirstOrThrow({
      where: { flowId: created.id, version: 1 },
    });
    expect(afterSecondRow.definition).toEqual(firstRow.definition);
    expect(afterSecondRow.status).toBe("archived");

    const versions = await listFlowVersions(created.id);
    expect(versions.map((version) => version.version)).toEqual([2, 1]);
    expect(versions[0]).toMatchObject({ status: "active", nodeCount: 4 });

    const audit = await prisma.auditLog.findMany({
      where: { entity: "ApprovalFlow", entityId: created.id, action: "flow.publish" },
    });
    expect(audit).toHaveLength(2);
  });

  it("rejects unknown users and dangling reject targets", async () => {
    const created = await createFlow(
      { code: `FLOW_BADASSIGNEE_${slug}`, name: "非法审批人流程", category: "通用" },
      actorId,
    );
    await saveFlowDraft(
      {
        id: created.id,
        definition: definition([
          { id: "start", type: "start", name: "发起", next: "legal" },
          {
            ...approval("legal", { kind: "user", ids: ["ghost-user"] }, "end"),
            reject: { policy: "to_node:ghost" },
          },
          { id: "end", type: "end", name: "结束", result: "approved" },
        ]),
      },
      actorId,
    );

    const detail = await getFlow(created.id);
    expect(detail.draftIssues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["REJECT_TARGET_UNKNOWN", "ASSIGNEE_USER_MISSING"]),
    );
    await expect(publishFlow(created.id, actorId)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

describe("flow binding and deletion guards", () => {
  it("requires a published flow before a template can bind to it", async () => {
    const created = await createFlow(
      { code: `FLOW_BIND_${slug}`, name: "绑定流程", category: "通用" },
      actorId,
    );
    const template = await prisma.contractTemplate.create({
      data: {
        code: `TB${suffix}`,
        name: "绑定测试模板",
        category: "测试",
        fieldSchema: [],
      },
      select: { id: true },
    });

    await expect(
      setTemplateFlow(template.id, created.id, actorId),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await saveFlowDraft({ id: created.id, definition: linear(staffRoleKey) }, actorId);
    await publishFlow(created.id, actorId);
    await expect(
      setTemplateFlow(template.id, created.id, actorId),
    ).resolves.toMatchObject({ flowId: created.id });

    await expect(deleteFlow(created.id, actorId)).rejects.toMatchObject({
      code: "CONFLICT",
    });

    await setTemplateFlow(template.id, null, actorId);
    await prisma.contractTemplate.update({
      where: { id: template.id },
      data: { deletedAt: new Date() },
    });
    await expect(deleteFlow(created.id, actorId)).resolves.toMatchObject({
      id: created.id,
    });
  });

  it("refuses to delete a flow that already has instances", async () => {
    const created = await createFlow(
      { code: `FLOW_USED_${slug}`, name: "在用流程", category: "通用" },
      actorId,
    );
    await saveFlowDraft({ id: created.id, definition: linear(staffRoleKey) }, actorId);
    const published = await publishFlow(created.id, actorId);
    const version = await prisma.approvalFlowVersion.findFirstOrThrow({
      where: { flowId: created.id, version: published.version },
    });
    const party = await prisma.party.create({
      data: { name: `删除守卫相对方${suffix}`, type: "other", contacts: [] },
    });
    const type = await prisma.contractType.create({
      data: { key: `flow_del_${slug}`, name: "删除守卫类型" },
    });
    const contract = await prisma.contract.create({
      data: {
        no: `HT-DEL-${suffix}`,
        title: "删除守卫合同",
        templateId: (await prisma.contractTemplate.create({
          data: {
            code: `TD${suffix}`,
            name: "删除守卫模板",
            category: "测试",
            fieldSchema: [],
          },
          select: { id: true },
        })).id,
        typeId: type.id,
        partyAId: party.id,
        partyBId: party.id,
        amount: "1.00",
        signDate: new Date("2026-10-15T00:00:00.000Z"),
        startDate: new Date("2026-10-15T00:00:00.000Z"),
        endDate: new Date("2027-10-14T00:00:00.000Z"),
        formData: {},
        createdBy: actorId,
      },
      select: { id: true },
    });
    await prisma.flowInstance.create({
      data: {
        contractId: contract.id,
        flowId: created.id,
        flowVersionId: version.id,
        definitionSnapshot: version.definition as Prisma.InputJsonValue,
        startedBy: actorId,
      },
    });

    await expect(deleteFlow(created.id, actorId)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("renames a flow without touching its code", async () => {
    const created = await createFlow(
      { code: `FLOW_RENAME_${slug}`, name: "旧名称", category: "通用" },
      actorId,
    );
    await updateFlow({ id: created.id, name: "新名称", category: "采购" }, actorId);
    const detail = await getFlow(created.id);
    expect(detail).toMatchObject({ name: "新名称", category: "采购", code: `FLOW_RENAME_${slug}` });
  });
});
