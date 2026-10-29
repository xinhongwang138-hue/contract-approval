"use server";

import { getAccessContext } from "@/server/auth/access";
import { requireAuth } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { AppError, ERROR_CODES, type ActionResult } from "@/shared/errors";
import { toFailure } from "./helpers";

export type UserOption = {
  id: string;
  name: string;
  email: string;
  departmentName: string | null;
};

const PICKER_PERMISSIONS = [
  "contract.approve",
  "flow.manage",
  "system.user.manage",
] as const;

export async function searchUsersAction(
  query: string,
): Promise<ActionResult<UserOption[]>> {
  try {
    const { user } = await requireAuth();
    const access = await getAccessContext(user.id);
    if (!PICKER_PERMISSIONS.some((key) => access.permissions.has(key))) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "没有查询人员的权限");
    }

    const keyword = query.trim();
    const rows = await prisma.user.findMany({
      where: {
        deletedAt: null,
        status: "active",
        ...(keyword === ""
          ? {}
          : {
              OR: [
                { name: { contains: keyword, mode: "insensitive" } },
                { email: { contains: keyword, mode: "insensitive" } },
              ],
            }),
      },
      orderBy: { name: "asc" },
      take: 20,
      select: {
        id: true,
        name: true,
        email: true,
        department: { select: { name: true } },
      },
    });

    return {
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        departmentName: row.department?.name ?? null,
      })),
    };
  } catch (error) {
    return toFailure(error);
  }
}
