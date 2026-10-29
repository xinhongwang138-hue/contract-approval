"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ListTree, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  bindTemplateFlowAction,
} from "@/server/actions/flows";
import { saveTemplateAction, toggleTemplateActiveAction } from "@/server/actions/templates";

export type TemplateRow = {
  id: string;
  code: string;
  name: string;
  category: string;
  active: boolean;
  fieldCount: number;
  contractCount: number;
  flowId: string | null;
  flowName: string | null;
  updatedAtLabel: string;
};

export type FlowChoice = { id: string; name: string; code: string; latestVersion: number };

type FormState = {
  code: string;
  name: string;
  category: string;
  active: boolean;
  flowId: string;
};

const EMPTY_FORM: FormState = {
  code: "",
  name: "",
  category: "",
  active: true,
  flowId: "",
};

export function TemplateManager({
  templates,
  flows,
}: {
  templates: TemplateRow[];
  flows: FlowChoice[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, startSaving] = useTransition();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [, startToggling] = useTransition();

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setDialogOpen(true);
  }

  function openEdit(row: TemplateRow) {
    setEditing(row);
    setForm({
      code: row.code,
      name: row.name,
      category: row.category,
      active: row.active,
      flowId: row.flowId ?? "",
    });
    setFieldErrors({});
    setDialogOpen(true);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData();
    if (editing) {
      data.set("id", editing.id);
    }
    data.set("code", form.code);
    data.set("name", form.name);
    data.set("category", form.category);
    data.set("active", form.active ? "true" : "false");

    startSaving(async () => {
      const result = await saveTemplateAction(data);
      if (!result.ok) {
        setFieldErrors(result.fields ?? {});
        toast.error(result.message);
        return;
      }

      const previousFlowId = editing?.flowId ?? "";
      if (form.flowId !== previousFlowId) {
        const bound = await bindTemplateFlowAction(result.data.id, form.flowId || null);
        if (!bound.ok) {
          toast.error(bound.message);
          return;
        }
      }

      toast.success(editing ? "模板已更新" : "模板已创建，请继续配置字段");
      setDialogOpen(false);
    });
  }

  function handleToggle(row: TemplateRow, active: boolean) {
    setTogglingId(row.id);
    startToggling(async () => {
      const result = await toggleTemplateActiveAction(row.id, active);
      if (!result.ok) {
        toast.error(result.message);
      } else {
        toast.success(active ? `已启用「${row.name}」` : `已停用「${row.name}」`);
      }
      setTogglingId(null);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          新建模板
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>模板名称</TableHead>
              <TableHead>编码</TableHead>
              <TableHead>分类</TableHead>
              <TableHead>关联审批流</TableHead>
              <TableHead className="text-right">字段数</TableHead>
              <TableHead className="text-right">关联合同</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>更新时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  暂无合同模板，点击右上角新建。
                </TableCell>
              </TableRow>
            ) : (
              templates.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="font-mono text-xs">{row.code}</TableCell>
                  <TableCell>{row.category}</TableCell>
                  <TableCell className="text-sm">
                    {row.flowName ?? <span className="text-muted-foreground">未关联</span>}
                  </TableCell>
                  <TableCell className="text-right">{row.fieldCount}</TableCell>
                  <TableCell className="text-right">{row.contractCount}</TableCell>
                  <TableCell>
                    {row.active ? (
                      <Badge variant="secondary">启用</Badge>
                    ) : (
                      <Badge variant="outline">停用</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.updatedAtLabel}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/admin/templates/${row.id}/fields`}>
                          <ListTree className="size-4" />
                          字段设计
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(row)}
                      >
                        <Pencil className="size-4" />
                        编辑
                      </Button>
                      <Switch
                        checked={row.active}
                        disabled={togglingId === row.id}
                        onCheckedChange={(checked) => handleToggle(row, checked)}
                        aria-label={row.active ? "停用模板" : "启用模板"}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{editing ? "编辑合同模板" : "新建合同模板"}</DialogTitle>
              <DialogDescription>
                模板编码用于生成合同编号，创建后不可修改；字段在「字段设计」中配置。
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="template-code">模板编码</Label>
                <Input
                  id="template-code"
                  value={form.code}
                  disabled={editing !== null}
                  placeholder="例如 SALES"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      code: event.target.value.toUpperCase(),
                    }))
                  }
                />
                {fieldErrors["code"] ? (
                  <p className="text-xs text-destructive">{fieldErrors["code"]}</p>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="template-name">模板名称</Label>
                <Input
                  id="template-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
                {fieldErrors["name"] ? (
                  <p className="text-xs text-destructive">{fieldErrors["name"]}</p>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="template-category">分类</Label>
                <Input
                  id="template-category"
                  value={form.category}
                  placeholder="例如 销售、采购"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      category: event.target.value,
                    }))
                  }
                />
                {fieldErrors["category"] ? (
                  <p className="text-xs text-destructive">{fieldErrors["category"]}</p>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="template-flow">关联审批流</Label>
                <Select
                  value={form.flowId || "none"}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      flowId: value === "none" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger id="template-flow" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">暂不关联</SelectItem>
                    {flows
                      .filter((flow) => flow.latestVersion > 0)
                      .map((flow) => (
                        <SelectItem key={flow.id} value={flow.id}>
                          {flow.name}（v{flow.latestVersion}）
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  只能关联已发布的流程；合同提交时按模板关联的流程开实例。
                </p>
              </div>

              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">启用模板</p>
                  <p className="text-xs text-muted-foreground">
                    停用后不可再用于新建合同，已创建的合同不受影响。
                  </p>
                </div>
                <Switch
                  checked={form.active}
                  onCheckedChange={(checked) =>
                    setForm((current) => ({ ...current, active: checked }))
                  }
                />
              </div>
            </div>

            <DialogFooter className="sticky -bottom-4 z-10 bg-muted">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  取消
                </Button>
              </DialogClose>
              <Button type="submit" disabled={saving}>
                {saving ? "保存中…" : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
