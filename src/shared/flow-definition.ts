import { z } from "zod";

export const FLOW_SCHEMA_VERSION = 1;

export const FLOW_NODE_TYPES = [
  "start",
  "approval",
  "cc",
  "condition",
  "join",
  "action",
  "end",
] as const;
export type FlowNodeType = (typeof FLOW_NODE_TYPES)[number];

export const FLOW_NODE_TYPE_LABELS: Record<FlowNodeType, string> = {
  start: "发起",
  approval: "审批",
  cc: "抄送",
  condition: "条件分支",
  join: "并行汇聚",
  action: "自动动作",
  end: "结束",
};

export const APPROVAL_MODES = ["all", "any", "sequential"] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = {
  all: "会签（全部）",
  any: "或签（任一）",
  sequential: "依次串行",
};

export const ASSIGNEE_KINDS = [
  "role",
  "user",
  "dept_manager",
  "multi_level_leader",
  "initiator_self",
  "form_field",
  "expression",
] as const;
export type AssigneeKind = (typeof ASSIGNEE_KINDS)[number];

export const EMPTY_APPROVER_POLICIES = [
  "auto_pass",
  "transfer_to_manager",
  "block_submit",
] as const;
export type EmptyApproverPolicy = (typeof EMPTY_APPROVER_POLICIES)[number];

export const SELF_APPROVE_POLICIES = ["skip", "block"] as const;
export type SelfApprovePolicy = (typeof SELF_APPROVE_POLICIES)[number];

export const TIMEOUT_ACTIONS = [
  "remind",
  "auto_approve",
  "auto_reject",
  "transfer_to_manager",
] as const;
export type TimeoutAction = (typeof TIMEOUT_ACTIONS)[number];

export const ADD_SIGN_POSITIONS = ["before", "after", "parallel"] as const;
export type AddSignPosition = (typeof ADD_SIGN_POSITIONS)[number];

export const ACTION_KINDS = [
  "notify",
  "set_status",
  "create_seal_record",
  "archive",
  "webhook",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const END_RESULTS = ["approved", "rejected", "terminated"] as const;
export type EndResult = (typeof END_RESULTS)[number];

export const CONDITION_OPS = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "not_in",
  "contains",
  "empty",
  "not_empty",
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export const CONTROLLED_PATHS = ["contract", "form", "initiator"] as const;
export type ControlledPathRoot = (typeof CONTROLLED_PATHS)[number];

const CONTROLLED_PATH_PATTERN = /^(contract|form|initiator)\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

export const controlledPathSchema = z
  .string()
  .trim()
  .regex(
    CONTROLLED_PATH_PATTERN,
    "条件左值只能使用 contract./form./initiator. 开头的受控路径",
  );

export type ConditionExpr =
  | { all: ConditionExpr[] }
  | { any: ConditionExpr[] }
  | { left: string; op: ConditionOp; right?: ConditionOperand };

export type ConditionOperand = string | number | boolean | Array<string | number>;

const ARRAY_OPS: ConditionOp[] = ["in", "not_in"];
const UNARY_OPS: ConditionOp[] = ["empty", "not_empty"];

export const conditionExprSchema: z.ZodType<ConditionExpr> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionExprSchema).min(1, "all 至少需要一个条件") }),
    z.object({ any: z.array(conditionExprSchema).min(1, "any 至少需要一个条件") }),
    z
      .object({
        left: controlledPathSchema,
        op: z.enum(CONDITION_OPS),
        right: z
          .union([
            z.string().max(200),
            z.number().finite(),
            z.boolean(),
            z.array(z.union([z.string().max(200), z.number().finite()])).min(1).max(50),
          ])
          .optional(),
      })
      .superRefine((expr, ctx) => {
        if (UNARY_OPS.includes(expr.op)) {
          if (expr.right !== undefined) {
            ctx.addIssue({
              code: "custom",
              path: ["right"],
              message: `${expr.op} 不需要右值`,
            });
          }
          return;
        }
        if (expr.right === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["right"],
            message: `${expr.op} 需要右值`,
          });
          return;
        }
        const isArray = Array.isArray(expr.right);
        if (ARRAY_OPS.includes(expr.op) && !isArray) {
          ctx.addIssue({
            code: "custom",
            path: ["right"],
            message: `${expr.op} 的右值必须是数组`,
          });
        }
        if (!ARRAY_OPS.includes(expr.op) && isArray) {
          ctx.addIssue({
            code: "custom",
            path: ["right"],
            message: `${expr.op} 的右值不能是数组`,
          });
        }
      }),
  ]),
) as z.ZodType<ConditionExpr>;

export const nodeNextSchema = z.union([
  z.string().trim().min(1),
  z.array(z.string().trim().min(1)).min(2, "并行分支至少需要两个目标节点"),
]);

const idSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/, "节点 id 需以字母开头，仅含字母、数字、下划线与短横线");

const capabilitiesSchema = z
  .object({
    addSign: z.array(z.enum(ADD_SIGN_POSITIONS)).default([]),
    transfer: z.boolean().default(false),
    return: z.boolean().default(false),
    delegate: z.boolean().default(false),
  })
  .default({ addSign: [], transfer: false, return: false, delegate: false });

