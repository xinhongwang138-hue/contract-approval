import { Prisma } from "@/generated/prisma/client";
import {
  flowDefinitionSchema,
  type FlowDefinition,
} from "@/shared/flow-definition";
import { AppError, ERROR_CODES, ValidationError } from "@/shared/errors";
import type {
  FlowCreateInput,
  FlowDraftInput,
  FlowUpdateInput,
} from "@/shared/schemas/flow";
import { recordAudit } from "@/server/audit";
import { prisma } from "@/server/db/client";
import {
  validateFlowDefinition,
  type FlowValidationIssue,
} from "@/server/flow/validate";

export type FlowListItem = {
  id: string;
  name: string;
  code: string;
  category: string;
  latestVersion: number;
  activeVersion: number | null;
  nodeCount: number;
  templateCount: number;
  instanceCount: number;
  updatedAt: Date;
};

export type FlowDetail = {
  id: string;
  name: string;
  code: string;
  category: string;
  latestVersion: number;
  activeVersion: number | null;
  draftDefinition: unknown;
  draftIssues: FlowValidationIssue[];
  updatedAt: Date;
};

export type FlowVersionItem = {
  id: string;
  version: number;
  status: string;
  publishedAt: Date;
  publishedByName: string;
  nodeCount: number;
  instanceCount: number;
  definition: unknown;
};

export type FlowOption = { id: string; name: string; code: string; latestVersion: number };

export type FlowActorOptions = {
  roles: { key: string; name: string }[];
  users: { id: string; name: string; email: string; departmentName: string | null }[];
};

function collectReferencedUserIds(definition: unknown): string[] {
  const nodes = (definition as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) {
    return [];
  }
  const ids = new Set<string>();
  for (const node of nodes) {
    const assignee = (node as { assignee?: { ids?: unknown } } | null)?.assignee;
    if (Array.isArray(assignee?.ids)) {
      for (const id of assignee.ids) {
        if (typeof id === "string") {
          ids.add(id);
        }
      }
    }
  }
  return [...ids];
}

export async function listFlowActorOptions(definition: unknown): Promise<FlowActorOptions> {
  const referencedUserIds = collectReferencedUserIds(definition);
  const [roles, users] = await Promise.all([
    prisma.role.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { key: true, name: true },
    }),
    prisma.user.findMany({
      where: { id: { in: referencedUserIds } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        department: { select: { name: true } },
      },
    }),
  ]);

  return {
    roles,
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      departmentName: user.department?.name ?? null,
    })),
  };
}

function countNodes(raw: unknown): number {
  const nodes = (raw as { nodes?: unknown[] } | null)?.nodes;
  return Array.isArray(nodes) ? nodes.length : 0;
}

function toDefinition(raw: unknown): FlowDefinition | null {
  const parsed = flowDefinitionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function listFlows(): Promise<FlowListItem[]> {
  const rows = await prisma.approvalFlow.findMany({
    where: { deletedAt: null },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      name: true,
      code: true,
      category: true,
      latestVersion: true,
      draftDefinition: true,
      updatedAt: true,
      versions: {
        where: { status: "active", deletedAt: null },
        select: { version: true },
        take: 1,
      },
      _count: {
        select: {
          templates: { where: { deletedAt: null } },
          instances: { where: { deletedAt: null } },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    category: row.category,
    latestVersion: row.latestVersion,
    activeVersion: row.versions[0]?.version ?? null,
    nodeCount: countNodes(row.draftDefinition),
    templateCount: row._count.templates,
    instanceCount: row._count.instances,
    updatedAt: row.updatedAt,
  }));
}

export async function listFlowOptions(): Promise<FlowOption[]> {
  const rows = await prisma.approvalFlow.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true, latestVersion: true },
  });
  return rows;
}

export async function getFlow(id: string): Promise<FlowDetail> {
  const row = await prisma.approvalFlow.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      code: true,
      category: true,
      latestVersion: true,
      draftDefinition: true,
      updatedAt: true,
      versions: {
        where: { status: "active", deletedAt: null },
        select: { version: true },
        take: 1,
      },
    },
  });
  if (!row) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "审批流程不存在");
  }

  const definition = toDefinition(row.draftDefinition);
  const issues = definition
    ? await collectPublishIssues(definition)
    : validateFlowDefinition(row.draftDefinition);

  return {
    id: row.id,
    name: row.name,
    code: row.code,
    category: row.category,
    latestVersion: row.latestVersion,
    activeVersion: row.versions[0]?.version ?? null,
    draftDefinition: row.draftDefinition,
    draftIssues: issues,
    updatedAt: row.updatedAt,
  };
}

export async function listFlowVersions(flowId: string): Promise<FlowVersionItem[]> {
  const rows = await prisma.approvalFlowVersion.findMany({
    where: { flowId, deletedAt: null },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      status: true,
      publishedAt: true,
      publishedBy: true,
      definition: true,
      _count: { select: { instances: { where: { deletedAt: null } } } },
    },
  });

  const publishers = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.publishedBy))] } },
    select: { id: true, name: true },
  });
  const names = new Map(publishers.map((user) => [user.id, user.name]));

  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    status: row.status,
    publishedAt: row.publishedAt,
    publishedByName: names.get(row.publishedBy) ?? "未知用户",
    nodeCount: countNodes(row.definition),
    instanceCount: row._count.instances,
    definition: row.definition,
  }));
}

