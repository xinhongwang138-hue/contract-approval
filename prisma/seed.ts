import "dotenv/config";

import { hashPassword } from "../src/server/auth/password";
import { prisma } from "../src/server/db/client";
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

async function seedAdmin(): Promise<void> {
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
}

async function main(): Promise<void> {
  await seedPermissions();
  await seedRoles();
  await seedAdmin();
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
