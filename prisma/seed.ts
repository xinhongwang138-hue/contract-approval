import "dotenv/config";

import type { Prisma } from "../src/generated/prisma/client";
import { hashPassword } from "../src/server/auth/password";
import { prisma } from "../src/server/db/client";
import { contractFieldArraySchema } from "../src/shared/contract-fields";
import { seedDemoWorld } from "./seed-demo";
import {
  PERMISSION_DEFINITIONS,
  PERMISSION_KEYS,
  ROLE_DEFINITIONS,
} from "../src/shared/permissions";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin@12345";

async function seedPermissions(): Promise<void> {
  for (const key of PERMISSION_KEYS) {
    const definition = PERMISSION_DEFINITIONS[key];
    await prisma.permission.upsert({
      where: { key },
      update: { name: definition.name, group: definition.group, deletedAt: null },
      create: { key, name: definition.name, group: definition.group },
    });
  }
}

async function seedRoles(): Promise<void> {
  for (const role of ROLE_DEFINITIONS) {
    const roleRow = await prisma.role.upsert({
      where: { key: role.key },
      update: { name: role.name, isSystem: role.isSystem, deletedAt: null },
      create: { key: role.key, name: role.name, isSystem: role.isSystem },
    });

    for (const permissionKey of role.permissions) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { key: permissionKey },
      });
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: roleRow.id,
            permissionId: permission.id,
          },
        },
        update: { deletedAt: null },
        create: { roleId: roleRow.id, permissionId: permission.id },
      });
    }

    await prisma.dataScope.upsert({
      where: { roleId: roleRow.id },
      update: { scope: role.scope, departmentId: null, deletedAt: null },
      create: { roleId: roleRow.id, scope: role.scope },
    });
  }
}

type SeedField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select";
  required: boolean;
  options?: string[];
  min?: number | null;
  max?: number | null;
  visibleWhen?: { field: string; equals: string | number | boolean } | null;
};

function fieldSchema(fields: SeedField[]): Prisma.InputJsonValue {
  return contractFieldArraySchema.parse(
    fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      options: field.options ?? [],
      min: field.min ?? null,
      max: field.max ?? null,
      visibleWhen: field.visibleWhen ?? null,
    })),
  ) as Prisma.InputJsonValue;
}

const CONTRACT_TYPES = [
  { key: "purchase", name: "采购合同" },
  { key: "sales", name: "销售合同" },
  { key: "service", name: "服务合同" },
];

const PARTIES = [
  {
    name: "上海华信科技有限公司",
    uscc: "91310000MA1FL0XX1A",
    type: "customer" as const,
    address: "上海市浦东新区世纪大道 100 号",
    contacts: [
      { name: "张伟", phone: "13800001111", email: "zhangwei@example.com" },
    ],
  },
  {
    name: "杭州云诚供应链有限公司",
    uscc: "91330100MA2GL1YY2B",
    type: "supplier" as const,
    address: "浙江省杭州市滨江区江南大道 588 号",
    contacts: [
      { name: "李娜", phone: "13900002222", email: "lina@example.com" },
    ],
  },
  {
    name: "北京鼎新咨询有限公司",
    uscc: "91110108MA01ABCD3X",
    type: "other" as const,
    address: "北京市海淀区中关村大街 1 号",
    contacts: [
      { name: "王强", phone: "13700003333", email: "wangqiang@example.com" },
    ],
  },
];

const TEMPLATES = [
  {
    code: "PURCHASE",
    name: "采购合同",
    category: "采购",
    fields: [
      { key: "supplyName", label: "采购标的", type: "text" as const, required: true },
      {
        key: "deliveryDays",
        label: "交付周期（天）",
        type: "number" as const,
        required: true,
        min: 1,
        max: 365,
      },
      { key: "deliveryDate", label: "首批交付日期", type: "date" as const, required: true },
      {
        key: "payMethod",
        label: "付款方式",
        type: "select" as const,
        required: true,
        options: ["月结30天", "月结60天", "现结"],
      },
      {
        key: "prepayRatio",
        label: "预付款比例（%）",
        type: "number" as const,
        required: false,
        min: 0,
        max: 100,
      },
      {
        key: "acceptanceNote",
        label: "现结验收说明",
        type: "textarea" as const,
        required: true,
        visibleWhen: { field: "payMethod", equals: "现结" },
      },
    ],
  },
  {
    code: "SALES",
    name: "销售合同",
    category: "销售",
    fields: [
      {
        key: "region",
        label: "销售区域",
        type: "select" as const,
        required: true,
        options: ["华东", "华南", "华北", "西南"],
      },
      {
        key: "channel",
        label: "销售渠道",
        type: "select" as const,
        required: true,
        options: ["直销", "经销", "电商"],
      },
      {
        key: "rebateRate",
        label: "返点比例（%）",
        type: "number" as const,
        required: false,
        min: 0,
        max: 30,
      },
      { key: "deliveryAddress", label: "交付地址", type: "text" as const, required: true },
    ],
  },
];

async function seedMasterData(adminId: string): Promise<void> {
  for (const type of CONTRACT_TYPES) {
    await prisma.contractType.upsert({
      where: { key: type.key },
      update: { name: type.name, active: true, deletedAt: null, updatedBy: adminId },
      create: { key: type.key, name: type.name, createdBy: adminId },
    });
  }

  for (const party of PARTIES) {
    await prisma.party.upsert({
      where: { uscc: party.uscc },
      update: {
        name: party.name,
        type: party.type,
        address: party.address,
        contacts: party.contacts as unknown as Prisma.InputJsonValue,
        deletedAt: null,
        updatedBy: adminId,
      },
      create: {
        name: party.name,
        uscc: party.uscc,
        type: party.type,
        address: party.address,
        contacts: party.contacts as unknown as Prisma.InputJsonValue,
        createdBy: adminId,
      },
    });
  }

  for (const template of TEMPLATES) {
    await prisma.contractTemplate.upsert({
      where: { code: template.code },
      update: {
        name: template.name,
        category: template.category,
        fieldSchema: fieldSchema(template.fields),
        active: true,
        deletedAt: null,
        updatedBy: adminId,
      },
      create: {
        code: template.code,
        name: template.name,
        category: template.category,
        fieldSchema: fieldSchema(template.fields),
        createdBy: adminId,
      },
    });
  }
}

async function seedAdmin(): Promise<{ id: string }> {
  const department = await prisma.department.upsert({
    where: { path: "/hq" },
    update: { name: "总公司", deletedAt: null },
    create: { name: "总公司", path: "/hq", sortOrder: 0 },
  });

  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { key: "admin" },
  });

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {
      name: "系统管理员",
      departmentId: department.id,
      status: "active",
      deletedAt: null,
    },
    create: {
      name: "系统管理员",
      email: ADMIN_EMAIL,
      emailVerified: true,
      departmentId: department.id,
      status: "active",
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: { deletedAt: null },
    create: { userId: admin.id, roleId: adminRole.id },
  });

  const credential = await prisma.account.findFirst({
    where: { userId: admin.id, providerId: "credential" },
  });

  if (!credential) {
    await prisma.account.create({
      data: {
        userId: admin.id,
        accountId: admin.id,
        providerId: "credential",
        password: await hashPassword(ADMIN_PASSWORD),
      },
    });
  }

  return { id: admin.id };
}

async function main(): Promise<void> {
  await seedPermissions();
  await seedRoles();
  const admin = await seedAdmin();
  await seedMasterData(admin.id);
  await seedDemoWorld(admin.id);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
