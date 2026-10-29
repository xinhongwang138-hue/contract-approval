"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, Rocket, Save } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  publishFlowAction,
  saveFlowDraftAction,
} from "@/server/actions/flows";
import { validateFlowDefinition } from "@/server/flow/validate";
import type { FlowValidationIssue } from "@/server/flow/validate";
import type { UserOption } from "@/server/actions/user-search";
import { FlowTree } from "./flow-tree";
import { NodeConfigSheet } from "./node-config-sheet";
import {
  addConditionBranch,
  cloneDefinition,
  forkBranch,
  insertNode,
  parseDefinition,
  removeConditionBranch,
  removeNode,
  updateNode,
  type DefinitionRecord,
  type FlowNodeType,
  type NodeRecord,
  type TargetRef,
} from "./flow-node-utils";

export type FlowBuilderProps = {
  flowId: string;
  flowName: string;
  flowCode: string;
  latestVersion: number;
  activeVersion: number | null;
  initialDefinition: unknown;
  canEdit: boolean;
  canPublish: boolean;
  roles: { key: string; name: string }[];
  users: UserOption[];
};

export function FlowBuilder(props: FlowBuilderProps) {
  const {
    flowId,
    flowCode,
    latestVersion,
    activeVersion,
    initialDefinition,
    canEdit,
    canPublish,
    roles,
    users,
  } = props;

  const parsedInitial = parseDefinition(initialDefinition);
  const [definition, setDefinition] = useState<DefinitionRecord | null>(parsedInitial);
  const [jsonText, setJsonText] = useState(() =>
    JSON.stringify(initialDefinition, null, 2),
  );
  const [view, setView] = useState<"tree" | "json">("tree");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [serverIssues, setServerIssues] = useState<FlowValidationIssue[]>([]);
  const [saving, startSaving] = useTransition();
  const [publishing, startPublishing] = useTransition();

  const clientIssues = useMemo<FlowValidationIssue[]>(() => {
    if (!definition) {
      return validateFlowDefinition(initialDefinition);
    }
    return validateFlowDefinition(definition);
  }, [definition, initialDefinition]);

  const issues = serverIssues.length > 0 ? mergeIssues(clientIssues, serverIssues) : clientIssues;
  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");

  function mutate(next: DefinitionRecord | null): void {
    setDefinition(next);
    if (next) {
      setJsonText(JSON.stringify(next, null, 2));
    }
    setDirty(true);
    setServerIssues([]);
  }

  function handleInsert(ref: TargetRef, type: FlowNodeType): void {
    if (!definition) {
      return;
    }
    const result = insertNode(definition, ref, type);
    mutate(result.definition);
    setSelectedId(result.nodeId);
    // 菜单关闭的 pointerdown 会立刻被 Sheet 当成「点击外部」，延后一帧再开。
    requestAnimationFrame(() => setSheetOpen(true));
  }

  function handleFork(ref: TargetRef): void {
    if (!definition) {
      return;
    }
    mutate(forkBranch(definition, ref));
  }

  function handleDelete(nodeId: string): void {
    if (!definition) {
      return;
    }
    const result = removeNode(definition, nodeId);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    mutate(result.definition);
    if (selectedId === nodeId) {
      setSelectedId(null);
      setSheetOpen(false);
    }
  }

  function handleApply(nodeId: string, patch: NodeRecord): void {
    if (!definition) {
      return;
    }
    mutate(updateNode(definition, nodeId, patch));
    setSheetOpen(false);
    toast.success("节点属性已更新，记得保存草稿");
  }

  function handleAddBranch(nodeId: string): void {
    if (!definition) {
      return;
    }
    mutate(addConditionBranch(definition, nodeId));
  }

  function handleRemoveBranch(nodeId: string, branchId: string): void {
    if (!definition) {
      return;
    }
    mutate(removeConditionBranch(definition, nodeId, branchId));
  }

  function applyJson(): boolean {
    try {
      const parsed = parseDefinition(JSON.parse(jsonText));
      if (!parsed) {
        toast.error("JSON 结构需包含 schemaVersion / entry / nodes");
        return false;
      }
      setDefinition(parsed);
      setDirty(true);
      setServerIssues([]);
      return true;
    } catch {
      toast.error("JSON 解析失败，请检查格式");
      return false;
    }
  }

  function switchView(next: "tree" | "json"): void {
    if (view === "json" && next === "tree") {
      if (!applyJson()) {
        return;
      }
    }
    setView(next);
  }

  function handleSave(): void {
    const source = view === "json" ? applyJson() ? definition : null : definition;
    if (!source) {
      if (view === "json") {
        toast.error("请先修正 JSON 再保存");
      }
      return;
    }
    startSaving(async () => {
      const result = await saveFlowDraftAction(flowId, JSON.stringify(source));
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setDirty(false);
      setServerIssues(result.data.issues);
      toast.success("草稿已保存");
    });
  }

  function handlePublish(): void {
    if (errors.length > 0) {
      toast.error(`仍有 ${errors.length} 项校验错误，无法发布`);
      return;
    }
    startPublishing(async () => {
      if (dirty && definition) {
        const saved = await saveFlowDraftAction(flowId, JSON.stringify(definition));
        if (!saved.ok) {
          toast.error(saved.message);
          return;
        }
        setServerIssues(saved.data.issues);
      }
      const result = await publishFlowAction(flowId);
      if (!result.ok) {
        const parsed = safeParseIssues(result.fields?.["issues"]);
        if (parsed) {
          setServerIssues(parsed);
        }
        toast.error(result.message);
        return;
      }
      setDirty(false);
      toast.success(`已发布为 v${result.data.version}`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          {(["tree", "json"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => switchView(item)}
              className={[
                "rounded px-3 py-1 text-sm",
                view === item ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              ].join(" ")}
            >
              {item === "tree" ? "树形配置" : "JSON 视图"}
            </button>
          ))}
        </div>
        <Badge variant={errors.length > 0 ? "destructive" : "secondary"}>
          {errors.length > 0 ? `${errors.length} 项错误` : "校验通过"}
        </Badge>
        {warnings.length > 0 ? (
          <Badge variant="outline">{warnings.length} 项提示</Badge>
        ) : null}
        {dirty ? <Badge variant="outline">未保存</Badge> : null}
        <span className="text-xs text-muted-foreground">
          {flowCode} · 在用 v{activeVersion ?? "—"} · 最新 v{latestVersion}
        </span>
        <div className="ml-auto flex gap-2">
          {canEdit ? (
            <Button variant="outline" onClick={handleSave} disabled={saving}>
              <Save className="size-4" />
              {saving ? "保存中…" : "保存草稿"}
            </Button>
          ) : null}
          {canPublish ? (
            <Button onClick={handlePublish} disabled={publishing}>
              <Rocket className="size-4" />
              {publishing ? "发布中…" : "发布新版本"}
            </Button>
          ) : null}
        </div>
      </div>

      {issues.length > 0 ? (
        <Alert variant={errors.length > 0 ? "destructive" : "default"}>
          <AlertTitle>
            {errors.length > 0
              ? `流程校验未通过（${errors.length} 项错误）`
              : `流程可以发布，但有 ${warnings.length} 项提示`}
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-1">
              {issues.slice(0, 8).map((issue, index) => (
                <li key={index} className="flex items-start gap-2 text-xs">
                  {issue.level === "error" ? (
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                  )}
                  <span>{issue.message}</span>
                  {issue.nodeId ? (
                    <button
                      type="button"
                      className="shrink-0 font-mono underline"
                      onClick={() => {
                        setView("tree");
                        setSelectedId(issue.nodeId ?? null);
                        setSheetOpen(true);
                      }}
                    >
                      {issue.nodeId}
                    </button>
                  ) : null}
                </li>
              ))}
              {issues.length > 8 ? (
                <li className="text-xs text-muted-foreground">
                  另有 {issues.length - 8} 项未展示
                </li>
              ) : null}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {view === "json" ? (
        <div className="space-y-2">
          <Textarea
            value={jsonText}
            rows={26}
            spellCheck={false}
            className="font-mono text-xs"
            disabled={!canEdit}
            onChange={(event) => {
              setJsonText(event.target.value);
              setDirty(true);
            }}
          />
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => applyJson()}>
              校验并同步到树形
            </Button>
          </div>
        </div>
      ) : definition ? (
        <div className="overflow-x-auto rounded-lg border bg-muted/20 p-6">
          <div className="flex min-w-max justify-center">
            <FlowTree
              definition={definition}
              connector={{ entry: true }}
              selectedId={selectedId}
              issues={issues}
              canEdit={canEdit}
              onSelect={(nodeId) => {
                setSelectedId(nodeId);
                setSheetOpen(true);
              }}
              onInsert={handleInsert}
              onFork={handleFork}
              onAddBranch={handleAddBranch}
              onRemoveBranch={handleRemoveBranch}
              onDelete={handleDelete}
            />
          </div>
        </div>
      ) : (
        <Alert variant="destructive">
          <AlertTitle>草稿定义无法解析</AlertTitle>
          <AlertDescription>
            请切到 JSON 视图修正结构，或从模板重新搭建流程。
          </AlertDescription>
        </Alert>
      )}

      <NodeConfigSheet
        definition={definition ?? cloneDefinition({ schemaVersion: 1, entry: "", nodes: [] })}
        nodeId={selectedId}
        open={sheetOpen}
        roles={roles}
        users={users}
        canEdit={canEdit}
        onOpenChange={setSheetOpen}
        onApply={handleApply}
      />
    </div>
  );
}

function mergeIssues(
  client: FlowValidationIssue[],
  server: FlowValidationIssue[],
): FlowValidationIssue[] {
  const seen = new Set(client.map((issue) => `${issue.code}:${issue.nodeId ?? ""}`));
  const merged = [...client];
  for (const issue of server) {
    const key = `${issue.code}:${issue.nodeId ?? ""}`;
    if (!seen.has(key)) {
      merged.push(issue);
    }
  }
  return merged;
}

function safeParseIssues(raw?: string): FlowValidationIssue[] | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as FlowValidationIssue[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
