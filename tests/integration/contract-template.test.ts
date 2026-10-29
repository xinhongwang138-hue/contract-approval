import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import {
  createContractTemplate,
  updateContractTemplate,
  updateContractTemplateFields,
} from "@/server/services/contract-template";
import {
  createTestUser,
  ensureTestDepartment,
  prepareDatabase,
  uniqueSuffix,
} from "../helpers/fixtures";

const suffix = uniqueSuffix();
const slug = suffix.toLowerCase();

let actorId = "";

beforeAll(async () => {
  await prepareDatabase();
  const department = await ensureTestDepartment();
  actorId = (
    await createTestUser({
      name: "模板管理员",
      email: `tpl-admin-${slug}@test.local`,
      roleKey: "admin",
      departmentId: department.id,
    })
  ).id;
});

describe("contract template maintenance", () => {
  it("keeps the dynamic fields when only the meta data is edited", async () => {
    const created = await createContractTemplate(
      {
        code: `TM${suffix}`,
        name: "字段保留模板",
        category: "测试",
        active: true,
        fields: [
          {
            key: "contact",
            label: "联系人",
            type: "text",
            required: true,
            options: [],
            min: null,
            max: null,
            visibleWhen: null,
          },
        ],
      },
      actorId,
    );

    await updateContractTemplate(
      { id: created.id, name: "字段保留模板（改名）", category: "采购", active: true },
      actorId,
    );

    const row = await prisma.contractTemplate.findUniqueOrThrow({
      where: { id: created.id },
      select: { name: true, category: true, fieldSchema: true },
    });
    expect(row.name).toBe("字段保留模板（改名）");
    expect(row.category).toBe("采购");
    expect(row.fieldSchema).toMatchObject([{ key: "contact", label: "联系人" }]);
  });

  it("replaces fields only through the dedicated field save", async () => {
    const created = await createContractTemplate(
      {
        code: `TN${suffix}`,
        name: "字段替换模板",
        category: "测试",
        active: true,
        fields: [],
      },
      actorId,
    );

    await updateContractTemplateFields(
      created.id,
      [
        {
          key: "region",
          label: "区域",
          type: "select",
          required: false,
          options: ["华东", "华南"],
          min: null,
          max: null,
          visibleWhen: null,
        },
      ],
      actorId,
    );

    const row = await prisma.contractTemplate.findUniqueOrThrow({
      where: { id: created.id },
      select: { fieldSchema: true },
    });
    expect(row.fieldSchema).toMatchObject([{ key: "region", type: "select" }]);
  });
});