export async function createFlow(
  input: FlowCreateInput,
  actorId: string,
): Promise<{ id: string; code: string }> {
  const existing = await prisma.approvalFlow.findFirst({
    where: { code: input.code, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    throw new ValidationError("流程编码已存在", { code: "流程编码已存在" });
  }

  const starter = {
    schemaVersion: 1,
    entry: "start",
    nodes: [
      { id: "start", type: "start", name: "发起", next: "end" },
      { id: "end", type: "end", name: "结束", result: "approved" },
    ],
  };

  const flow = await prisma.approvalFlow.create({
    data: {
      name: input.name,
      code: input.code,
      category: input.category,
      draftDefinition: starter as Prisma.InputJsonValue,
      createdBy: actorId,
    },
    select: { id: true, code: true },
  });

  await recordAudit(prisma, {
    actorId,
    action: "flow.create",
    entity: "ApprovalFlow",
    entityId: flow.id,
    after: { code: flow.code, name: input.name, category: input.category },
  });

  return flow;
}

export async function updateFlow(
  input: FlowUpdateInput,
  actorId: string,
): Promise<{ id: string }> {
  const current = await prisma.approvalFlow.findFirst({
    where: { id: input.id, deletedAt: null },
    select: { id: true, name: true, category: true },
  });
  if (!current) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "审批流程不存在");
  }

  await prisma.approvalFlow.update({
    where: { id: input.id },
    data: { name: input.name, category: input.category, updatedBy: actorId },
  });

  await recordAudit(prisma, {
    actorId,
    action: "flow.update",
    entity: "ApprovalFlow",
    entityId: input.id,
    before: { name: current.name, category: current.category },
    after: { name: input.name, category: input.category },
  });

  return { id: input.id };
}

export async function saveFlowDraft(
  input: FlowDraftInput,
  actorId: string,
): Promise<{ id: string; issues: FlowValidationIssue[] }> {
  const current = await prisma.approvalFlow.findFirst({
    where: { id: input.id, deletedAt: null },
    select: { id: true, draftDefinition: true },
  });
  if (!current) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "审批流程不存在");
  }

  await prisma.approvalFlow.update({
    where: { id: input.id },
    data: {
      draftDefinition: input.definition as unknown as Prisma.InputJsonValue,
      updatedBy: actorId,
    },
  });

  await recordAudit(prisma, {
    actorId,
    action: "flow.draft.update",
    entity: "ApprovalFlow",
    entityId: input.id,
    before: { nodeCount: countNodes(current.draftDefinition) },
    after: { nodeCount: countNodes(input.definition) },
  });

  const definition = toDefinition(input.definition);
  const issues = definition
    ? validateFlowDefinition(definition)
    : validateFlowDefinition(input.definition);

  return { id: input.id, issues };
}

export async function collectPublishIssues(
  definition: FlowDefinition,
): Promise<FlowValidationIssue[]> {
  const issues = validateFlowDefinition(definition);

  const roleKeys = [
    ...new Set(
      definition.nodes.flatMap((node) =>
        (node.type === "approval" || node.type === "cc") &&
        node.assignee.kind === "role"
          ? [node.assignee.key]
          : [],
      ),
    ),
  ];

  const roleRows =
    roleKeys.length === 0
      ? []
      : await prisma.role.findMany({
          where: { key: { in: roleKeys }, deletedAt: null },
          select: {
            key: true,
            _count: {
              select: {
                userRoles: {
                  where: {
                    deletedAt: null,
                    user: { deletedAt: null, status: "active" },
                  },
                },
              },
            },
          },
        });

  const userIds = definition.nodes.flatMap((node) =>
    (node.type === "approval" || node.type === "cc") &&
    node.assignee.kind === "user"
      ? node.assignee.ids
      : [],
  );
  const activeUsers =
    userIds.length === 0
      ? new Set<string>()
      : new Set(
          (
            await prisma.user.findMany({
              where: {
                id: { in: [...new Set(userIds)] },
                deletedAt: null,
                status: "active",
              },
              select: { id: true },
            })
          ).map((user) => user.id),
        );

  for (const node of definition.nodes) {
    if (node.type !== "approval" && node.type !== "cc") {
      continue;
    }
    const assignee = node.assignee;

    if (assignee.kind === "role") {
      const role = roleRows.find((row) => row.key === assignee.key);
      if (!role) {
        issues.push({
          level: "error",
          code: "ASSIGNEE_ROLE_MISSING",
          message: `节点「${node.name}」引用的角色 ${assignee.key} 不存在`,
          nodeId: node.id,
        });
      } else if (role._count.userRoles === 0) {
        issues.push({
          level: "error",
          code: "EMPTY_APPROVER",
          message: `节点「${node.name}」的角色 ${assignee.key} 没有可用成员`,
          nodeId: node.id,
        });
      }
      continue;
    }

    if (assignee.kind === "user") {
      const missing = assignee.ids.filter((id) => !activeUsers.has(id));
      if (missing.length > 0) {
        issues.push({
          level: "error",
          code: "ASSIGNEE_USER_MISSING",
          message: `节点「${node.name}」的指定人员中有 ${missing.length} 位不可用`,
          nodeId: node.id,
        });
      }
      continue;
    }

    if (assignee.kind === "form_field") {
      issues.push({
        level: "warning",
        code: "ASSIGNEE_RUNTIME",
        message: `节点「${node.name}」的审批人来自表单字段 ${assignee.field}，提交时才会解析`,
        nodeId: node.id,
      });
    }
  }

  return issues;
}

