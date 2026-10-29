"use client";

import { AlertCircle, CornerDownRight, Plus, Repeat, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FlowValidationIssue } from "@/server/flow/validate";
import {
  NODE_TYPE_LABELS,
  findNode,
  idOf,
  isDefaultBranch,
  labelOf,
  isFork,
  nodeSummary,
  nodeName,
  nodeType,
  readBranches,
  readTargets,
  type FlowNodeType,
  type TargetRef,
  type DefinitionRecord,
} from "./flow-node-utils";

const INSERTABLE: FlowNodeType[] = ["approval", "cc", "condition", "join", "action"];

type TreeProps = {
  definition: DefinitionRecord;
  connector: TargetRef;
  selectedId: string | null;
  issues: FlowValidationIssue[];
  canEdit: boolean;
  onSelect: (nodeId: string) => void;
  onInsert: (ref: TargetRef, type: FlowNodeType) => void;
  onFork: (ref: TargetRef) => void;
  onAddBranch: (nodeId: string) => void;
  onRemoveBranch: (nodeId: string, branchId: string) => void;
  onDelete: (nodeId: string) => void;
  visited?: Set<string>;
};

function Connector({
  connector,
  canEdit,
  onInsert,
  onFork,
}: {
  connector: TargetRef;
  canEdit: boolean;
  onInsert: (item: TargetRef, type: FlowNodeType) => void;
  onFork: (item: TargetRef) => void;
}) {
  if (connector.entry) {
    return null;
  }
  if (!canEdit) {
    return <div className="my-1 h-4 w-px bg-border" />;
  }
  return (
    <div className="group relative my-1 flex items-center justify-center">
      <div className="h-4 w-px bg-border" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="absolute size-6 rounded-full bg-background text-xs shadow-none"
            aria-label="在此处添加节点"
          >
            <Plus className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {INSERTABLE.map((type) => (
            <DropdownMenuItem key={type} onSelect={() => onInsert(connector, type)}>
              {NODE_TYPE_LABELS[type]}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => onFork(connector)}>
            拆分为并行分支
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="h-4 w-px bg-border" />
    </div>
  );
}

function NodeCard({
  nodeId,
  definition,
  selected,
  issues,
  canEdit,
  onSelect,
  onDelete,
}: {
  nodeId: string;
  definition: DefinitionRecord;
  selected: boolean;
  issues: FlowValidationIssue[];
  canEdit: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const node = findNode(definition, nodeId);
  const type = nodeType(node);
  const own = issues.filter((issue) => issue.nodeId === nodeId);
  const errors = own.filter((issue) => issue.level === "error");

  return (
    <div
      className={[
        "w-72 rounded-lg border bg-card p-3 shadow-xs transition",
        selected ? "border-primary ring-2 ring-primary/20" : "",
        errors.length > 0 ? "border-destructive/60" : "",
      ].join(" ")}
    >
      <div className="mb-1 flex items-center gap-2">
        <Badge variant={type === "end" ? "destructive" : "secondary"} className="shrink-0">
          {NODE_TYPE_LABELS[type]}
        </Badge>
        <button
          type="button"
          onClick={() => onSelect(nodeId)}
          className="truncate text-sm font-medium hover:underline"
        >
          {nodeName(node)}
        </button>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{nodeId}</span>
        {canEdit && type !== "start" && type !== "end" ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-6"
            onClick={() => onDelete(nodeId)}
            aria-label={`删除节点 ${nodeId}`}
          >
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{node ? nodeSummary(node) : "节点缺失"}</p>
      {errors.length > 0 ? (
        <p className="mt-1 flex items-start gap-1 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3 shrink-0" />
          {errors[0]?.message}
        </p>
      ) : null}
    </div>
  );
}

export function FlowTree({
  definition,
  connector,
  selectedId,
  issues,
  canEdit,
  onSelect,
  onInsert,
  onFork,
  onAddBranch,
  onRemoveBranch,
  onDelete,
  visited = new Set<string>(),
}: TreeProps) {
  const target = connector.entry
    ? definition.entry
    : readTargets(pickOwner(definition, connector), connector.branchId)[connector.index ?? 0];
  const nodeId = typeof target === "string" ? target : "";

  if (!nodeId) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        该分支缺少目标节点
      </div>
    );
  }

  if (visited.has(nodeId)) {
    return (
      <div className="flex w-72 items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
        <Repeat className="size-4" />
        指向已渲染的节点 {nodeId}（定义存在环路）
      </div>
    );
  }

  const node = findNode(definition, nodeId);
  const type = nodeType(node);
  const nextVisited = new Set([...visited, nodeId]);
  const childConnector: TargetRef = { nodeId };

  if (type === "condition") {
    const branches = readBranches(node);
    return (
      <div className="flex flex-col items-center">
        <Connector connector={connector} canEdit={canEdit} onInsert={onInsert} onFork={onFork} />
        <NodeCard
          nodeId={nodeId}
          definition={definition}
          selected={selectedId === nodeId}
          issues={issues}
          canEdit={canEdit}
          onSelect={onSelect}
          onDelete={onDelete}
        />
        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-start">
          {branches.map((branch) => {
            const branchTargets = readTargets(node, idOf(branch));
            return (
              <div
                key={idOf(branch)}
                className="flex-1 rounded-lg border border-dashed bg-muted/30 p-3"
              >
                <div className="mb-2 flex items-center gap-2 text-xs">
                  <CornerDownRight className="size-3.5 text-muted-foreground" />
                  <span className="font-medium">{labelOf(branch, "未命名分支")}</span>
                  <span className="text-muted-foreground">
                    {isDefaultBranch(branch) ? "默认分支" : "条件命中"}
                  </span>
                  {canEdit && !isDefaultBranch(branch) ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-6 px-2 text-xs"
                      onClick={() => onRemoveBranch(nodeId, idOf(branch))}
                    >
                      删除分支
                    </Button>
                  ) : null}
                </div>
                {branchTargets.length <= 1 ? (
                  <FlowTree
                    definition={definition}
                    connector={{ nodeId, branchId: idOf(branch) }}
                    selectedId={selectedId}
                    issues={issues}
                    canEdit={canEdit}
                    onSelect={onSelect}
                    onInsert={onInsert}
                    onFork={onFork}
                    onAddBranch={onAddBranch}
                    onRemoveBranch={onRemoveBranch}
                    onDelete={onDelete}
                    visited={nextVisited}
                  />
                ) : (
                  <ForkGroup
                    definition={definition}
                    nodeId={nodeId}
                    branchId={idOf(branch)}
                    targets={branchTargets}
                    visited={nextVisited}
                    {...{
                      selectedId,
                      issues,
                      canEdit,
                      onSelect,
                      onInsert,
                      onFork,
                      onAddBranch,
                      onRemoveBranch,
                      onDelete,
                    }}
                  />
                )}
              </div>
            );
          })}
          {canEdit ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onAddBranch(nodeId)}
            >
              <Plus className="size-4" />
              添加分支
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const targets = readTargets(node);
  if (isFork(node)) {
    return (
      <div className="flex flex-col items-center">
        <Connector connector={connector} canEdit={canEdit} onInsert={onInsert} onFork={onFork} />
        <NodeCard
          nodeId={nodeId}
          definition={definition}
          selected={selectedId === nodeId}
          issues={issues}
          canEdit={canEdit}
          onSelect={onSelect}
          onDelete={onDelete}
        />
        <ForkGroup
          definition={definition}
          nodeId={nodeId}
          targets={targets}
          visited={nextVisited}
          {...{
            selectedId,
            issues,
            canEdit,
            onSelect,
            onInsert,
            onFork,
            onAddBranch,
            onRemoveBranch,
            onDelete,
          }}
        />
      </div>
    );
  }

  if (type === "end" || targets.length === 0) {
    return (
      <div className="flex flex-col items-center">
        <Connector connector={connector} canEdit={canEdit} onInsert={onInsert} onFork={onFork} />
        <NodeCard
          nodeId={nodeId}
          definition={definition}
          selected={selectedId === nodeId}
          issues={issues}
          canEdit={canEdit}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <Connector connector={connector} canEdit={canEdit} onInsert={onInsert} onFork={onFork} />
      <NodeCard
        nodeId={nodeId}
        definition={definition}
        selected={selectedId === nodeId}
        issues={issues}
        canEdit={canEdit}
        onSelect={onSelect}
        onDelete={onDelete}
      />
      <FlowTree
        definition={definition}
        connector={childConnector}
        selectedId={selectedId}
        issues={issues}
        canEdit={canEdit}
        onSelect={onSelect}
        onInsert={onInsert}
        onFork={onFork}
        onAddBranch={onAddBranch}
        onRemoveBranch={onRemoveBranch}
        onDelete={onDelete}
        visited={nextVisited}
      />
    </div>
  );
}

function pickOwner(definition: DefinitionRecord, ref: TargetRef) {
  if (ref.entry || !ref.nodeId) {
    return undefined;
  }
  return findNode(definition, ref.nodeId);
}

function ForkGroup(props: {
  definition: DefinitionRecord;
  nodeId: string;
  branchId?: string;
  targets: string[];
  visited: Set<string>;
  selectedId: string | null;
  issues: FlowValidationIssue[];
  canEdit: boolean;
  onSelect: (id: string) => void;
  onInsert: (ref: TargetRef, type: FlowNodeType) => void;
  onFork: (ref: TargetRef) => void;
  onAddBranch: (nodeId: string) => void;
  onRemoveBranch: (nodeId: string, branchId: string) => void;
  onDelete: (id: string) => void;
}) {
  const {
    definition,
    nodeId,
    branchId,
    targets,
    visited,
    selectedId,
    issues,
    canEdit,
    onSelect,
    onInsert,
    onFork,
    onAddBranch,
    onRemoveBranch,
    onDelete,
  } = props;

  return (
    <div className="mt-1 flex flex-col items-center gap-3 lg:flex-row lg:items-start">
      {targets.map((_, index) => (
        <div key={index} className="rounded-lg border border-dashed bg-muted/30 p-3">
          <p className="mb-1 text-xs text-muted-foreground">并行分支 {index + 1}</p>
          <FlowTree
            definition={definition}
            connector={{ nodeId, branchId, index }}
            selectedId={selectedId}
            issues={issues}
            canEdit={canEdit}
            onSelect={onSelect}
            onInsert={onInsert}
            onFork={onFork}
            onAddBranch={onAddBranch}
            onRemoveBranch={onRemoveBranch}
            onDelete={onDelete}
            visited={visited}
          />
        </div>
      ))}
    </div>
  );
}
