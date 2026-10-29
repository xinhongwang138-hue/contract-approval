"use client";

import { useState, useTransition } from "react";
import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  deleteUserAction,
  resetUserPasswordAction,
  saveUserAction,
} from "@/server/actions/users";

const NONE = "__none__";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  status: "active" | "disabled";
  departmentId: string | null;
  departmentName: string | null;
  managerId: string | null;
  managerName: string | null;
  roles: { id: string; name: string }[];
  createdAtLabel: string;
};

type DepartmentOption = { id: string; name: string; level: number };
type RoleOption = { id: string; name: string; isSystem: boolean };
type PersonOption = { id: string; name: string; email: string };

type FormState = {
  name: string;
  email: string;
  password: string;
  departmentId: string;
  managerUserId: string;
  status: "active" | "disabled";
  roleIds: string[];
};

const EMPTY_FORM: FormState = {
  name: "",
  email: "",
  password: "",
  departmentId: NONE,
  managerUserId: NONE,
  status: "active",
  roleIds: [],
};

export function UserManager({
  users,
  departments,
  roles,
  people,
  currentUserId,
}: {
  users: UserRow[];
  departments: DepartmentOption[];
  roles: RoleOption[];
  people: PersonOption[];
  currentUserId: string;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formKey, setFormKey] = useState(0);
  const [saving, startSaving] = useTransition();
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetErrors, setResetErrors] = useState<Record<string, string>>({});
  const [resetting, startResetting] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [deleting, startDeleting] = useTransition();

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormKey((key) => key + 1);
    setDialogOpen(true);
  }

  function openEdit(row: UserRow) {
    setEditing(row);
    setForm({
      name: row.name,
      email: row.email,
      password: "",
      departmentId: row.departmentId ?? NONE,
      managerUserId: row.managerId ?? NONE,
      status: row.status,
      roleIds: row.roles.map((role) => role.id),
    });
    setFieldErrors({});
    setFormKey((key) => key + 1);
    setDialogOpen(true);
  }

  function toggleRole(roleId: string, checked: boolean) {
    setForm((current) => ({
      ...current,
      roleIds: checked
        ? [...current.roleIds, roleId]
        : current.roleIds.filter((id) => id !== roleId),
    }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData();
    if (editing) {
      data.set("id", editing.id);
    }
    data.set("name", form.name);
    data.set("departmentId", form.departmentId === NONE ? "" : form.departmentId);
    data.set("managerUserId", form.managerUserId === NONE ? "" : form.managerUserId);
    data.set("status", form.status);
    for (const roleId of form.roleIds) {
      data.append("roleIds", roleId);
    }
    if (!editing) {
      data.set("email", form.email);
      data.set("password", form.password);
    }

    startSaving(async () => {
      const result = await saveUserAction(data);
      if (result.ok) {
        toast.success(editing ? "用户已更新" : "用户已创建");
        setDialogOpen(false);
        return;
      }
      setFieldErrors(result.fields ?? {});
      toast.error(result.message);
    });
  }

  function openReset(row: UserRow) {
    setResetTarget(row);
    setNewPassword("");
    setResetErrors({});
  }

  function handleReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetTarget) {
      return;
    }
    const data = new FormData();
    data.set("userId", resetTarget.id);
    data.set("password", newPassword);

    startResetting(async () => {
      const result = await resetUserPasswordAction(data);
      if (result.ok) {
        toast.success("密码已重置，该用户所有会话已下线");
        setResetTarget(null);
        return;
      }
      setResetErrors(result.fields ?? {});
      toast.error(result.message);
    });
  }

  function handleDelete() {
    if (!deleteTarget) {
      return;
    }
    const target = deleteTarget;
    startDeleting(async () => {
      const result = await deleteUserAction(target.id);
      if (result.ok) {
        toast.success(`已删除用户「${target.name}」`);
      } else {
        toast.error(result.message);
      }
      setDeleteTarget(null);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          新建用户
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead>部门</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  没有符合条件的用户
                </TableCell>
              </TableRow>
            ) : (
              users.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{row.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {row.email}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {row.departmentName ?? (
                      <span className="text-muted-foreground">未分配</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {row.roles.length === 0 ? (
                        <span className="text-muted-foreground">无角色</span>
                      ) : (
                        row.roles.map((role) => (
                          <Badge key={role.id} variant="secondary">
                            {role.name}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {row.status === "active" ? (
                      <Badge variant="outline">启用</Badge>
                    ) : (
                      <Badge variant="destructive">停用</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.createdAtLabel}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`编辑 ${row.name}`}
                        onClick={() => openEdit(row)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`重置 ${row.name} 的密码`}
                        onClick={() => openReset(row)}
                      >
                        <KeyRound className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`删除 ${row.name}`}
                        disabled={row.id === currentUserId}
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
        <DialogContent key={formKey} className="max-h-[90vh] overflow-y-auto">
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{editing ? "编辑用户" : "新建用户"}</DialogTitle>
              <DialogDescription>
                角色决定权限与数据范围；直属上级会出现在按上级审批的流程节点中。
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="user-name">姓名</Label>
                <Input
                  id="user-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                  maxLength={50}
                  autoFocus
                />
                {fieldErrors.name ? (
                  <p className="text-xs text-destructive">{fieldErrors.name}</p>
                ) : null}
              </div>

              {editing ? null : (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="user-email">邮箱</Label>
                    <Input
                      id="user-email"
                      type="email"
                      autoComplete="off"
                      value={form.email}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                    />
                    {fieldErrors.email ? (
                      <p className="text-xs text-destructive">{fieldErrors.email}</p>
                    ) : null}
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="user-password">初始密码</Label>
                    <Input
                      id="user-password"
                      type="password"
                      autoComplete="new-password"
                      value={form.password}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          password: event.target.value,
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      至少 10 位，需同时包含字母和数字
                    </p>
                    {fieldErrors.password ? (
                      <p className="text-xs text-destructive">
                        {fieldErrors.password}
                      </p>
                    ) : null}
                  </div>
                </>
              )}

              <div className="grid gap-2">
                <Label htmlFor="user-department">部门</Label>
                <Select
                  value={form.departmentId}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, departmentId: value }))
                  }
                >
                  <SelectTrigger id="user-department" className="w-full">
                    <SelectValue placeholder="选择部门" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>未分配</SelectItem>
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

              <div className="grid gap-2">
                <Label htmlFor="user-manager">直属上级</Label>
                <Select
                  value={form.managerUserId}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, managerUserId: value }))
                  }
                >
                  <SelectTrigger id="user-manager" className="w-full">
                    <SelectValue placeholder="选择直属上级" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>未指定</SelectItem>
                    {people
                      .filter((person) => person.id !== editing?.id)
                      .map((person) => (
                        <SelectItem key={person.id} value={person.id}>
                          {person.name}（{person.email}）
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
                <Label>角色</Label>
                <div className="grid gap-2 rounded-md border p-3">
                  {roles.map((role) => {
                    const checked = form.roleIds.includes(role.id);
                    return (
                      <label
                        key={role.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) =>
                            toggleRole(role.id, value === true)
                          }
                        />
                        <span>{role.name}</span>
                        {role.isSystem ? (
                          <span className="text-xs text-muted-foreground">
                            系统角色
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
                {fieldErrors.roleIds ? (
                  <p className="text-xs text-destructive">{fieldErrors.roleIds}</p>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="user-status">状态</Label>
                <Select
                  value={form.status}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      status: value === "disabled" ? "disabled" : "active",
                    }))
                  }
                >
                  <SelectTrigger id="user-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">启用</SelectItem>
                    <SelectItem value="disabled">停用</SelectItem>
                  </SelectContent>
                </Select>
                {editing ? (
                  <p className="text-xs text-muted-foreground">
                    停用后该用户的会话会被立即清除
                  </p>
                ) : null}
                {fieldErrors.status ? (
                  <p className="text-xs text-destructive">{fieldErrors.status}</p>
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

      <Dialog
        open={resetTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setResetTarget(null);
          }
        }}
      >
        <DialogContent>
          <form onSubmit={handleReset} className="space-y-4">
            <DialogHeader>
              <DialogTitle>重置密码</DialogTitle>
              <DialogDescription>
                为「{resetTarget?.name}」设置新密码，保存后其所有登录会话立即失效。
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="reset-password">新密码</Label>
              <Input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                至少 10 位，需同时包含字母和数字
              </p>
              {resetErrors.password ? (
                <p className="text-xs text-destructive">{resetErrors.password}</p>
              ) : null}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  取消
                </Button>
              </DialogClose>
              <Button type="submit" disabled={resetting}>
                {resetting ? "重置中…" : "确认重置"}
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
            <AlertDialogTitle>删除用户「{deleteTarget?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              删除为软删除，历史审批与审计记录保留。存在待处理审批任务时无法删除。
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
