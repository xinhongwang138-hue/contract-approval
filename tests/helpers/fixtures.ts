import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import {
  PERMISSION_DEFINITIONS,
  PERMISSION_KEYS,
  ROLE_DEFINITIONS,
} from "@/shared/permissions";
import { ensureTestDatabase } from "./db";

export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

export async function prepareDatabase(): Promise<void> {
  await ensureTestDatabase();
  await ensureRoles();
}

async function ensureRoles(): Promise<void> {
  for (const key of PERMISSION_KEYS) {
    const definition = PERMISSION_DEFINITIONS[key];
    await prisma.permission.upsert({
      where: { key },
      update: { name: definition.name, group: definition.group, deletedAt: null },
      create: { key, name: definition.name, group: definition.group },
    });
  }

  for (const role of ROLE_DEFINITIONS) {
    const row = await prisma.role.upsert({
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
          roleId_permissionId: { roleId: row.id, permissionId: permission.id },
        },
        update: { deletedAt: null },
        create: { roleId: row.id, permissionId: permission.id },
      });
    }

    await prisma.dataScope.upsert({
      where: { roleId: row.id },
      update: { scope: role.scope, departmentId: null, deletedAt: null },
      create: { roleId: row.id, scope: role.scope },
    });
  }
}

export async function createTestUser(input: {
  name: string;
  email: string;
  roleKey: string;
  departmentId?: string | null;
}): Promise<{ id: string; email: string }> {
  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: {
      name: input.name,
      status: "active",
      deletedAt: null,
      departmentId: input.departmentId ?? null,
    },
    create: {
      name: input.name,
      email: input.email,
      emailVerified: true,
      status: "active",
      departmentId: input.departmentId ?? null,
    },
  });

  const role = await prisma.role.findUniqueOrThrow({
    where: { key: input.roleKey },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: { deletedAt: null },
    create: { userId: user.id, roleId: role.id },
  });

  return { id: user.id, email: user.email };
}

export async function ensureTestDepartment(): Promise<{ id: string; path: string }> {
  const department = await prisma.department.upsert({
    where: { path: "/test-hq" },
    update: { name: "测试总部", deletedAt: null },
    create: { name: "测试总部", path: "/test-hq", sortOrder: 0 },
  });
  return { id: department.id, path: department.path };
}

export async function resetContractData(): Promise<void> {
  await prisma.attachment.deleteMany();
  await prisma.contractVersion.deleteMany();
  await prisma.contractMilestone.deleteMany();
  await prisma.sealRecord.deleteMany();
  await prisma.contractParticipant.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.contractNoSequence.deleteMany();
  await prisma.contractTemplate.deleteMany();
  await prisma.contractType.deleteMany();
  await prisma.party.deleteMany();
}

export async function createTestParty(
  name: string,
  type: "customer" | "supplier" | "other" = "customer",
): Promise<{ id: string; name: string }> {
  const party = await prisma.party.create({
    data: { name, type, contacts: [] },
    select: { id: true, name: true },
  });
  return party;
}

export async function ensureContractType(
  key: string,
  name: string,
): Promise<{ id: string }> {
  return prisma.contractType.upsert({
    where: { key },
    update: { name, active: true, deletedAt: null },
    create: { key, name },
    select: { id: true },
  });
}

export type TestTemplate = {
  id: string;
  code: string;
  name: string;
  fields: unknown[];
};

export async function createTestTemplate(input: {
  code: string;
  name: string;
  fields: unknown[];
}): Promise<TestTemplate> {
  const template = await prisma.contractTemplate.create({
    data: {
      code: input.code,
      name: input.name,
      category: "销售",
      fieldSchema: input.fields as Prisma.InputJsonValue,
      active: true,
    },
    select: { id: true, code: true, name: true },
  });
  return { ...template, fields: input.fields };
}
