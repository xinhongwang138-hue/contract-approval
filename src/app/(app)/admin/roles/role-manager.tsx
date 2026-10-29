"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  PERMISSION_DEFINITIONS,
  PERMISSION_KEYS,
  type PermissionKey,
} from "@/shared/permissions";
import { deleteRoleAction, saveRoleAction } from "@/server/actions/roles";

const NONE = "__none__";

const SCOPE_LABELS = {
  self: "仅本人",
  dept: "本部门",
  dept_and_sub: "本部门及下级",
  all: "全部",
} as const;

type DataScope = keyof typeof SCOPE_LABELS;

export type RoleRow = {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
  scope: DataScope;
  departmentId: string | null;
  departmentName: string | null;
  permissionKeys: PermissionKey[];
  userCount: number;
};

type DepartmentOption = { id: string; name: string; level: number };

type FormState = {
  key: string;
  name: string;
  scope: DataScope;
  departmentId: string;
  permissionKeys: PermissionKey[];
};

const EMPTY_FORM: FormState = {
  key: "",
  name: "",
  scope: "self",
  departmentId: NONE,
  permissionKeys: [],
};

const PERMISSION_GROUPS = [...new Set(PERMISSION_KEYS.map((key) => PERMISSION_DEFINITIONS[key].group))];

