import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { getAccessContext } from "@/server/auth/access";
import {
  createContract,
  findSimilarContracts,
  getContractDetail,
  listContracts,
  updateContract,
} from "@/server/services/contract";
import type { ContractDraftInput } from "@/shared/schemas/contract";
import { contractListQuerySchema } from "@/shared/schemas/contract";
import {
  createTestParty,
  createTestTemplate,
  createTestUser,
  ensureContractType,
  ensureTestDepartment,
  prepareDatabase,
  resetContractData,
  uniqueSuffix,
} from "../helpers/fixtures";

const suffix = uniqueSuffix();

let employeeId = "";
let managerId = "";
let outsiderId = "";
let departmentId = "";
let templateId = "";
let templateCode = "";
let typeId = "";
let partyAId = "";
let partyBId = "";

function draftInput(overrides: Partial<ContractDraftInput> = {}): ContractDraftInput {
  return {
    templateId,
    typeId,
    title: "年度采购框架协议",
    partyAId,
    partyBId,
    amount: "500000.00",
    currency: "CNY",
    signDate: "2026-10-15",
    startDate: "2026-10-15",
    endDate: "2027-10-14",
    formData: {
      contact: "张三",
      days: "30",
      signedAt: "2026-10-15",
      payType: "月结",
    },
    bodyMarkdown: "# 采购框架协议\n\n正文内容。",
    ...overrides,
  };
}

async function employeeAccess() {
  return getAccessContext(employeeId);
}

beforeAll(async () => {
  await prepareDatabase();
  await resetContractData();

  const hq = await ensureTestDepartment();
  const department = await prisma.department.create({
    data: {
      name: `测试子部门${suffix}`,
      parentId: hq.id,
      path: `${hq.path}/sub-${suffix.toLowerCase()}`,
    },
  });
  departmentId = department.id;

  const employee = await createTestUser({
    name: "测试员工",
    email: `employee-${suffix.toLowerCase()}@test.local`,
    roleKey: "employee",
    departmentId: department.id,
  });
  const manager = await createTestUser({
    name: "测试主管",
    email: `manager-${suffix.toLowerCase()}@test.local`,
    roleKey: "manager",
    departmentId: hq.id,
  });
  const outsider = await createTestUser({
    name: "外部员工",
    email: `outsider-${suffix.toLowerCase()}@test.local`,
    roleKey: "employee",
    departmentId: hq.id,
  });
  employeeId = employee.id;
  managerId = manager.id;
  outsiderId = outsider.id;

  const partyA = await createTestParty(`甲方${suffix}`);
  const partyB = await createTestParty(`乙方${suffix}`);
  partyAId = partyA.id;
  partyBId = partyB.id;

  typeId = (await ensureContractType(`test_type_${suffix.toLowerCase()}`, "测试合同")).id;

  const template = await createTestTemplate({
    code: `T${suffix}`,
    name: "测试采购模板",
    fields: [
      { key: "contact", label: "联系人", type: "text", required: true },
      {
        key: "days",
        label: "账期天数",
        type: "number",
        required: true,
        min: 0,
        max: 180,
      },
      { key: "signedAt", label: "签署日期", type: "date", required: true },
      {
        key: "payType",
        label: "付款方式",
        type: "select",
        required: true,
        options: ["月结", "现结"],
      },
      {
        key: "payNote",
        label: "现结说明",
        type: "text",
        required: true,
        visibleWhen: { field: "payType", equals: "现结" },
      },
    ],
  });
  templateId = template.id;
  templateCode = template.code;
});