export const assigneeConfigSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("role"), key: z.string().trim().min(1) }),
  z.object({ kind: z.literal("user"), ids: z.array(z.string().trim().min(1)).min(1) }),
  z.object({
    kind: z.literal("dept_manager"),
    level: z.number().int().min(1).max(10).default(1),
  }),
  z.object({
    kind: z.literal("multi_level_leader"),
    fromLevel: z.number().int().min(1).default(1),
    toLevel: z.number().int().min(1).max(10),
  }),
  z.object({ kind: z.literal("initiator_self") }),
  z.object({ kind: z.literal("form_field"), field: z.string().trim().min(1) }),
  z.object({ kind: z.literal("expression"), expression: z.string().trim().min(1) }),
]);
export type AssigneeConfig = z.infer<typeof assigneeConfigSchema>;

export const approvalNodeSchema = z.object({
  id: idSchema,
  type: z.literal("approval"),
  name: z.string().trim().min(1).max(40),
  assignee: assigneeConfigSchema,
  mode: z.enum(APPROVAL_MODES).default("any"),
  minApproveRatio: z.number().min(0).max(1).default(1),
  emptyPolicy: z.enum(EMPTY_APPROVER_POLICIES).default("block_submit"),
  selfApprovePolicy: z.enum(SELF_APPROVE_POLICIES).default("skip"),
  reject: z
    .object({
      policy: z
        .string()
        .trim()
        .regex(
          /^(to_initiator|to_prev|terminate|to_node:[a-zA-Z][a-zA-Z0-9_-]{0,39})$/,
          "驳回策略需为 to_initiator / to_prev / terminate / to_node:<节点id>",
        ),
    })
    .default({ policy: "to_initiator" }),
  timeout: z
    .object({
      hours: z.number().positive().max(24 * 60),
      action: z.enum(TIMEOUT_ACTIONS),
    })
    .nullable()
    .default(null),
  requiredOpinionOn: z
    .array(z.enum(["approve", "reject", "return"]))
    .default([]),
  capabilities: capabilitiesSchema,
  visibleFieldKeys: z.array(z.string().trim().min(1)).max(50).default([]),
  next: nodeNextSchema,
});

export const startNodeSchema = z.object({
  id: idSchema,
  type: z.literal("start"),
  name: z.string().trim().min(1).max(40),
  next: nodeNextSchema,
});

export const ccNodeSchema = z.object({
  id: idSchema,
  type: z.literal("cc"),
  name: z.string().trim().min(1).max(40),
  assignee: assigneeConfigSchema,
  next: nodeNextSchema,
});

export const conditionBranchSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(40),
  when: conditionExprSchema.nullable(),
  next: nodeNextSchema,
});

export const conditionNodeSchema = z.object({
  id: idSchema,
  type: z.literal("condition"),
  name: z.string().trim().min(1).max(40),
  branches: z.array(conditionBranchSchema).min(1),
});

export const joinNodeSchema = z.object({
  id: idSchema,
  type: z.literal("join"),
  name: z.string().trim().min(1).max(40),
  next: nodeNextSchema,
});

export const actionNodeSchema = z.object({
  id: idSchema,
  type: z.literal("action"),
  name: z.string().trim().min(1).max(40),
  kind: z.enum(ACTION_KINDS),
  payload: z.record(z.string(), z.unknown()).default({}),
  next: nodeNextSchema,
});

export const endNodeSchema = z.object({
  id: idSchema,
  type: z.literal("end"),
  name: z.string().trim().min(1).max(40),
  result: z.enum(END_RESULTS),
});

export const flowNodeSchema = z.discriminatedUnion("type", [
  startNodeSchema,
  approvalNodeSchema,
  ccNodeSchema,
  conditionNodeSchema,
  joinNodeSchema,
  actionNodeSchema,
  endNodeSchema,
]);

export type FlowNode = z.infer<typeof flowNodeSchema>;
export type ApprovalNode = z.infer<typeof approvalNodeSchema>;
export type ConditionBranch = z.infer<typeof conditionBranchSchema>;

export const flowDefinitionSchema = z
  .object({
    schemaVersion: z.literal(FLOW_SCHEMA_VERSION),
    entry: z.string().trim().min(1),
    nodes: z.array(flowNodeSchema).min(2).max(80),
  })
  .superRefine((definition, ctx) => {
    const seen = new Set<string>();
    definition.nodes.forEach((node, index) => {
      if (seen.has(node.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", index, "id"],
          message: `节点 id 重复：${node.id}`,
        });
      }
      seen.add(node.id);
    });

    const startNodes = definition.nodes.filter((node) => node.type === "start");
    if (startNodes.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "流程必须包含一个 start 节点",
      });
    } else if (startNodes.length > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "流程只能有一个 start 节点",
      });
    } else if (startNodes[0] && definition.entry !== startNodes[0].id) {
      ctx.addIssue({
        code: "custom",
        path: ["entry"],
        message: "entry 必须指向 start 节点 id",
      });
    }

    for (const node of definition.nodes) {
      if (node.type !== "condition") {
        continue;
      }
      const defaults = node.branches.filter((branch) => branch.when === null);
      if (defaults.length !== 1) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", definition.nodes.indexOf(node), "branches"],
          message: `条件节点 ${node.id} 必须有且仅有一个默认分支（when 为 null）`,
        });
      }
    }
  });

export type FlowDefinition = z.infer<typeof flowDefinitionSchema>;

export function parseFlowDefinition(value: unknown): FlowDefinition | null {
  const parsed = flowDefinitionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function nextTargets(next: z.infer<typeof nodeNextSchema>): string[] {
  return Array.isArray(next) ? next : [next];
}

export function collectNodeTargets(node: FlowNode): string[] {
  if (node.type === "end") {
    return [];
  }
  if (node.type === "condition") {
    return node.branches.flatMap((branch) => nextTargets(branch.next));
  }
  return nextTargets(node.next);
}
