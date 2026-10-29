import type { Prisma } from "@/generated/prisma/client";
import { AppError, ERROR_CODES } from "@/shared/errors";
import type { AssigneeConfig } from "@/shared/flow-definition";

export type AssigneeContext = {
  initiatorId: string;
  departmentId: string | null;
  managerUserId: string | null;
  formData: Record<string, unknown>;
};

export type AssigneeResolution = {
  userIds: string[];
  levelGroups: string[][];
  notes: string[];
};

type Db = Pick<
  Prisma.TransactionClient,
  "user" | "department" | "role"
>;

function dedupe(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => id !== ""))];
}

async function filterActiveUsers(db: Db, ids: string[]): Promise<string[]> {
  const unique = dedupe(ids);
  if (unique.length === 0) {
    return [];
  }
  const rows = await db.user.findMany({
    where: { id: { in: unique }, deletedAt: null, status: "active" },
    select: { id: true },
  });
  const active = new Set(rows.map((row) => row.id));
  return unique.filter((id) => active.has(id));
}

async function resolveByEmailOrId(db: Db, tokens: string[]): Promise<string[]> {
  const unique = dedupe(tokens);
  if (unique.length === 0) {
    return [];
  }
  const rows = await db.user.findMany({
    where: {
      deletedAt: null,
      status: "active",
      OR: [{ id: { in: unique } }, { email: { in: unique } }],
    },
    select: { id: true, email: true },
  });
  const byKey = new Map<string, string>();
  for (const row of rows) {
    byKey.set(row.id, row.id);
    byKey.set(row.email, row.id);
  }
  return dedupe(unique.map((token) => byKey.get(token)).filter((id): id is string => Boolean(id)));
}

async function departmentChain(db: Db, departmentId: string | null): Promise<
  { id: string; managerUserId: string | null }[]
> {
  const chain: { id: string; managerUserId: string | null }[] = [];
  let currentId = departmentId;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const department = await db.department.findFirst({
      where: { id: currentId, deletedAt: null },
      select: { id: true, managerUserId: true, parentId: true },
    });
    if (!department) {
      break;
    }
    chain.push({ id: department.id, managerUserId: department.managerUserId });
    currentId = department.parentId;
  }
  return chain;
}

// level 按「向上第 N 个有主管的部门」计，跳过没有主管的中间部门。
async function managerAtLevel(
  db: Db,
  departmentId: string | null,
  level: number,
): Promise<string | null> {
  const chain = await departmentChain(db, departmentId);
  let seen = 0;
  for (const department of chain) {
    if (!department.managerUserId) {
      continue;
    }
    seen += 1;
    if (seen === level) {
      return department.managerUserId;
    }
  }
  return null;
}

function formFieldTokens(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/[,;]/)
      .map((token) => token.trim())
      .filter((token) => token !== "");
  }
  if (typeof value === "number") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => formFieldTokens(item));
  }
  return [];
}

export async function resolveAssignees(
  db: Db,
  config: AssigneeConfig,
  context: AssigneeContext,
): Promise<AssigneeResolution> {
  const notes: string[] = [];

  switch (config.kind) {
    case "role": {
      const role = await db.role.findFirst({
        where: { key: config.key, deletedAt: null },
        select: { id: true },
      });
      if (!role) {
        notes.push(`角色 ${config.key} 不存在`);
        return { userIds: [], levelGroups: [], notes };
      }
      const members = await db.user.findMany({
        where: {
          deletedAt: null,
          status: "active",
          userRoles: { some: { deletedAt: null, roleId: role.id } },
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      return {
        userIds: dedupe(members.map((member) => member.id)),
        levelGroups: [],
        notes,
      };
    }

    case "user": {
      const userIds = await filterActiveUsers(db, config.ids);
      for (const id of config.ids) {
        if (!userIds.includes(id)) {
          notes.push(`用户 ${id} 不存在或已停用`);
        }
      }
      return { userIds, levelGroups: [], notes };
    }

    case "initiator_self":
      return {
        userIds: await filterActiveUsers(db, [context.initiatorId]),
        levelGroups: [],
        notes,
      };

    case "dept_manager": {
      const manager = await managerAtLevel(db, context.departmentId, config.level);
      if (!manager) {
        notes.push(`向上第 ${config.level} 级部门没有主管`);
        return { userIds: [], levelGroups: [], notes };
      }
      const userIds = await filterActiveUsers(db, [manager]);
      if (userIds.length === 0) {
        notes.push(`第 ${config.level} 级主管账号不可用`);
      }
      return { userIds, levelGroups: [], notes };
    }

    case "multi_level_leader": {
      const chain = await departmentChain(db, context.departmentId);
      const levelGroups: string[][] = [];
      let seen = 0;
      for (const department of chain) {
        if (levelGroups.length >= Math.max(0, config.toLevel - config.fromLevel + 1)) {
          break;
        }
        if (!department.managerUserId) {
          continue;
        }
        seen += 1;
        if (seen < config.fromLevel) {
          continue;
        }
        const userIds = await filterActiveUsers(db, [department.managerUserId]);
        if (userIds.length === 0) {
          notes.push(`第 ${seen} 级主管账号不可用，已跳过`);
          continue;
        }
        levelGroups.push(userIds);
      }
      const missing = config.toLevel - (levelGroups.length + config.fromLevel - 1);
      if (missing > 0) {
        notes.push(`只解析到 ${levelGroups.length} 级主管，配置要求到第 ${config.toLevel} 级`);
      }
      const userIds = dedupe(levelGroups.flat());
      return { userIds, levelGroups: userIds.length > 0 ? levelGroups : [], notes };
    }

    case "form_field": {
      const tokens = formFieldTokens(context.formData[config.field]);
      if (tokens.length === 0) {
        notes.push(`表单字段 ${config.field} 没有填写审批人`);
        return { userIds: [], levelGroups: [], notes };
      }
      const userIds = await resolveByEmailOrId(db, tokens);
      if (userIds.length < tokens.length) {
        notes.push(`表单字段 ${config.field} 中部分人员无法匹配到有效账号`);
      }
      return { userIds, levelGroups: [], notes };
    }

    case "expression": {
      const expression = config.expression.trim();
      if (expression === "initiator.manager") {
        if (!context.managerUserId) {
          notes.push("发起人没有直属上级");
          return { userIds: [], levelGroups: [], notes };
        }
        return {
          userIds: await filterActiveUsers(db, [context.managerUserId]),
          levelGroups: [],
          notes,
        };
      }
      if (expression === "initiator.dept_manager") {
        return resolveAssignees(
          db,
          { kind: "dept_manager", level: 1 },
          context,
        );
      }
      const formMatch = /^form\.([A-Za-z0-9_]+)$/.exec(expression);
      if (formMatch?.[1]) {
        return resolveAssignees(
          db,
          { kind: "form_field", field: formMatch[1] },
          context,
        );
      }
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `不支持的审批人表达式：${expression}`,
      );
    }
  }
}

export function assigneeSummary(config: AssigneeConfig): string {
  switch (config.kind) {
    case "role":
      return `角色 ${config.key}`;
    case "user":
      return `指定 ${config.ids.length} 人`;
    case "dept_manager":
      return `向上第 ${config.level} 级主管`;
    case "multi_level_leader":
      return `第 ${config.fromLevel}-${config.toLevel} 级主管链`;
    case "initiator_self":
      return "发起人本人";
    case "form_field":
      return `表单字段 ${config.field}`;
    case "expression":
      return config.expression;
  }
}