export async function publishFlow(
  id: string,
  actorId: string,
): Promise<{ id: string; version: number }> {
  const flow = await prisma.approvalFlow.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, code: true, name: true, draftDefinition: true },
  });
  if (!flow) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "审批流程不存在");
  }

  const definition = toDefinition(flow.draftDefinition);
  if (!definition) {
    const issues = validateFlowDefinition(flow.draftDefinition);
    throwPublishRejected(issues);
  }

  const parsed = definition as FlowDefinition;
  throwPublishRejected(await collectPublishIssues(parsed));

  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.approvalFlow.findFirstOrThrow({
        where: { id: flow.id },
        select: { latestVersion: true },
      });
      const version = locked.latestVersion + 1;

      const created = await tx.approvalFlowVersion.create({
        data: {
          flowId: flow.id,
          version,
          definition: parsed as unknown as Prisma.InputJsonValue,
          publishedBy: actorId,
          status: "active",
          createdBy: actorId,
        },
        select: { id: true },
      });

      await tx.approvalFlowVersion.updateMany({
        where: {
          flowId: flow.id,
          status: "active",
          version: { lt: version },
          deletedAt: null,
        },
        data: { status: "archived", updatedBy: actorId },
      });

      await tx.approvalFlow.update({
        where: { id: flow.id },
        data: { latestVersion: version, updatedBy: actorId },
      });

      await recordAudit(tx, {
        actorId,
        action: "flow.publish",
        entity: "ApprovalFlow",
        entityId: flow.id,
        before: { latestVersion: locked.latestVersion },
        after: {
          latestVersion: version,
          versionId: created.id,
          nodeCount: parsed.nodes.length,
        },
      });

      return { id: flow.id, version };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(ERROR_CODES.CONFLICT, "该流程刚被发布，请刷新后重试");
    }
    throw error;
  }
}

function throwPublishRejected(issues: FlowValidationIssue[]): void {
  const blocking = issues.filter((issue) => issue.level === "error");
  if (blocking.length === 0) {
    return;
  }
  const summary = blocking
    .slice(0, 3)
    .map((issue) => issue.message)
    .join("；");
  throw new ValidationError(
    blocking.length > 3 ? `${summary} 等 ${blocking.length} 项校验错误` : summary,
    { issues: JSON.stringify(blocking) },
  );
}

export async function deleteFlow(
  id: string,
  actorId: string,
): Promise<{ id: string }> {
  const flow = await prisma.approvalFlow.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          instances: { where: { deletedAt: null } },
          templates: { where: { deletedAt: null } },
        },
      },
    },
  });
  if (!flow) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "审批流程不存在");
  }
  if (flow._count.instances > 0) {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      `已有 ${flow._count.instances} 个审批实例引用该流程，无法删除`,
    );
  }
  if (flow._count.templates > 0) {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      `仍有 ${flow._count.templates} 个模板关联该流程，请先解绑`,
    );
  }

  await prisma.approvalFlow.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: actorId },
  });

  await recordAudit(prisma, {
    actorId,
    action: "flow.delete",
    entity: "ApprovalFlow",
    entityId: id,
    before: { name: flow.name },
    after: { deleted: true },
  });

  return { id };
}

export async function setTemplateFlow(
  templateId: string,
  flowId: string | null,
  actorId: string,
): Promise<{ templateId: string; flowId: string | null }> {
  const template = await prisma.contractTemplate.findFirst({
    where: { id: templateId, deletedAt: null },
    select: { id: true, name: true, flowId: true },
  });
  if (!template) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "合同模板不存在");
  }
  if (flowId) {
    const flow = await prisma.approvalFlow.findFirst({
      where: { id: flowId, deletedAt: null },
      select: { id: true, latestVersion: true },
    });
    if (!flow) {
      throw new ValidationError("关联的流程不存在");
    }
    if (flow.latestVersion === 0) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        "该流程尚未发布，无法作为默认审批流关联",
      );
    }
  }

  await prisma.contractTemplate.update({
    where: { id: templateId },
    data: { flowId, updatedBy: actorId },
  });

  await recordAudit(prisma, {
    actorId,
    action: "template.flow.bind",
    entity: "ContractTemplate",
    entityId: templateId,
    before: { flowId: template.flowId },
    after: { flowId },
  });

  return { templateId, flowId };
}
