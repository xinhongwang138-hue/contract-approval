"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  APPROVAL_MODE_LABELS,
  APPROVAL_MODES,
  ASSIGNEE_KINDS,
  EMPTY_APPROVER_POLICIES,
  SELF_APPROVE_POLICIES,
  TIMEOUT_ACTIONS,
  ADD_SIGN_POSITIONS,
  CONDITION_OPS,
  type ApprovalMode,
  type AssigneeKind,
} from "@/shared/flow-definition";
import {
  idOf,
  isDefaultBranch,
  labelOf,
  nodeName,
  nodeSummary,
  nodeType,
  readBranches,
  type DefinitionRecord,
  type NodeRecord,
} from "./flow-node-utils";

const ASSIGNEE_KIND_LABELS: Record<AssigneeKind, string> = {
  role: "按角色",
  user: "指定人员",
  dept_manager: "部门主管",
  multi_level_leader: "多级主管链",
  initiator_self: "发起人本人",
  form_field: "表单字段",
  expression: "白名单表达式",
};

const REJECT_PRESETS = [
  { value: "to_initiator", label: "退回发起人（实例结束）" },
  { value: "to_prev", label: "退回上一审批人" },
  { value: "terminate", label: "直接终止流程" },
];

const EXPRESSION_WHITELIST = [
  "initiator.manager",
  "initiator.dept_manager",
  "form.reviewer",
];

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function readAssignee(node: NodeRecord): Record<string, unknown> {
  const value = node.assignee;
  return value && typeof value === "object" ? (value as Record<string, unknown>) : { kind: "role" };
}

type SheetProps = {
  definition: DefinitionRecord;
  nodeId: string | null;
  open: boolean;
  roles: { key: string; name: string }[];
  users: { id: string; name: string; departmentName: string | null }[];
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (nodeId: string, patch: NodeRecord) => void;
};

export function NodeConfigSheet(props: SheetProps) {
  const { definition, nodeId, open, onOpenChange } = props;
  const node = nodeId
    ? definition.nodes.find((item) => item.id === nodeId)
    : undefined;

  if (!nodeId || !node) {
    return null;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <NodeDraft key={nodeId} {...props} nodeId={nodeId} node={node} />
      </SheetContent>
    </Sheet>
  );
}

