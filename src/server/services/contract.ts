import type { Prisma } from "@/generated/prisma/client";
import type { AccessContext } from "@/server/auth/access";
import { buildContractScope } from "@/server/auth/access";
import { AppError, ERROR_CODES, ValidationError } from "@/shared/errors";
import {
  formatContractFieldValue,
  parseFieldSchema,
  validateContractFormValues,
  type ContractField,
  type ContractFormData,
} from "@/shared/contract-fields";
import { isEditableContractStatus } from "@/shared/contract-status";
import { Decimal, toDecimal } from "@/shared/money";
import type {
  ContractDraftInput,
  ContractListQuery,
  ContractUpdateInput,
} from "@/shared/schemas/contract";
import type { ContractStatus } from "@/shared/state-machines";
import { recordAudit } from "@/server/audit";
import { prisma } from "@/server/db/client";
import { allocateContractNo } from "./contract-number";

const MAX_AMOUNT = new Decimal("9999999999999999.99");

export type ContractListItem = {
  id: string;
  no: string;
  title: string;
  status: ContractStatus;
  stage: string;
  amount: string;
  currency: string;
  signDate: Date;
  endDate: Date;
  updatedAt: Date;
  partyAName: string;
  partyBName: string;
  templateName: string;
  creatorName: string;
};

export type ContractListResult = {
  items: ContractListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type AttachmentView = {
  id: string;
  kind: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  createdAt: Date;
  uploaderName: string;
};

export type ContractDetail = {
  id: string;
  no: string;
  title: string;
  status: ContractStatus;
  stage: string;
  amount: string;
  currency: string;
  signDate: Date;
  startDate: Date;
  endDate: Date;
  createdAt: Date;
  updatedAt: Date;
  template: {
    id: string;
    code: string;
    name: string;
    category: string;
    fields: ContractField[];
  };
  typeName: string;
  typeId: string;
  partyA: { id: string; name: string; uscc: string | null; type: string };
  partyB: { id: string; name: string; uscc: string | null; type: string };
  creator: { id: string; name: string; departmentName: string | null };
  formData: Record<string, unknown>;
  formEntries: {
    key: string;
    label: string;
    type: ContractField["type"];
    value: string;
  }[];
  latestVersion: {
    version: number;
    bodyMarkdown: string;
    changeSummary: string | null;
    createdAt: Date;
  } | null;
  versionCount: number;
  attachments: AttachmentView[];
};

function requireContractPermission(
  access: AccessContext,
  key: "contract.create" | "contract.read" | "contract.update",
): void {
  if (!access.permissions.has(key)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "没有执行该操作的权限");
  }
}

function readJsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function parseAmount(value: string): Decimal {
  const amount = toDecimal(value);
  if (amount.greaterThan(MAX_AMOUNT) || amount.decimalPlaces() > 2) {
    throw new ValidationError("金额超出允许范围", {
      amount: "金额超出允许范围",
    });
  }
  return amount;
}

async function assertTypeAvailable(typeId: string): Promise<void> {
  const type = await prisma.contractType.findFirst({
    where: { id: typeId, deletedAt: null, active: true },
    select: { id: true },
  });
  if (!type) {
    throw new ValidationError("合同类型不存在或已停用", {
      typeId: "合同类型不存在或已停用",
    });
  }
}

async function assertPartiesAvailable(
  partyAId: string,
  partyBId: string,
): Promise<void> {
  const parties = await prisma.party.findMany({
    where: { id: { in: [partyAId, partyBId] }, deletedAt: null },
    select: { id: true },
  });
  const found = new Set(parties.map((party) => party.id));
  if (!found.has(partyAId)) {
    throw new ValidationError("甲方不存在", { partyAId: "甲方不存在" });
  }
  if (!found.has(partyBId)) {
    throw new ValidationError("乙方不存在", { partyBId: "乙方不存在" });
  }
}

function validateFormData(
  fieldSchema: Prisma.JsonValue,
  formData: Record<string, unknown>,
): ContractFormData {
  const fields = parseFieldSchema(fieldSchema);
  const result = validateContractFormValues(fields, formData);
  if (result.ok) {
    return result.data;
  }
  const errors: Record<string, string> = {};
  for (const [key, message] of Object.entries(result.errors)) {
    errors[`formData.${key}`] = message;
  }
  throw new ValidationError("表单填写有误", errors);
}

