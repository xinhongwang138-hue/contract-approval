import { Prisma } from "@/generated/prisma/client";
import {
  parseFieldSchema,
  type ContractField,
} from "@/shared/contract-fields";
import { AppError, ERROR_CODES } from "@/shared/errors";
import type {
  ContractTemplateCreateInput,
  ContractTemplateUpdateInput,
} from "@/shared/schemas/contract-template";
import { recordAudit } from "@/server/audit";
import { prisma } from "@/server/db/client";

export type TemplateListItem = {
  id: string;
  code: string;
  name: string;
  category: string;
  active: boolean;
  fieldCount: number;
  contractCount: number;
  flowId: string | null;
  flowName: string | null;
  updatedAt: Date;
};

export type TemplateDetail = {
  id: string;
  code: string;
  name: string;
  category: string;
  active: boolean;
  fields: ContractField[];
  updatedAt: Date;
};

export async function listContractTemplates(): Promise<TemplateListItem[]> {
  const rows = await prisma.contractTemplate.findMany({
    where: { deletedAt: null },
    orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      code: true,
      name: true,
      category: true,
      active: true,
      fieldSchema: true,
      updatedAt: true,
      flowId: true,
      flow: { select: { name: true } },
      _count: { select: { contracts: { where: { deletedAt: null } } } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    active: row.active,
    fieldCount: parseFieldSchema(row.fieldSchema).length,
    contractCount: row._count.contracts,
    flowId: row.flowId,
    flowName: row.flow?.name ?? null,
    updatedAt: row.updatedAt,
  }));
}

export async function listActiveContractTemplates(): Promise<TemplateDetail[]> {
  const rows = await prisma.contractTemplate.findMany({
    where: { deletedAt: null, active: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      category: true,
      active: true,
      fieldSchema: true,
      updatedAt: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    fields: parseFieldSchema(row.fieldSchema),
  }));
}

export async function getContractTemplate(id: string): Promise<TemplateDetail> {
  const row = await prisma.contractTemplate.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      category: true,
      active: true,
      fieldSchema: true,
      updatedAt: true,
    },
  });
  if (!row) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "合同模板不存在");
  }
  return { ...row, fields: parseFieldSchema(row.fieldSchema) };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function toFieldSchemaJson(fields: ContractField[]): Prisma.InputJsonValue {
  return fields as unknown as Prisma.InputJsonValue;
}

export async function createContractTemplate(
  input: ContractTemplateCreateInput,
  actorId: string,
): Promise<{ id: string }> {
  const existing = await prisma.contractTemplate.findUnique({
    where: { code: input.code },
    select: { id: true },
  });
  if (existing) {
    throw new AppError(ERROR_CODES.CONFLICT, "模板编码已存在");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const template = await tx.contractTemplate.create({
        data: {
          code: input.code,
          name: input.name,
          category: input.category,
          active: input.active,
          fieldSchema: toFieldSchemaJson(input.fields),
          createdBy: actorId,
          updatedBy: actorId,
        },
        select: { id: true, code: true, name: true, category: true },
      });

      await recordAudit(tx, {
        actorId,
        action: "template.create",
        entity: "ContractTemplate",
        entityId: template.id,
        after: template,
      });

      return { id: template.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(ERROR_CODES.CONFLICT, "模板编码已存在");
    }
    throw error;
  }
}

export async function updateContractTemplate(
  input: ContractTemplateUpdateInput,
  actorId: string,
): Promise<{ id: string }> {
  const current = await prisma.contractTemplate.findFirst({
    where: { id: input.id, deletedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      category: true,
      active: true,
      fieldSchema: true,
    },
  });
  if (!current) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "合同模板不存在");
  }

  return prisma.$transaction(async (tx) => {
    const template = await tx.contractTemplate.update({
      where: { id: input.id },
      data: {
        name: input.name,
        category: input.category,
        active: input.active,
        ...(input.fields === undefined
          ? {}
          : { fieldSchema: toFieldSchemaJson(input.fields) }),
        updatedBy: actorId,
      },
      select: { id: true, name: true, category: true, active: true },
    });

    await recordAudit(tx, {
      actorId,
      action: "template.update",
      entity: "ContractTemplate",
      entityId: input.id,
      before: current,
      after: template,
    });

    return { id: template.id };
  });
}

export async function updateContractTemplateFields(
  id: string,
  fields: ContractField[],
  actorId: string,
): Promise<{ id: string }> {
  const current = await prisma.contractTemplate.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, code: true, fieldSchema: true },
  });
  if (!current) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "合同模板不存在");
  }

  return prisma.$transaction(async (tx) => {
    const template = await tx.contractTemplate.update({
      where: { id },
      data: {
        fieldSchema: toFieldSchemaJson(fields),
        updatedBy: actorId,
      },
      select: { id: true, fieldSchema: true },
    });

    await recordAudit(tx, {
      actorId,
      action: "template.fields.update",
      entity: "ContractTemplate",
      entityId: id,
      before: { code: current.code, fieldSchema: current.fieldSchema },
      after: { code: current.code, fieldSchema: template.fieldSchema },
    });

    return { id: template.id };
  });
}

export async function setContractTemplateActive(
  id: string,
  active: boolean,
  actorId: string,
): Promise<{ id: string }> {
  const current = await prisma.contractTemplate.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, active: true, name: true },
  });
  if (!current) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "合同模板不存在");
  }
  if (current.active === active) {
    return { id };
  }

  return prisma.$transaction(async (tx) => {
    const template = await tx.contractTemplate.update({
      where: { id },
      data: { active, updatedBy: actorId },
      select: { id: true, active: true },
    });

    await recordAudit(tx, {
      actorId,
      action: "template.status",
      entity: "ContractTemplate",
      entityId: id,
      before: { active: current.active },
      after: { active: template.active },
    });

    return { id: template.id };
  });
}