function NodeDraft({
  node,
  nodeId,
  definition,
  roles,
  users,
  canEdit,
  onOpenChange,
  onApply,
}: SheetProps & { node: NodeRecord; nodeId: string }) {
  const [draft, setDraft] = useState<NodeRecord>(() =>
    JSON.parse(JSON.stringify(node)) as NodeRecord,
  );
  const [userFilter, setUserFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const type = nodeType(node);
  const assignee = readAssignee(draft);
  const mode = (draft.mode as ApprovalMode | undefined) ?? "any";
  const rejectPolicy = typeof draft.reject === "object" && draft.reject !== null
    ? String((draft.reject as Record<string, unknown>).policy ?? "to_initiator")
    : "to_initiator";
  const timeout = draft.timeout as { hours?: number; action?: string } | null;
  const capabilities = (draft.capabilities ?? {}) as Record<string, unknown>;
  const targets = definition.nodes
    .filter((item) => item.id !== nodeId)
    .map((item) => idOf(item))
    .filter((item) => item !== "");

  function patch(next: NodeRecord): void {
    setDraft((current) => ({ ...current, ...next }));
  }

  function patchAssignee(next: Record<string, unknown>): void {
    patch({ assignee: { ...assignee, ...next } });
  }

  function patchReject(policy: string): void {
    patch({ reject: { policy } });
  }

  function handleSave(): void {
    if (!nodeId) {
      return;
    }
    if (type === "action" || type === "condition") {
      const payload = draft.__payloadText ?? draft.__branchText;
      if (typeof payload === "string") {
        try {
          JSON.parse(payload);
        } catch {
          setError("JSON 片段格式不正确，请检查后再保存");
          return;
        }
      }
    }
    const cleaned: NodeRecord = { ...draft };
    delete cleaned["__payloadText"];
    delete cleaned["__branchText"];
    onApply(nodeId, cleaned);
  }

  const visibleUsers = users
    .filter((user) =>
      userFilter.trim() === ""
        ? true
        : `${user.name}${user.departmentName ?? ""}`.includes(userFilter.trim()),
    )
    .slice(0, 30);

  const selectedUsers = Array.isArray(assignee.ids) ? (assignee.ids as string[]) : [];

  return (
    <>
      <SheetHeader>
          <SheetTitle>节点属性 · {nodeName(node)}</SheetTitle>
          <SheetDescription>
            <span className="font-mono text-xs">{nodeId}</span> · {nodeSummary(node)}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          <Field label="节点名称" htmlFor="node-name">
            <Input
              id="node-name"
              value={String(draft.name ?? "")}
              disabled={!canEdit}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </Field>

          {(type === "approval" || type === "cc") && (
            <>
              <Field label="审批人来源" htmlFor="node-assignee-kind">
                <Select
                  value={String(assignee.kind ?? "role")}
                  disabled={!canEdit}
                  onValueChange={(value) =>
                    patchAssignee({ kind: value as AssigneeKind })
                  }
                >
                  <SelectTrigger id="node-assignee-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNEE_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {ASSIGNEE_KIND_LABELS[kind]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {assignee.kind === "role" ? (
                <Field label="角色" htmlFor="node-role" hint="角色无可用成员时会阻断发布。">
                  <Select
                    value={String(assignee.key ?? "")}
                    disabled={!canEdit}
                    onValueChange={(value) => patchAssignee({ key: value })}
                  >
                    <SelectTrigger id="node-role" className="w-full">
                      <SelectValue placeholder="选择角色" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((role) => (
                        <SelectItem key={role.key} value={role.key}>
                          {role.name}（{role.key}）
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}

              {(assignee.kind ?? "role") === "user" ? (
                <Field label="指定人员" htmlFor="node-user-search" hint="最多勾选 10 人，运行时自动去重。">
                  <Input
                    id="node-user-search"
                    value={userFilter}
                    placeholder="搜索姓名或部门"
                    onChange={(event) => setUserFilter(event.target.value)}
                    className="mb-2"
                  />
                  <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-2">
                    {visibleUsers.map((user) => (
                      <label
                        key={user.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={selectedUsers.includes(user.id)}
                          disabled={!canEdit}
                          onCheckedChange={(checked) => {
                            const next = checked
                              ? [...selectedUsers, user.id]
                              : selectedUsers.filter((id) => id !== user.id);
                            patchAssignee({ ids: next });
                          }}
                        />
                        <span className="truncate">{user.name}</span>
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {user.departmentName ?? "未分配部门"}
                        </span>
                      </label>
                    ))}
                  </div>
                </Field>
              ) : null}

              {assignee.kind === "dept_manager" ? (
                <Field label="向上第 N 级主管" htmlFor="node-level" hint="跳过没有主管的部门后计数。">
                  <Input
                    id="node-form-field"
                    type="number"
                    min={1}
                    max={10}
                    value={String(assignee.level ?? 1)}
                    disabled={!canEdit}
                    onChange={(event) =>
                      patchAssignee({ level: Number(event.target.value) })
                    }
                  />
                </Field>
              ) : null}

              {assignee.kind === "multi_level_leader" ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="起始级" htmlFor="node-from-level">
                    <Input
                      id="node-from-level"
                      type="number"
                      min={1}
                      max={10}
                      value={String(assignee.fromLevel ?? 1)}
                      disabled={!canEdit}
                      onChange={(event) =>
                        patchAssignee({ fromLevel: Number(event.target.value) })
                      }
                    />
                  </Field>
                  <Field label="截止到级" htmlFor="node-to-level">
                    <Input
                      id="node-to-level"
                      type="number"
                      min={1}
                      max={10}
                      value={String(assignee.toLevel ?? 2)}
                      disabled={!canEdit}
                      onChange={(event) =>
                        patchAssignee({ toLevel: Number(event.target.value) })
                      }
                    />
                  </Field>
                </div>
              ) : null}

              {assignee.kind === "form_field" ? (
                <Field label="表单字段标识" htmlFor="node-form-field" hint="字段值填用户 iD 或邮箱，支持逗号分隔。">
                  <Input
                    id="node-level"
                    value={String(assignee.field ?? "")}
                    disabled={!canEdit}
                    onChange={(event) => patchAssignee({ field: event.target.value })}
                  />
                </Field>
              ) : null}

              {assignee.kind === "expression" ? (
                <Field label="表达式" htmlFor="node-expression" hint="仅支持白名单，禁止任意表达式求值。">
                  <Select
                    value={String(assignee.expression ?? EXPRESSION_WHITELIST[0])}
                    disabled={!canEdit}
                    onValueChange={(value) => patchAssignee({ expression: value })}
                  >
                    <SelectTrigger id="node-expression" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPRESSION_WHITELIST.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
            </>
          )}

          {type === "approval" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="审批模式" htmlFor="node-mode">
                  <Select
                    value={mode}
                    disabled={!canEdit}
                    onValueChange={(value) => patch({ mode: value as ApprovalMode })}
                  >
                    <SelectTrigger id="node-mode" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {APPROVAL_MODES.map((item) => (
                        <SelectItem key={item} value={item}>
                          {APPROVAL_MODE_LABELS[item]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="通过比例" htmlFor="node-ratio" hint="仅会签生效，1 表示全员通过。">
                  <Input
                    id="node-ratio"
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    value={String(draft.minApproveRatio ?? 1)}
                    disabled={!canEdit || mode !== "all"}
                    onChange={(event) =>
                      patch({ minApproveRatio: Number(event.target.value) })
                    }
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="空审批人策略" htmlFor="node-empty-policy">
                  <Select
                    value={String(draft.emptyPolicy ?? "block_submit")}
                    disabled={!canEdit}
                    onValueChange={(value) => patch({ emptyPolicy: value })}
                  >
                    <SelectTrigger id="node-empty-policy" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EMPTY_APPROVER_POLICIES.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item === "block_submit"
                            ? "阻断提交"
                            : item === "auto_pass"
                              ? "自动通过"
                              : "转交上级"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="自审策略" htmlFor="node-self-policy">
                  <Select
                    value={String(draft.selfApprovePolicy ?? "skip")}
                    disabled={!canEdit}
                    onValueChange={(value) => patch({ selfApprovePolicy: value })}
                  >
                    <SelectTrigger id="node-self-policy" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SELF_APPROVE_POLICIES.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item === "skip" ? "自动跳过" : "阻断提交"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Field label="驳回去向" htmlFor="node-reject-policy">
                <Select
                  value={rejectPolicy.startsWith("to_node:") ? "to_node" : rejectPolicy}
                  disabled={!canEdit}
                  onValueChange={(value) => {
                    if (value === "to_node") {
                      patchReject(`to_node:${targets[0] ?? "end"}`);
                    } else {
                      patchReject(value);
                    }
                  }}
                >
                  <SelectTrigger id="node-reject-policy" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REJECT_PRESETS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="to_node">退回指定节点</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              {rejectPolicy.startsWith("to_node:") ? (
                <Field label="退回目标节点" htmlFor="node-reject-target">
                  <Select
                    value={rejectPolicy.slice("to_node:".length)}
                    disabled={!canEdit}
                    onValueChange={(value) => patchReject(`to_node:${value}`)}
                  >
                    <SelectTrigger id="node-reject-target" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {targets.map((target) => (
                        <SelectItem key={target} value={target}>
                          {target}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}

              <div className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <Label htmlFor="node-timeout-enabled">超时处理</Label>
                  <Switch
                    id="node-timeout-enabled"
                    checked={timeout !== null && timeout !== undefined}
                    disabled={!canEdit}
                    onCheckedChange={(checked) =>
                      patch({
                        timeout: checked ? { hours: 24, action: "remind" } : null,
                      })
                    }
                  />
                </div>
                {timeout ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      id="node-timeout-hours"
                      type="number"
                      min="1"
                      value={String(timeout.hours ?? 24)}
                      disabled={!canEdit}
                      onChange={(event) =>
                        patch({
                          timeout: { ...timeout, hours: Number(event.target.value) },
                        })
                      }
                    />
                    <Select
                      value={String(timeout.action ?? "remind")}
                      disabled={!canEdit}
                      onValueChange={(value) =>
                        patch({ timeout: { ...timeout, action: value } })
                      }
                    >
                      <SelectTrigger id="node-timeout-action" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIMEOUT_ACTIONS.map((item) => (
                          <SelectItem key={item} value={item}>
                            {item === "remind"
                              ? "提醒"
                              : item === "auto_approve"
                                ? "自动通过"
                                : item === "auto_reject"
                                  ? "自动驳回"
                                  : "转交上级"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>

              <Field label="必须填写意见的动作" htmlFor="node-opinion-approve">
                <div className="flex flex-wrap gap-4">
                  {(["approve", "reject", "return"] as const).map((action) => {
                    const list = Array.isArray(draft.requiredOpinionOn)
                      ? (draft.requiredOpinionOn as string[])
                      : [];
                    return (
                      <label key={action} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          id={action === "approve" ? "node-opinion-approve" : undefined}
                          checked={list.includes(action)}
                          disabled={!canEdit}
                          onCheckedChange={(checked) =>
                            patch({
                              requiredOpinionOn: checked
                                ? [...list, action]
                                : list.filter((item) => item !== action),
                            })
                          }
                        />
                        {action === "approve" ? "同意" : action === "reject" ? "驳回" : "退回"}
                      </label>
                    );
                  })}
                </div>
              </Field>

              <Field label="节点能力" htmlFor="node-addsign-before">
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-4">
                    {ADD_SIGN_POSITIONS.map((position) => {
                      const list = Array.isArray(capabilities.addSign)
                        ? (capabilities.addSign as string[])
                        : [];
                      return (
                        <label
                          key={position}
                          className="flex items-center gap-2 text-sm"
                        >
                          <Checkbox
                            id={position === "before" ? "node-addsign-before" : undefined}
                            checked={list.includes(position)}
                            disabled={!canEdit}
                            onCheckedChange={(checked) =>
                              patch({
                                capabilities: {
                                  ...capabilities,
                                  addSign: checked
                                    ? [...list, position]
                                    : list.filter((item) => item !== position),
                                },
                              })
                            }
                          />
                          {position === "before"
                            ? "前加签"
                            : position === "after"
                              ? "后加签"
                              : "并加签"}
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex gap-6">
                    {(
                      [
                        ["transfer", "允许转签"],
                        ["return", "允许退回"],
                        ["delegate", "允许委托"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={Boolean(capabilities[key])}
                          disabled={!canEdit}
                          onCheckedChange={(checked) =>
                            patch({ capabilities: { ...capabilities, [key]: checked } })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              </Field>

              <Field label="可见字段" htmlFor="node-visible-keys" hint="逗号分隔的字段标识，留空表示全部可见。">
                <Input
                  id="node-visible-keys"
                  value={
                    Array.isArray(draft.visibleFieldKeys)
                      ? (draft.visibleFieldKeys as string[]).join(",")
                      : ""
                  }
                  disabled={!canEdit}
                  onChange={(event) =>
                    patch({
                      visibleFieldKeys: event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter((item) => item !== ""),
                    })
                  }
                />
              </Field>
            </>
          ) : null}

          {type === "condition" ? (
            <Field label="分支配置" htmlFor="branch-0-name" hint="默认分支的 when 固定为 null，且只能有一个。">
              <div className="space-y-3">
                {readBranches(draft).map((branch, index) => (
                  <BranchEditor
                    key={idOf(branch)}
                    branch={branch}
                    index={index}
                    disabled={!canEdit}
                    onChange={(next) => {
                      const branches = readBranches(draft).map((item) =>
                        idOf(item) === idOf(branch) ? next : item,
                      );
                      patch({ branches });
                    }}
                  />
                ))}
              </div>
            </Field>
          ) : null}

          {type === "action" ? (
            <>
              <Field label="动作类型" htmlFor="node-action-kind">
                <Select
                  value={String(draft.kind ?? "notify")}
                  disabled={!canEdit}
                  onValueChange={(value) => patch({ kind: value })}
                >
                  <SelectTrigger id="node-action-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["notify", "set_status", "create_seal_record", "archive", "webhook"].map(
                      (kind) => (
                        <SelectItem key={kind} value={kind}>
                          {kind}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="动作参数 JSON" htmlFor="node-action-payload" hint="例如 {&quot;title&quot;:&quot;合同已归档&quot;}">
                <Textarea
                  id="node-action-payload"
                  rows={4}
                  disabled={!canEdit}
                  value={
                    typeof draft["__payloadText"] === "string"
                      ? String(draft["__payloadText"])
                      : JSON.stringify(draft.payload ?? {}, null, 2)
                  }
                  onChange={(event) => {
                    const text = event.target.value;
                    let parsed: unknown = null;
                    try {
                      parsed = JSON.parse(text);
                    } catch {
                      parsed = null;
                    }
                    patch({
                      __payloadText: text,
                      payload: parsed && typeof parsed === "object" ? parsed : {},
                    });
                  }}
                />
              </Field>
            </>
          ) : null}

          {type === "end" ? (
            <Field label="结束结果" htmlFor="node-end-result">
              <Select
                value={String(draft.result ?? "approved")}
                disabled={!canEdit}
                onValueChange={(value) => patch({ result: value })}
              >
                <SelectTrigger id="node-end-result" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["approved", "rejected", "terminated"].map((item) => (
                    <SelectItem key={item} value={item}>
                      {item === "approved" ? "通过" : item === "rejected" ? "驳回" : "终止"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        {canEdit ? (
          <SheetFooter className="sticky bottom-0 z-10 bg-muted">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="button" onClick={handleSave}>
              应用属性
            </Button>
          </SheetFooter>
        ) : null}
    </>
  );
}

function BranchEditor({
  branch,
  index,
  disabled,
  onChange,
}: {
  branch: NodeRecord;
  index: number;
  disabled: boolean;
  onChange: (next: NodeRecord) => void;
}) {
  const isDefault = isDefaultBranch(branch);
  const initialText =
    typeof branch["__whenText"] === "string"
      ? String(branch["__whenText"])
      : isDefault
        ? "null"
        : JSON.stringify(branch.when, null, 2);

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">分支 {index + 1}</span>
        <Input
          id={index === 0 ? "branch-0-name" : undefined}
          value={labelOf(branch, "")}
          disabled={disabled}
          className="h-8"
          onChange={(event) => onChange({ ...branch, name: event.target.value })}
        />
        <label className="flex shrink-0 items-center gap-2 text-xs">
          <Switch
            checked={isDefault}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange({
                ...branch,
                when: checked ? null : { left: "contract.amount", op: "gte", right: 500000 },
              })
            }
          />
          默认
        </label>
      </div>
      {!isDefault ? (
        <Textarea
          rows={4}
          disabled={disabled}
          value={initialText}
          onChange={(event) => {
            const text = event.target.value;
            let parsed: unknown = null;
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = null;
            }
            onChange({
              ...branch,
              __whenText: text,
              when: parsed && typeof parsed === "object" ? parsed : branch.when,
            });
          }}
        />
      ) : null}
      <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
        可用操作符：{CONDITION_OPS.join(" / ")}
      </div>
    </div>
  );
}
