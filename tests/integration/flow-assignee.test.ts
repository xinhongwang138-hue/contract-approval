import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { resolveAssignees, type AssigneeContext } from "@/server/flow/assignee";
import {
  createTestDepartment,
  createTestUser,
  ensureTestDepartment,
  prepareDatabase,
  uniqueSuffix,
} from "../helpers/fixtures";

const suffix = uniqueSuffix();

let leaderId = "";
let bossId = "";
let employeeId = "";
let legalAId = "";
let legalBId = "";
let disabledLegalId = "";
let subDepartmentId = "";

function context(overrides: Partial<AssigneeContext> = {}): AssigneeContext {
  return {
    initiatorId: employeeId,
    departmentId: subDepartmentId,
    managerUserId: leaderId,
    formData: {},
    ...overrides,
  };
}

beforeAll(async () => {
  await prepareDatabase();

  const hq = await ensureTestDepartment();
  bossId = (
    await createTestUser({
      name: "总部门主管",
      email: `boss-${suffix.toLowerCase()}@test.local`,
      roleKey: "manager",
      departmentId: hq.id,
    })
  ).id;
  leaderId = (
    await createTestUser({
      name: "部门主管",
      email: `leader-${suffix.toLowerCase()}@test.local`,
      roleKey: "manager",
      departmentId: hq.id,
    })
  ).id;

  const sub = await createTestDepartment({
    name: `审批子部门${suffix}`,
    path: `/test-hq/assignee-${suffix.toLowerCase()}`,
    parentId: hq.id,
    managerUserId: leaderId,
  });
  subDepartmentId = sub.id;
  await createTestDepartment({
    name: "测试总部",
    path: hq.path,
    managerUserId: bossId,
  });

  employeeId = (
    await createTestUser({
      name: "发起人",
      email: `initiator-${suffix.toLowerCase()}@test.local`,
      roleKey: "employee",
      departmentId: sub.id,
      managerUserId: leaderId,
    })
  ).id;

  legalAId = (
    await createTestUser({
      name: "法务A",
      email: `legal-a-${suffix.toLowerCase()}@test.local`,
      roleKey: "legal",
      departmentId: hq.id,
    })
  ).id;
  legalBId = (
    await createTestUser({
      name: "法务B",
      email: `legal-b-${suffix.toLowerCase()}@test.local`,
      roleKey: "legal",
      departmentId: hq.id,
    })
  ).id;
  disabledLegalId = (
    await createTestUser({
      name: "停用法务",
      email: `legal-off-${suffix.toLowerCase()}@test.local`,
      roleKey: "legal",
      departmentId: hq.id,
      status: "disabled",
    })
  ).id;
});