export function RoleManager({
  roles,
  departments,
}: {
  roles: RoleRow[];
  departments: DepartmentOption[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formKey, setFormKey] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, startSaving] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);
  const [deleting, startDeleting] = useTransition();

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormKey((key) => key + 1);
    setDialogOpen(true);
  }

  function openEdit(row: RoleRow) {
    setEditing(row);
    setForm({
      key: row.key,
      name: row.name,
      scope: row.scope,
      departmentId: row.departmentId ?? NONE,
      permissionKeys: row.permissionKeys,
    });
    setFieldErrors({});
    setFormKey((key) => key + 1);
    setDialogOpen(true);
  }

  function togglePermission(key: PermissionKey, checked: boolean) {
    setForm((current) => ({
      ...current,
      permissionKeys: checked
        ? [...current.permissionKeys, key]
        : current.permissionKeys.filter((item) => item !== key),
    }));
  }

  function changeScope(scope: DataScope) {
    setForm((current) => ({
      ...current,
      scope,
      departmentId:
        scope === "self" || scope === "all" ? NONE : current.departmentId,
    }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData();
    if (editing) {
      data.set("id", editing.id);
    } else {
      data.set("key", form.key);
    }
    data.set("name", form.name);
    data.set("scope", form.scope);
    data.set("departmentId", form.departmentId === NONE ? "" : form.departmentId);
    for (const key of form.permissionKeys) {
      data.append("permissionKeys", key);
    }

    startSaving(async () => {
      const result = await saveRoleAction(data);
      if (result.ok) {
        toast.success(editing ? "角色已更新" : "角色已创建");
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
      const result = await deleteRoleAction(target.id);
      if (result.ok) {
        toast.success(`已删除角色「${target.name}」`);
      } else {
        toast.error(result.message);
      }
      setDeleteTarget(null);
    });
  }

  const needsDepartment = form.scope === "dept" || form.scope === "dept_and_sub";

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          新建角色
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>角色</TableHead>
              <TableHead>数据范围</TableHead>
              <TableHead>权限</TableHead>
              <TableHead className="text-right">用户数</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{row.name}</span>
                    {row.isSystem ? (
                      <Badge variant="secondary">系统</Badge>
                    ) : null}
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {row.key}
                  </span>
                </TableCell>
                <TableCell>
                  <span>{SCOPE_LABELS[row.scope]}</span>
                  {row.scope === "dept" || row.scope === "dept_and_sub" ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      {row.departmentName ?? "（用户自身部门）"}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <span className="text-sm tabular-nums">
                    {row.permissionKeys.length} 项
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.userCount}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`编辑 ${row.name}`}
                      disabled={row.isSystem}
                      onClick={() => openEdit(row)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`删除 ${row.name}`}
                      disabled={row.isSystem || row.userCount > 0}
                      onClick={() => setDeleteTarget(row)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">权限矩阵</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-40">权限</TableHead>
                {roles.map((role) => (
                  <TableHead key={role.id} className="text-center">
                    {role.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {PERMISSION_GROUPS.flatMap((group) => {
                const groupRows = PERMISSION_KEYS.filter(
                  (key) => PERMISSION_DEFINITIONS[key].group === group,
                );
                return [
                  <TableRow key={`group-${group}`}>
                    <TableCell
                      colSpan={roles.length + 1}
                      className="bg-muted/50 text-xs font-medium text-muted-foreground"
                    >
                      {group}
                    </TableCell>
                  </TableRow>,
                  ...groupRows.map((key) => (
                    <TableRow key={key}>
                      <TableCell>{PERMISSION_DEFINITIONS[key].name}</TableCell>
                      {roles.map((role) => (
                        <TableCell key={role.id} className="text-center">
                          {role.permissionKeys.includes(key) ? (
                            <Check className="mx-auto size-4 text-emerald-600" />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  )),
                ];
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent key={formKey} className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{editing ? "编辑角色" : "新建角色"}</DialogTitle>
              <DialogDescription>
                权限决定可执行的动作，数据范围决定可访问的数据。系统角色只读。
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="role-name">角色名称</Label>
                <Input
                  id="role-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                  maxLength={30}
                  autoFocus
                />
                {fieldErrors.name ? (
                  <p className="text-xs text-destructive">{fieldErrors.name}</p>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="role-key">角色标识</Label>
                <Input
                  id="role-key"
                  value={form.key}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, key: event.target.value }))
                  }
                  disabled={editing !== null}
                  placeholder="例如 project_manager"
                  className="font-mono"
                />
                {fieldErrors.key ? (
                  <p className="text-xs text-destructive">{fieldErrors.key}</p>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="role-scope">数据范围</Label>
                <Select
                  value={form.scope}
                  onValueChange={(value) =>
                    changeScope(
                      value === "dept" ||
                        value === "dept_and_sub" ||
                        value === "all"
                        ? value
                        : "self",
                    )
                  }
                >
                  <SelectTrigger id="role-scope" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SCOPE_LABELS) as DataScope[]).map((scope) => (
                      <SelectItem key={scope} value={scope}>
                        {SCOPE_LABELS[scope]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldErrors.scope ? (
                  <p className="text-xs text-destructive">{fieldErrors.scope}</p>
                ) : null}
              </div>

              {needsDepartment ? (
                <div className="grid gap-2">
                  <Label htmlFor="role-department">范围部门</Label>
                  <Select
                    value={form.departmentId}
                    onValueChange={(value) =>
                      setForm((current) => ({ ...current, departmentId: value }))
                    }
                  >
                    <SelectTrigger id="role-department" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>用户自身部门</SelectItem>
                      {departments.map((department) => (
                        <SelectItem key={department.id} value={department.id}>
                          {"　".repeat(department.level)}
                          {department.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fieldErrors.departmentId ? (
                    <p className="text-xs text-destructive">
                      {fieldErrors.departmentId}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label>权限</Label>
              <div className="space-y-3 rounded-md border p-3">
                {PERMISSION_GROUPS.map((group) => (
                  <div key={group} className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {group}
                    </p>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {PERMISSION_KEYS.filter(
                        (key) => PERMISSION_DEFINITIONS[key].group === group,
                      ).map((key) => (
                        <label
                          key={key}
                          className="flex items-center gap-2 text-sm"
                        >
                          <Checkbox
                            checked={form.permissionKeys.includes(key)}
                            onCheckedChange={(value) =>
                              togglePermission(key, value === true)
                            }
                          />
                          <span>{PERMISSION_DEFINITIONS[key].name}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {key}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {fieldErrors.permissionKeys ? (
                <p className="text-xs text-destructive">
                  {fieldErrors.permissionKeys}
                </p>
              ) : null}
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
            <AlertDialogTitle>删除角色「{deleteTarget?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              系统角色与仍被用户使用的角色不可删除。删除后权限与数据范围一并失效。
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