async function getScopedContract(
  access: AccessContext,
  contractId: string,
): Promise<{
  id: string;
  no: string;
  status: ContractStatus;
  templateId: string;
  createdBy: string;
}> {
  const contract = await prisma.contract.findFirst({
    where: { id: contractId, deletedAt: null },
    select: {
      id: true,
      no: true,
      status: true,
      templateId: true,
      createdBy: true,
    },
  });
  if (!contract) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "合同不存在");
  }

  const scope = await buildContractScope(access);
  const inScope = await prisma.contract.count({
    where: { AND: [{ id: contractId }, scope] },
  });
  if (inScope === 0) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "无权访问该合同");
  }

  return contract;
}

export async function listContracts(
  access: AccessContext,
  query: ContractListQuery,
): Promise<ContractListResult> {
  requireContractPermission(access, "contract.read");

  const scope = await buildContractScope(access);
  const conditions: Prisma.ContractWhereInput[] = [scope];

  if (query.status) {
    conditions.push({ status: query.status });
  }
  if (query.q) {
    const q = query.q;
    conditions.push({
      OR: [
        { no: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { partyA: { is: { name: { contains: q, mode: "insensitive" } } } },
        { partyB: { is: { name: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }

  const where: Prisma.ContractWhereInput = { deletedAt: null, AND: conditions };
  const pageSize = query.pageSize;
  const orderBy: Prisma.ContractOrderByWithRelationInput[] = [
    query.sort === "amount"
      ? { amount: query.order }
      : query.sort === "createdAt"
        ? { createdAt: query.order }
        : query.sort === "endDate"
          ? { endDate: query.order }
          : { updatedAt: query.order },
    { id: "asc" },
  ];

  const [total, rows] = await prisma.$transaction([
    prisma.contract.count({ where }),
    prisma.contract.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        no: true,
        title: true,
        status: true,
        stage: true,
        amount: true,
        currency: true,
        signDate: true,
        endDate: true,
        updatedAt: true,
        partyA: { select: { name: true } },
        partyB: { select: { name: true } },
        template: { select: { name: true } },
        creator: { select: { name: true } },
      },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      no: row.no,
      title: row.title,
      status: row.status,
      stage: row.stage,
      amount: row.amount.toFixed(2),
      currency: row.currency,
      signDate: row.signDate,
      endDate: row.endDate,
      updatedAt: row.updatedAt,
      partyAName: row.partyA.name,
      partyBName: row.partyB.name,
      templateName: row.template.name,
      creatorName: row.creator.name,
    })),
    total,
    page: query.page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getContractDetail(
  access: AccessContext,
  contractId: string,
): Promise<ContractDetail> {
  requireContractPermission(access, "contract.read");

  const scope = await buildContractScope(access);
  const row = await prisma.contract.findFirst({
    where: { id: contractId, deletedAt: null, AND: [scope] },
    select: {
      id: true,
      no: true,
      title: true,
      status: true,
      stage: true,
      amount: true,
      currency: true,
      signDate: true,
      startDate: true,
      endDate: true,
      formData: true,
      createdAt: true,
      updatedAt: true,
      template: {
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
          fieldSchema: true,
        },
      },
      type: { select: { id: true, name: true } },
      partyA: {
        select: { id: true, name: true, uscc: true, type: true },
      },
      partyB: {
        select: { id: true, name: true, uscc: true, type: true },
      },
      creator: {
        select: {
          id: true,
          name: true,
          department: { select: { name: true } },
        },
      },
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: {
          version: true,
          bodyMarkdown: true,
          changeSummary: true,
          createdAt: true,
        },
      },
      _count: { select: { versions: true } },
      attachments: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          name: true,
          mime: true,
          size: true,
          sha256: true,
          createdAt: true,
          uploadedBy: true,
        },
      },
    },
  });

  if (!row) {
    const exists = await prisma.contract.count({
      where: { id: contractId, deletedAt: null },
    });
    if (exists === 0) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "合同不存在");
    }
    throw new AppError(ERROR_CODES.FORBIDDEN, "无权访问该合同");
  }

  const fields = parseFieldSchema(row.template.fieldSchema);
  const formData = readJsonObject(row.formData);

  const uploaderIds = [...new Set(row.attachments.map((item) => item.uploadedBy))];
  const uploaders =
    uploaderIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: uploaderIds } },
          select: { id: true, name: true },
        });
  const uploaderNames = new Map(
    uploaders.map((uploader) => [uploader.id, uploader.name]),
  );

  return {
    id: row.id,
    no: row.no,
    title: row.title,
    status: row.status,
    stage: row.stage,
    amount: row.amount.toFixed(2),
    currency: row.currency,
    signDate: row.signDate,
    startDate: row.startDate,
    endDate: row.endDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    template: {
      id: row.template.id,
      code: row.template.code,
      name: row.template.name,
      category: row.template.category,
      fields,
    },
    typeName: row.type.name,
    typeId: row.type.id,
    partyA: row.partyA,
    partyB: row.partyB,
    creator: {
      id: row.creator.id,
      name: row.creator.name,
      departmentName: row.creator.department?.name ?? null,
    },
    formData,
    formEntries: fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      value: formatContractFieldValue(field, formData[field.key]),
    })),
    latestVersion: row.versions[0] ?? null,
    versionCount: row._count.versions,
    attachments: row.attachments.map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
      sha256: attachment.sha256,
      createdAt: attachment.createdAt,
      uploaderName: uploaderNames.get(attachment.uploadedBy) ?? "系统",
    })),
  };
}

