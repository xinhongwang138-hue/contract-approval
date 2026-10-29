export const PERMISSION_KEYS = [
  "contract.create",
  "contract.read",
  "contract.update",
  "contract.submit",
  "contract.withdraw",
  "contract.approve",
  "contract.seal",
  "contract.archive",
  "contract.amend",
  "contract.export",
  "flow.create",
  "flow.publish",
  "flow.manage",
  "system.user.manage",
  "system.role.manage",
  "audit.read",
  "report.read",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PERMISSION_DEFINITIONS: Record<
  PermissionKey,
  { name: string; group: string }
> = {
  "contract.create": { name: "创建合同", group: "合同" },
  "contract.read": { name: "查看合同", group: "合同" },
  "contract.update": { name: "编辑合同", group: "合同" },
  "contract.submit": { name: "提交审批", group: "合同" },
  "contract.withdraw": { name: "撤回审批", group: "合同" },
  "contract.approve": { name: "审批合同", group: "合同" },
  "contract.seal": { name: "用印登记", group: "合同" },
  "contract.archive": { name: "归档合同", group: "合同" },
  "contract.amend": { name: "发起变更", group: "合同" },
  "contract.export": { name: "导出合同", group: "合同" },
  "flow.create": { name: "创建流程", group: "流程" },
  "flow.publish": { name: "发布流程", group: "流程" },
  "flow.manage": { name: "管理流程", group: "流程" },
  "system.user.manage": { name: "用户管理", group: "系统" },
  "system.role.manage": { name: "角色权限管理", group: "系统" },
  "audit.read": { name: "查看审计日志", group: "审计" },
  "report.read": { name: "查看报表", group: "报表" },
};

export const ROLE_KEYS = {
  admin: "admin",
  manager: "manager",
  legal: "legal",
  employee: "employee",
} as const;

export type RoleKey = (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS];

export const ROLE_DEFINITIONS = [
  {
    key: ROLE_KEYS.admin,
    name: "系统管理员",
    isSystem: true,
    scope: "all",
    permissions: PERMISSION_KEYS,
  },
  {
    key: ROLE_KEYS.manager,
    name: "部门主管",
    isSystem: true,
    scope: "dept_and_sub",
    permissions: [
      "contract.create",
      "contract.read",
      "contract.update",
      "contract.submit",
      "contract.withdraw",
      "contract.approve",
      "contract.export",
      "report.read",
    ],
  },
  {
    key: ROLE_KEYS.legal,
    name: "法务",
    isSystem: true,
    scope: "all",
    permissions: [
      "contract.read",
      "contract.approve",
      "contract.export",
      "report.read",
    ],
  },
  {
    key: ROLE_KEYS.employee,
    name: "普通员工",
    isSystem: true,
    scope: "self",
    permissions: [
      "contract.create",
      "contract.read",
      "contract.update",
      "contract.submit",
      "contract.withdraw",
      "contract.export",
    ],
  },
] as const;
