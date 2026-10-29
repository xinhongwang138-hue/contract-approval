import { z } from "zod";
import type { PartyType, Prisma } from "@/generated/prisma/client";
import { AppError, ERROR_CODES } from "@/shared/errors";
import {
  partyContactSchema,
  type PartyContactInput,
  type PartyFormInput,
} from "@/shared/schemas/party";
import { recordAudit } from "@/server/audit";
import { prisma } from "@/server/db/client";

export const PARTIES_PAGE_SIZE = 20;

export type PartyListItem = {
  id: string;
  name: string;
  uscc: string | null;
  type: PartyType;
  address: string | null;
  contacts: PartyContactInput[];
  contractCount: number;
  updatedAt: Date;
};

export type PartyListResult = {
  items: PartyListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const contactsValidator = z.array(partyContactSchema);

function parseContacts(value: Prisma.JsonValue): PartyContactInput[] {
  const parsed = contactsValidator.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export async function listParties(params: {
  search?: string;
  type?: PartyType;
  page: number;
}): Promise<PartyListResult> {
  const where = {
    deletedAt: null,
    ...(params.type ? { type: params.type } : {}),
    ...(params.search
      ? {
          OR: [
            { name: { contains: params.search, mode: "insensitive" as const } },
            { uscc: { contains: params.search.toUpperCase() } },
          ],
        }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.party.count({ where }),
    prisma.party.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (params.page - 1) * PARTIES_PAGE_SIZE,
      take: PARTIES_PAGE_SIZE,
      select: {
        id: true,
        name: true,
        uscc: true,
        type: true,
        address: true,
        contacts: true,
        updatedAt: true,
        _count: {
          select: {
            contractsAsPartyA: { where: { deletedAt: null } },
            contractsAsPartyB: { where: { deletedAt: null } },
          },
        },
      },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      uscc: row.uscc,
      type: row.type,
      address: row.address,
      contacts: parseContacts(row.contacts),
      contractCount:
        row._count.contractsAsPartyA + row._count.contractsAsPartyB,
      updatedAt: row.updatedAt,
    })),
    total,
    page: params.page,
    pageSize: PARTIES_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PARTIES_PAGE_SIZE)),
  };
}

async function assertUsccAvailable(
  uscc: string | null | undefined,
  excludeId?: string,
): Promise<void> {
  if (!uscc) {
    return;
  }
  const existing = await prisma.party.findFirst({
    where: {
      uscc,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, deletedAt: true },
  });
  if (existing) {
    throw new AppError(ERROR_CODES.CONFLICT, "统一社会信用代码已存在");
  }
}

export async function createParty(
  input: PartyFormInput,
  actorId: string,
): Promise<{ id: string }> {
  await assertUsccAvailable(input.uscc);

  return prisma.$transaction(async (tx) => {
    const party = await tx.party.create({
      data: {
        name: input.name,
        uscc: input.uscc ?? null,
        type: input.type,
        address: input.address ?? null,
        contacts: input.contacts as unknown as Prisma.InputJsonValue,
        createdBy: actorId,
        updatedBy: actorId,
      },
      select: { id: true, name: true, uscc: true, type: true },
    });

    await recordAudit(tx, {
      actorId,
      action: "party.create",
      entity: "Party",
      entityId: party.id,
      after: party,
    });

    return { id: party.id };
  });
}

export async function updateParty(
  input: PartyFormInput & { id: string },
  actorId: string,
): Promise<{ id: string }> {
  const current = await prisma.party.findFirst({
    where: { id: input.id, deletedAt: null },
    select: {
      id: true,
      name: true,
      uscc: true,
      type: true,
      address: true,
      contacts: true,
    },
  });
  if (!current) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "相对方不存在");
  }

  await assertUsccAvailable(input.uscc, input.id);

  return prisma.$transaction(async (tx) => {
    const party = await tx.party.update({
      where: { id: input.id },
      data: {
        name: input.name,
        uscc: input.uscc ?? null,
        type: input.type,
        address: input.address ?? null,
        contacts: input.contacts as unknown as Prisma.InputJsonValue,
        updatedBy: actorId,
      },
      select: { id: true, name: true, uscc: true, type: true },
    });

    await recordAudit(tx, {
      actorId,
      action: "party.update",
      entity: "Party",
      entityId: input.id,
      before: current,
      after: party,
    });

    return { id: party.id };
  });
}

export async function deleteParty(
  id: string,
  actorId: string,
): Promise<{ id: string }> {
  const party = await prisma.party.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, uscc: true },
  });
  if (!party) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "相对方不存在");
  }

  const contractCount = await prisma.contract.count({
    where: {
      deletedAt: null,
      OR: [{ partyAId: id }, { partyBId: id }],
    },
  });
  if (contractCount > 0) {
    throw new AppError(ERROR_CODES.CONFLICT, "该相对方已被合同引用，无法删除");
  }

  await prisma.$transaction(async (tx) => {
    await tx.party.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: actorId },
    });
    await recordAudit(tx, {
      actorId,
      action: "party.delete",
      entity: "Party",
      entityId: id,
      before: party,
    });
  });

  return { id };
}