export async function createContract(
  access: AccessContext,
  input: ContractDraftInput,
): Promise<{ id: string; no: string }> {
  requireContractPermission(access, "contract.create");

  const template = await prisma.contractTemplate.findFirst({
    where: { id: input.templateId, deletedAt: null },
    select: { id: true, code: true, active: true, fieldSchema: true },
  });
  if (!template) {
    throw new ValidationError("合同模板不存在", {
      templateId: "合同模板不存在",
    });
  }
  if (!template.active) {
    throw new ValidationError("合同模板已停用", {
      templateId: "合同模板已停用",
    });
  }

  await Promise.all([
    assertTypeAvailable(input.typeId),
    assertPartiesAvailable(input.partyAId, input.partyBId),
  ]);

  const formData = validateFormData(template.fieldSchema, input.formData);
  const amount = parseAmount(input.amount);

  return prisma.$transaction(async (tx) => {
    const no = await allocateContractNo(tx, template.code);
    const contract = await tx.contract.create({
      data: {
        no,
        title: input.title,
        templateId: template.id,
        typeId: input.typeId,
        partyAId: input.partyAId,
        partyBId: input.partyBId,
        amount,
        currency: input.currency,
        signDate: parseDateOnly(input.signDate),
        startDate: parseDateOnly(input.startDate),
        endDate: parseDateOnly(input.endDate),
        status: "draft",
        stage: "normal",
        formData: formData as Prisma.InputJsonValue,
        ownerDepartmentId: access.departmentId,
        createdBy: access.userId,
        updatedBy: access.userId,
      },
      select: { id: true, no: true, title: true, amount: true, status: true },
    });

    await tx.contractVersion.create({
      data: {
        contractId: contract.id,
        version: 1,
        bodyMarkdown: input.bodyMarkdown,
        changeSummary: "初始版本",
        createdBy: access.userId,
        updatedBy: access.userId,
      },
    });

    await tx.contractParticipant.create({
      data: {
        contractId: contract.id,
        userId: access.userId,
        kind: "initiator",
      },
    });

    await recordAudit(tx, {
      actorId: access.userId,
      action: "contract.create",
      entity: "Contract",
      entityId: contract.id,
      after: {
        no: contract.no,
        title: contract.title,
        amount: contract.amount.toFixed(2),
        status: contract.status,
      },
    });

    return { id: contract.id, no: contract.no };
  });
}

export async function requireEditableContract(
  access: AccessContext,
  contractId: string,
): Promise<{
  id: string;
  no: string;
  status: ContractStatus;
  templateId: string;
  createdBy: string;
}> {
  requireContractPermission(access, "contract.update");
  const contract = await getScopedContract(access, contractId);
  if (!isEditableContractStatus(contract.status)) {
    throw new AppError(ERROR_CODES.CONFLICT, "仅草稿或被驳回的合同可以编辑");
  }
  return contract;
}

