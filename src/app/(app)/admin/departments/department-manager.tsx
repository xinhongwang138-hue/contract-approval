"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  saveDepartmentAction,
  deleteDepartmentAction,
} from "@/server/actions/departments";
import type { DepartmentRow } from "./types";

const NONE = "__none__";

type ManagerOption = { id: string; name: string };

export function DepartmentManager({
  rows,
  managers,
}: {
  rows: DepartmentRow[];
  managers: ManagerOption[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DepartmentRow | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState(NONE);
  const [managerUserId, setManagerUserId] = useState(NONE);
  const [sortOrder, setSortOrder] = useState("0");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, startSaving] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<DepartmentRow | null>(null);
  const [deleting, startDeleting] = useTransition();

  function resetForm(next: {
    row: DepartmentRow | null;
    parentId: string;
  }) {
    setEditing(next.row);
    setName(next.row?.name ?? "");
    setParentId(next.parentId);
    setManagerUserId(next.row?.managerId ?? NONE);
    setSortOrder(String(next.row?.sortOrder ?? 0));
    setFieldErrors({});
    setFormKey((key) => key + 1);
    setDialogOpen(true);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData();
    if (editing) {
      data.set("id", editing.id);
    }
    data.set("name", name);
    data.set("parentId", parentId === NONE ? "" : parentId);
    data.set("managerUserId", managerUserId === NONE ? "" : managerUserId);
    data.set("sortOrder", sortOrder);

    startSaving(async () => {
      const result = await saveDepartmentAction(data);
      if (result.ok) {
        toast.success(editing ? "部门已更新" : "部门已创建");
        setDialogOpen(false);
        return;
      }
      setFieldErrors(result.fields ?? {});
      toast.error(result.message);
    });
  }

  function handleDelete() {
    if (!deleteTarget) {
      return;
    }
    const target = deleteTarget;
    startDeleting(async () => {
      const result = await deleteDepartmentAction(target.id);
      if (result.ok) {
        toast.success(`已删除「${target.name}」`);
      } else {
        toast.error(result.message);
      }
      setDeleteTarget(null);
    });
  }

  function parentDisabled(row: DepartmentRow): boolean {
    if (!editing) {
      return false;
    }
    return (
      row.id === editing.id ||
      row.path === editing.path ||
      row.path.startsWith(`${editing.path}/`)
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => resetForm({ row: null, parentId: NONE })}>
          <Plus className="size-4" />
          新建部门
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>部门</TableHead>
              <TableHead>负责人</TableHead>
              <TableHead className="text-right">在岗人数</TableHead>
              <TableHead className="text-right">排序</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  还没有部门，先创建根部门
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <span
                      className="inline-flex items-center gap-2"
                      style={{ paddingLeft: `${row.level * 1.25}rem` }}
                    >
                      {row.level > 0 ? (
                        <span className="text-muted-foreground">└</span>
                      ) : null}
                      <span className="font-medium">{row.name}</span>
                      {row.level === 0 ? (
                        <Badge variant="secondary">根部门</Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>
                    {row.managerName ?? (
                      <span className="text-muted-foreground">未指定</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.userCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.sortOrder}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`在 ${row.name} 下新建子部门`}
                        onClick={() => resetForm({ row: null, parentId: row.id })}
                      >
                        <Plus className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`编辑 ${row.name}`}
                        onClick={() => resetForm({ row, parentId: row.parentId ?? NONE })}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`删除 ${row.name}`}
                        onClick={() => setDeleteTarget(row)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent key={formKey}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{editing ? "编辑部门" : "新建部门"}</DialogTitle>
              <DialogDescription>
                部门层级决定数据范围，调整上级会同步移动整个子树。
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="department-name">部门名称</Label>
                <Input
                  id="department-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={50}
                  autoFocus
                />
                {fieldErrors.name ? (
                  <p className="text-xs text-destructive">{fieldErrors.name}</p>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="department-parent">上级部门</Label>
                <Select value={parentId} onValueChange={setParentId}>
                  <SelectTrigger id="department-parent" className="w-full">
                    <SelectValue placeholder="选择上级部门" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>无（根部门）</SelectItem>
                    {rows.map((row) => (
                      <SelectItem
                        key={row.id}
                        value={row.id}
                        disabled={parentDisabled(row)}
                      >
                        {"　".repeat(row.level)}
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldErrors.parentId ? (
                  <p className="text-xs text-destructive">{fieldErrors.parentId}</p>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="department-manager">部门负责人</Label>
                <Select value={managerUserId} onValueChange={setManagerUserId}>
                  <SelectTrigger id="department-manager" className="w-full">
                    <SelectValue placeholder="选择负责人" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>未指定</SelectItem>
                    {managers.map((manager) => (
                      <SelectItem key={manager.id} value={manager.id}>
                        {manager.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldErrors.managerUserId ? (
                  <p className="text-xs text-destructive">
                    {fieldErrors.managerUserId}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="department-sort">排序</Label>
                <Input
                  id="department-sort"
                  type="number"
                  min={0}
                  max={9999}
                  value={sortOrder}
                  onChange={(event) => setSortOrder(event.target.value)}
                />
                {fieldErrors.sortOrder ? (
                  <p className="text-xs text-destructive">{fieldErrors.sortOrder}</p>
                ) : null}
              </div>
            </div>

            <DialogFooter>
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

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除部门「{deleteTarget?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              存在下级部门、在岗用户或被角色数据范围引用时无法删除。删除为软删除，历史数据保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                handleDelete();
              }}
            >
              {deleting ? "删除中…" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