describe("contract draft lifecycle", () => {
  it("creates a draft with a generated number, version and initiator participant", async () => {
    const access = await employeeAccess();
    const created = await createContract(access, draftInput());

    expect(created.no).toMatch(
      new RegExp(`^HT-${templateCode}-\\d{6}-0001$`),
    );

    const row = await prisma.contract.findUniqueOrThrow({
      where: { id: created.id },
      include: { versions: true, participants: true },
    });
    expect(row.status).toBe("draft");
    expect(row.stage).toBe("normal");
    expect(row.ownerDepartmentId).toBe(departmentId);
    expect(row.createdBy).toBe(employeeId);
    expect(row.versions).toHaveLength(1);
    expect(row.versions[0]?.bodyMarkdown).toContain("采购框架协议");
    expect(row.participants.map((item) => item.kind)).toEqual(["initiator"]);

    const audits = await prisma.auditLog.count({
      where: {
        entity: "Contract",
        entityId: created.id,
        action: "contract.create",
      },
    });
    expect(audits).toBe(1);
  });

  it("returns form entries and parties in detail", async () => {
    const access = await employeeAccess();
    const created = await createContract(access, draftInput({ title: "详情测试合同" }));
    const detail = await getContractDetail(access, created.id);

    expect(detail.title).toBe("详情测试合同");
    expect(detail.partyA.id).toBe(partyAId);
    expect(detail.partyB.id).toBe(partyBId);
    expect(detail.template.id).toBe(templateId);
    expect(detail.formEntries.find((entry) => entry.key === "contact")?.value).toBe(
      "张三",
    );
    expect(detail.formEntries.find((entry) => entry.key === "payNote")?.value).toBe(
      "—",
    );
    expect(detail.latestVersion?.version).toBe(1);
    expect(detail.versionCount).toBe(1);
  });

  it("rejects missing required dynamic fields with prefixed errors", async () => {
    const access = await employeeAccess();
    await expect(
      createContract(
        access,
        draftInput({ formData: { days: "30", payType: "月结" } }),
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fields: {
        "formData.contact": "请填写联系人",
        "formData.signedAt": "请填写签署日期",
      },
    });
  });

  it("validates conditional fields and number bounds", async () => {
    const access = await employeeAccess();
    await expect(
      createContract(
        access,
        draftInput({
          formData: {
            contact: "张三",
            days: "30",
            signedAt: "2026-10-15",
            payType: "现结",
          },
        }),
      ),
    ).rejects.toMatchObject({
      fields: { "formData.payNote": "请填写现结说明" },
    });

    await expect(
      createContract(
        access,
        draftInput({
          formData: {
            contact: "张三",
            days: "999",
            signedAt: "2026-10-15",
            payType: "月结",
          },
        }),
      ),
    ).rejects.toMatchObject({
      fields: { "formData.days": "账期天数不能大于 180" },
    });
  });

  it("rejects an inactive template", async () => {
    const inactive = await createTestTemplate({
      code: `I${suffix}`,
      name: "停用模板",
      fields: [],
    });
    await prisma.contractTemplate.update({
      where: { id: inactive.id },
      data: { active: false },
    });

    const access = await employeeAccess();
    await expect(
      createContract(access, draftInput({ templateId: inactive.id })),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fields: { templateId: "合同模板已停用" },
    });
  });

  it("updates a draft in place and keeps version 1", async () => {
    const access = await employeeAccess();
    const created = await createContract(access, draftInput({ title: "待修改合同" }));

    const updated = await updateContract(access, {
      id: created.id,
      ...draftInput({
        title: "修改后的合同",
        amount: "888888.88",
        bodyMarkdown: "# 修改后的正文",
      }),
    });

    expect(updated.no).toBe(created.no);
    const row = await prisma.contract.findUniqueOrThrow({
      where: { id: created.id },
      include: { versions: { orderBy: { version: "asc" } } },
    });
    expect(row.title).toBe("修改后的合同");
    expect(row.amount.toFixed(2)).toBe("888888.88");
    expect(row.versions).toHaveLength(1);
    expect(row.versions[0]?.bodyMarkdown).toBe("# 修改后的正文");

    const updateAudits = await prisma.auditLog.count({
      where: { entity: "Contract", entityId: created.id, action: "contract.update" },
    });
    expect(updateAudits).toBe(1);
  });

  it("rejects template changes and edits outside draft", async () => {
    const access = await employeeAccess();
    const created = await createContract(access, draftInput());
    const otherTemplate = await createTestTemplate({
      code: `O${suffix}`,
      name: "另一个模板",
      fields: [],
    });

    await expect(
      updateContract(access, {
        id: created.id,
        ...draftInput({ templateId: otherTemplate.id }),
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fields: { templateId: "合同模板创建后不可更换" },
    });

    await prisma.contract.update({
      where: { id: created.id },
      data: { status: "approving" },
    });
    await expect(
      updateContract(access, { id: created.id, ...draftInput() }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("increments numbers per template and month", async () => {
    const access = await employeeAccess();
    const first = await createContract(access, draftInput());
    const second = await createContract(access, draftInput());

    const firstSeq = Number(first.no.split("-").at(-1));
    const secondSeq = Number(second.no.split("-").at(-1));
    expect(secondSeq).toBe(firstSeq + 1);
  });
});

describe("contract data scope", () => {
  it("hides contracts from unrelated employees but shows the department subtree", async () => {
    const access = await employeeAccess();
    const created = await createContract(access, draftInput({ title: "范围测试合同" }));

    const outsider = await getAccessContext(outsiderId);
    await expect(getContractDetail(outsider, created.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const outsiderList = await listContracts(
      outsider,
      contractListQuerySchema.parse({ pageSize: "50" }),
    );
    expect(outsiderList.items.some((item) => item.id === created.id)).toBe(false);

    const manager = await getAccessContext(managerId);
    const detail = await getContractDetail(manager, created.id);
    expect(detail.id).toBe(created.id);

    const managerList = await listContracts(
      manager,
      contractListQuerySchema.parse({ pageSize: "50" }),
    );
    expect(managerList.items.some((item) => item.id === created.id)).toBe(true);
  });

  it("filters by status and keyword", async () => {
    const access = await employeeAccess();
    const created = await createContract(
      access,
      draftInput({ title: `关键字检索-${suffix}` }),
    );

    const byKeyword = await listContracts(
      access,
      contractListQuerySchema.parse({ q: `关键字检索-${suffix}` }),
    );
    expect(byKeyword.items.map((item) => item.id)).toContain(created.id);

    const byStatus = await listContracts(
      access,
      contractListQuerySchema.parse({ status: "draft", pageSize: "100" }),
    );
    expect(byStatus.items.every((item) => item.status === "draft")).toBe(true);
  });

  it("pages with a stable sort without repeating or dropping rows", async () => {
    const access = await employeeAccess();
    const marker = `分页检索-${suffix}`;
    const amounts = ["111111.11", "222222.22", "333333.33"];
    const ids: string[] = [];

    for (const [index, amount] of amounts.entries()) {
      const created = await createContract(
        access,
        draftInput({ title: `${marker}${index}`, amount }),
      );
      ids.push(created.id);
    }

    const query = { q: marker, pageSize: "2", sort: "amount", order: "desc" };
    const firstPage = await listContracts(
      access,
      contractListQuerySchema.parse(query),
    );
    expect(firstPage.total).toBe(3);
    expect(firstPage.totalPages).toBe(2);
    expect(firstPage.items.map((item) => item.amount)).toEqual([
      "333333.33",
      "222222.22",
    ]);

    const secondPage = await listContracts(
      access,
      contractListQuerySchema.parse({ ...query, page: "2" }),
    );
    expect(secondPage.items.map((item) => item.amount)).toEqual(["111111.11"]);
    expect(
      secondPage.items.every(
        (item) => !firstPage.items.some((other) => other.id === item.id),
      ),
    ).toBe(true);
  });

  it("finds similar contracts by same parties and amount", async () => {
    const access = await employeeAccess();
    const original = await createContract(
      access,
      draftInput({ title: "相似合同A", amount: "123456.78" }),
    );
    const similar = await createContract(
      access,
      draftInput({
        title: "相似合同B",
        amount: "123456.78",
        signDate: "2026-10-20",
      }),
    );

    const matches = await findSimilarContracts(access, original.id);
    expect(matches.map((item) => item.id)).toContain(similar.id);
  });
});