export async function updateContract(
  access: AccessContext,
  input: ContractUpdateInput,
): Promise<{ id: string; no: string }> {
  const current = await requireEditableContract(access, input.id);
  if (input.templateId !== current.templateId) {
    throw new ValidationError("合同模板创建后不可更换", {
      templateId: "合同模板创建后不可更换",
    });
  }

  const template = await prisma.contractTemplate.findUnique({
    where: { id: current.templateId },
    select: { fieldSchema: true },
  });
  if (!template) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "合同模板不存在");
  }

  await Promise.all([
    assertTypeAvailable(input.typeId),
    assertPartiesAvailable(input.partyAId, input.partyBId),
  ]);

  const formData = validateFormData(template.fieldSchema, input.formData);
  const amount = parseAmount(input.amount);

  return prisma.$transaction(async (tx) => {
    const contract = await tx.contract.update({
      where: { id: input.id },
      data: {
        title: input.title,
        typeId: input.typeId,
        partyAId: input.partyAId,
        partyBId: input.partyBId,
        amount,
        currency: input.currency,
        signDate: parseDateOnly(input.signDate),
        startDate: parseDateOnly(input.startDate),
        endDate: parseDateOnly(input.endDate),
        formData: formData as Prisma.InputJsonValue,
        updatedBy: access.userId,
      },
      select: {
        id: true,
        no: true,
        title: true,
        amount: true,
        status: true,
        updatedAt: true,
      },
    });

    const versionOne = await tx.contractVersion.findFirst({
      where: { contractId: input.id, version: 1 },
      select: { id: true },
    });
    if (versionOne) {
      await tx.contractVersion.update({
        where: { id: versionOne.id },
        data: {
          bodyMarkdown: input.bodyMarkdown,
          updatedBy: access.userId,
        },
      });
    } else {
      await tx.contractVersion.create({
        data: {
          contractId: input.id,
          version: 1,
          bodyMarkdown: input.bodyMarkdown,
          changeSummary: "初始版本",
          createdBy: access.userId,
          updatedBy: access.userId,
        },
      });
    }

    await recordAudit(tx, {
      actorId: access.userId,
      action: "contract.update",
      entity: "Contract",
      entityId: contract.id,
      before: { no: current.no, status: current.status },
      after: {
        no: contract.no,
        title: contract.title,
        amount: contract.amount.toFixed(2),
        status: contract.status,
      },
    });

    return { id: contract.id, no: contract.no };
  });
}

export async function findSimilarContracts(
  access: AccessContext,
  contractId: string,
): Promise<
  {
    id: string;
    no: string;
    title: string;
    status: ContractStatus;
    amount: string;
    currency: string;
    signDate: Date;
    partyBName: string;
  }[]
> {
  requireContractPermission(access, "contract.read");

  const scope = await buildContractScope(access);
  const base = await prisma.contract.findFirst({
    where: { id: contractId, deletedAt: null, AND: [scope] },
    select: {
      id: true,
      partyAId: true,
      partyBId: true,
      amount: true,
      signDate: true,
    },
  });
  if (!base) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "合同不存在或无权访问");
  }

  const rows = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      id: { not: base.id },
      partyAId: base.partyAId,
      partyBId: base.partyBId,
      OR: [{ amount: base.amount }, { signDate: base.signDate }],
      AND: [scope],
    },
    orderBy: { signDate: "desc" },
    take: 5,
    select: {
      id: true,
      no: true,
      title: true,
      status: true,
      amount: true,
      currency: true,
      signDate: true,
      partyB: { select: { name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    no: row.no,
    title: row.title,
    status: row.status,
    amount: row.amount.toFixed(2),
    currency: row.currency,
    signDate: row.signDate,
    partyBName: row.partyB.name,
  }));
}

export async function listContractFormOptions(access: AccessContext): Promise<{
  templates: {
    id: string;
    code: string;
    name: string;
    category: string;
    fields: ContractField[];
  }[];
  types: { id: string; key: string; name: string }[];
  parties: { id: string; name: string; type: string; uscc: string | null }[];
}> {
  if (
    !access.permissions.has("contract.create") &&
    !access.permissions.has("contract.update")
  ) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "没有执行该操作的权限");
  }

  const [templates, types, parties] = await Promise.all([
    prisma.contractTemplate.findMany({
      where: { deletedAt: null, active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        category: true,
        fieldSchema: true,
      },
    }),
    prisma.contractType.findMany({
      where: { deletedAt: null, active: true },
      orderBy: { name: "asc" },
      select: { id: true, key: true, name: true },
    }),
    prisma.party.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true, uscc: true },
    }),
  ]);

  return {
    templates: templates.map((template) => ({
      id: template.id,
      code: template.code,
      name: template.name,
      category: template.category,
      fields: parseFieldSchema(template.fieldSchema),
    })),
    types,
    parties,
  };
}