describe("resolveAssignees", () => {
  it("resolves a role to its active members only", async () => {
    const result = await resolveAssignees(
      prisma,
      { kind: "role", key: "legal" },
      context(),
    );
    expect(result.userIds).toContain(legalAId);
    expect(result.userIds).toContain(legalBId);
    expect(result.userIds).not.toContain(disabledLegalId);
    expect(result.userIds).toHaveLength(new Set(result.userIds).size);
  });

  it("notes an unknown role instead of inventing approvers", async () => {
    const result = await resolveAssignees(
      prisma,
      { kind: "role", key: `nope_${suffix.toLowerCase()}` },
      context(),
    );
    expect(result.userIds).toEqual([]);
    expect(result.notes.join("")).toContain("不存在");
  });

  it("drops unknown or disabled explicit users", async () => {
    const result = await resolveAssignees(
      prisma,
      { kind: "user", ids: [legalAId, disabledLegalId, "user-missing"] },
      context(),
    );
    expect(result.userIds).toEqual([legalAId]);
    expect(result.notes.length).toBe(2);
  });

  it("resolves the initiator themselves", async () => {
    const result = await resolveAssignees(
      prisma,
      { kind: "initiator_self" },
      context(),
    );
    expect(result.userIds).toEqual([employeeId]);
  });

  it("walks up the department tree for dept_manager levels", async () => {
    const first = await resolveAssignees(
      prisma,
      { kind: "dept_manager", level: 1 },
      context(),
    );
    expect(first.userIds).toEqual([leaderId]);

    const second = await resolveAssignees(
      prisma,
      { kind: "dept_manager", level: 2 },
      context(),
    );
    expect(second.userIds).toEqual([bossId]);

    const third = await resolveAssignees(
      prisma,
      { kind: "dept_manager", level: 3 },
      context(),
    );
    expect(third.userIds).toEqual([]);
    expect(third.notes.join("")).toContain("向上第 3 级");
  });

  it("builds one group per level for a multi level leader chain", async () => {
    const result = await resolveAssignees(
      prisma,
      { kind: "multi_level_leader", fromLevel: 1, toLevel: 2 },
      context(),
    );
    expect(result.levelGroups).toEqual([[leaderId], [bossId]]);
    expect(result.userIds).toEqual([leaderId, bossId]);
    expect(result.notes).toEqual([]);
  });

  it("reports when the leader chain is shorter than requested", async () => {
    const result = await resolveAssignees(
      prisma,
      { kind: "multi_level_leader", fromLevel: 1, toLevel: 4 },
      context(),
    );
    expect(result.levelGroups).toEqual([[leaderId], [bossId]]);
    expect(result.notes.join("")).toContain("配置要求到第 4 级");
  });

  it("reads user ids or emails from a form field", async () => {
    const byId = await resolveAssignees(
      prisma,
      { kind: "form_field", field: "reviewer" },
      context({ formData: { reviewer: legalAId } }),
    );
    expect(byId.userIds).toEqual([legalAId]);

    const byEmail = await resolveAssignees(
      prisma,
      { kind: "form_field", field: "reviewer" },
      context({ formData: { reviewer: `legal-a-${suffix.toLowerCase()}@test.local` } }),
    );
    expect(byEmail.userIds).toEqual([legalAId]);

    const list = await resolveAssignees(
      prisma,
      { kind: "form_field", field: "reviewer" },
      context({ formData: { reviewer: [legalAId, legalBId] } }),
    );
    expect(list.userIds).toEqual([legalAId, legalBId]);
  });

  it("notes when a form field has no usable approver", async () => {
    const empty = await resolveAssignees(
      prisma,
      { kind: "form_field", field: "reviewer" },
      context({ formData: {} }),
    );
    expect(empty.userIds).toEqual([]);
    expect(empty.notes.join("")).toContain("没有填写审批人");

    const unknown = await resolveAssignees(
      prisma,
      { kind: "form_field", field: "reviewer" },
      context({ formData: { reviewer: "someone@example.com" } }),
    );
    expect(unknown.userIds).toEqual([]);
    expect(unknown.notes.join("")).toContain("无法匹配");
  });

  it("supports the whitelisted expressions", async () => {
    const manager = await resolveAssignees(
      prisma,
      { kind: "expression", expression: "initiator.manager" },
      context(),
    );
    expect(manager.userIds).toEqual([leaderId]);

    const deptManager = await resolveAssignees(
      prisma,
      { kind: "expression", expression: "initiator.dept_manager" },
      context(),
    );
    expect(deptManager.userIds).toEqual([leaderId]);

    const fromForm = await resolveAssignees(
      prisma,
      { kind: "expression", expression: "form.reviewer" },
      context({ formData: { reviewer: legalBId } }),
    );
    expect(fromForm.userIds).toEqual([legalBId]);
  });

  it("rejects expressions outside the whitelist", async () => {
    await expect(
      resolveAssignees(
        prisma,
        { kind: "expression", expression: "require('fs')" },
        context(),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("notes when the initiator has no direct manager", async () => {
    const result = await resolveAssignees(
      prisma,
      { kind: "expression", expression: "initiator.manager" },
      context({ managerUserId: null }),
    );
    expect(result.userIds).toEqual([]);
    expect(result.notes.join("")).toContain("没有直属上级");
  });
});
