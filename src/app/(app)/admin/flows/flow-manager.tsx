"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { History, Pencil, Plus, Rocket, Trash2, Workflow } from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteFlowAction,
  publishFlowAction,
  saveFlowMetaAction,
} from "@/server/actions/flows";

export type FlowRow = {
  id: string;
  name: string;
  code: string;
  category: string;
  latestVersion: number;
  activeVersion: number | null;
  nodeCount: number;
  templateCount: number;
  instanceCount: number;
  updatedAtLabel: string;
};

type FormState = { code: string; name: string; category: string };

const EMPTY_FORM: FormState = { code: "", name: "", category: "" };

export function FlowManager({
  flows,
  canCreate,
  canManage,
  canPublish,
}: {
  flows: FlowRow[];
  canCreate: boolean;
  canManage: boolean;
  canPublish: boolean;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FlowRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, startSaving] = useTransition();
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [, startPublishing] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startDeleting] = useTransition();

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setDialogOpen(true);
  }

  function openEdit(row: FlowRow) {
    setEditing(row);
    setForm({ code: row.code, name: row.name, category: row.category });
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

    startSaving(async () => {
      const result = await saveFlowMetaAction(data);
      if (!result.ok) {
        setFieldErrors(result.fields ?? {});
        toast.error(result.message);
        return;
      }
      toast.success(editing ? "流程已更新" : "流程已创建，请配置节点后发布");
      setDialogOpen(false);
    });
  }

  function handlePublish(row: FlowRow) {
    setPublishingId(row.id);
    startPublishing(async () => {
      const result = await publishFlowAction(row.id);
      if (result.ok) {
        toast.success(`「${row.name}」已发布为 v${result.data.version}`);
      } else {
        toast.error(result.message);
      }
      setPublishingId(null);
    });
  }

  function handleDelete(row: FlowRow) {
    setDeletingId(row.id);
    startDeleting(async () => {
      const result = await deleteFlowAction(row.id);
      if (result.ok) {
        toast.success(`已删除「${row.name}」`);
      } else {
        toast.error(result.message);
      }
      setDeletingId(null);
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">共 {flows.length} 个流程</p>
      {canCreate ? (
        <div className="flex justify-end">
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            新建流程
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>流程名称</TableHead>
              <TableHead>编码</TableHead>
              <TableHead>分类</TableHead>
              <TableHead className="text-right">草稿节点</TableHead>
              <TableHead>在用版本</TableHead>
              <TableHead className="text-right">关联模板</TableHead>
              <TableHead className="text-right">实例</TableHead>
              <TableHead>更新时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {flows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-12 text-center text-muted-foreground"
                >
                  还没有审批流程，点击右上角新建。
                </TableCell>
              </TableRow>
            ) : (
              flows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="font-mono text-xs">{row.code}</TableCell>
                  <TableCell>{row.category}</TableCell>
                  <TableCell className="text-right">{row.nodeCount}</TableCell>
                  <TableCell>
                    {row.activeVersion ? (
                      <Badge variant="secondary">v{row.activeVersion}</Badge>
                    ) : (
                      <Badge variant="outline">未发布</Badge>
                    )}
                    {row.latestVersion > 0 &&
                    row.activeVersion !== row.latestVersion ? (
                      <span className="ml-2 text-xs text-amber-700">
                        草稿待发布（v{row.latestVersion} 之后）
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">{row.templateCount}</TableCell>
                  <TableCell className="text-right">{row.instanceCount}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.updatedAtLabel}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/admin/flows/${row.id}/builder`}>
                          <Workflow className="size-4" />
                          配置
                        </Link>
                      </Button>
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/admin/flows/${row.id}/versions`}>
                          <History className="size-4" />
                          版本
                        </Link>
                      </Button>
                      {canPublish ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={publishingId === row.id}
                          onClick={() => handlePublish(row)}
                        >
                          <Rocket className="size-4" />
                          {publishingId === row.id ? "发布中…" : "发布"}
                        </Button>
                      ) : null}
                      {canManage ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(row)}
                          aria-label={`编辑 ${row.name}`}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      ) : null}
                      {canManage ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={deletingId === row.id}
                          onClick={() => handleDelete(row)}
                          aria-label={`删除 ${row.name}`}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{editing ? "编辑流程" : "新建流程"}</DialogTitle>
              <DialogDescription>
                流程编码用于区分与检索，创建后不可修改；节点在「配置」中设计。
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="flow-code">流程编码</Label>
                <Input
                  id="flow-code"
                  value={form.code}
                  disabled={editing !== null}
                  placeholder="例如 CONTRACT_STANDARD"
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
                <Label htmlFor="flow-name">
                  流程名称 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="flow-name"
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
                <Label htmlFor="flow-category">
                  分类 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="flow-category"
                  value={form.category}
                  placeholder="例如 采购、销售、通用"
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
