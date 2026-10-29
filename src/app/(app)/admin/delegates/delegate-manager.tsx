"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { UserPicker } from "@/components/user-picker";
import type { UserOption } from "@/server/actions/user-search";
import {
  deleteDelegateAction,
  saveDelegateAction,
} from "@/server/actions/delegates";
import {
  DELEGATABLE_PERMISSIONS,
  DELEGATE_PERMISSION_LABELS,
  type DelegatablePermission,
} from "@/shared/schemas/delegate";

export type DelegateRow = {
  id: string;
  from: UserOption;
  to: UserOption;
  permissionKeys: string[];
  startLabel: string;
  endLabel: string;
  reason: string;
  state: "upcoming" | "active" | "expired";
};

const STATE_LABELS: Record<DelegateRow["state"], string> = {
  upcoming: "未开始",
  active: "生效中",
  expired: "已过期",
};

type FormState = {
  id: string | null;
  fromUser: UserOption;
  toUser: UserOption | null;
  permissionKeys: DelegatablePermission[];
  startDate: string;
  endDate: string;
  reason: string;
};

export function DelegateManager({
  rows,
  selfUser,
  canPickPrincipal,
}: {
  rows: DelegateRow[];
  selfUser: UserOption;
  canPickPrincipal: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>({
    id: null,
    fromUser: selfUser,
    toUser: null,
    permissionKeys: ["contract.approve"],
    startDate: "",
    endDate: "",
    reason: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, startSaving] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startDeleting] = useTransition();

  function openCreate(): void {
    setErrors({});
    setForm({
      id: null,
      fromUser: selfUser,
      toUser: null,
      permissionKeys: ["contract.approve"],
      startDate: "",
      endDate: "",
      reason: "",
    });
    setOpen(true);
  }

  function openEdit(row: DelegateRow): void {
    setErrors({});
    setForm({
      id: row.id,
      fromUser: row.from,
      toUser: row.to,
      permissionKeys: row.permissionKeys.filter((key): key is DelegatablePermission =>
        DELEGATABLE_PERMISSIONS.includes(key as DelegatablePermission),
      ),
      startDate: row.startLabel,
      endDate: row.endLabel,
      reason: row.reason,
    });
    setOpen(true);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!form.toUser) {
      setErrors({ toUserId: "请选择受托人" });
      return;
    }
    if (form.startDate === "" || form.endDate === "") {
      setErrors({ startDate: "请选择委托起止日期" });
      return;
    }

    const data = new FormData();
    if (form.id) {
      data.set("id", form.id);
    }
    data.set("fromUserId", form.fromUser.id);
    data.set("toUserId", form.toUser.id);
    data.set("startDate", form.startDate);
    data.set("endDate", form.endDate);
    data.set("reason", form.reason);
    for (const key of form.permissionKeys) {
      data.append("permissionKeys", key);
    }

    startSaving(async () => {
      const result = await saveDelegateAction(data);
      if (!result.ok) {
        setErrors(result.fields ?? {});
        toast.error(result.message);
        return;
      }
      toast.success(form.id ? "委托已更新" : "委托已创建");
      setOpen(false);
    });
  }

  function handleDelete(row: DelegateRow): void {
    setDeletingId(row.id);
    startDeleting(async () => {
      const result = await deleteDelegateAction(row.id);
      if (result.ok) {
        toast.success("委托已删除");
      } else {
        toast.error(result.message);
      }
      setDeletingId(null);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          新建委托
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>委托人</TableHead>
              <TableHead>受托人</TableHead>
              <TableHead>委托权限</TableHead>
              <TableHead>起止日期</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>原因</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-12 text-center text-muted-foreground"
                >
                  还没有委托记录。请假或外出时，可把审批权限临时委托给同事。
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.from.name}</TableCell>
                  <TableCell>{row.to.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {row.permissionKeys.map((key) => (
                        <Badge key={key} variant="outline">
                          {DELEGATE_PERMISSION_LABELS[key as DelegatablePermission] ?? key}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.startLabel} 至 {row.endLabel}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.state === "active"
                          ? "secondary"
                          : row.state === "expired"
                            ? "outline"
                            : "default"
                      }
                    >
                      {STATE_LABELS[row.state]}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-sm">
                    {row.reason}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(row)}
                        aria-label={`编辑 ${row.from.name} → ${row.to.name} 的委托`}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deletingId === row.id}
                        onClick={() => handleDelete(row)}
                        aria-label={`删除 ${row.from.name} → ${row.to.name} 的委托`}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{form.id ? "编辑委托" : "新建委托"}</DialogTitle>
              <DialogDescription>
                委托期内，受托人可代为处理分配给委托人的审批待办；决策记录仍写入真实操作人。
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-2">
              <Label htmlFor="delegate-from">委托人</Label>
              {canPickPrincipal ? (
                <UserPicker
                  id="delegate-from"
                  multi={false}
                  selected={[form.fromUser]}
                  initialUsers={[form.fromUser]}
                  onChange={(next) =>
                    setForm((current) => ({
                      ...current,
                      fromUser: next[0] ?? current.fromUser,
                      toUser: next[0] && current.toUser?.id === next[0].id ? null : current.toUser,
                    }))
                  }
                />
              ) : (
                <p className="text-sm text-muted-foreground">{selfUser.name}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="delegate-to">受托人</Label>
              <UserPicker
                id="delegate-to"
                multi={false}
                selected={form.toUser ? [form.toUser] : []}
                initialUsers={form.toUser ? [form.toUser] : []}
                onChange={(next) => setForm((current) => ({ ...current, toUser: next[0] ?? null }))}
              />
              {errors["toUserId"] ? (
                <p className="text-xs text-destructive">{errors["toUserId"]}</p>
              ) : null}
            </div>

            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium leading-none">委托权限</legend>
              <div className="flex flex-wrap gap-4">
                {DELEGATABLE_PERMISSIONS.map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={form.permissionKeys.includes(key)}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          permissionKeys: event.target.checked
                            ? [...current.permissionKeys, key]
                            : current.permissionKeys.filter((item) => item !== key),
                        }))
                      }
                    />
                    {DELEGATE_PERMISSION_LABELS[key]}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="delegate-start">开始日期</Label>
                <Input
                  id="delegate-start"
                  type="date"
                  value={form.startDate}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, startDate: event.target.value }))
                  }
                />
                {errors["startDate"] ? (
                  <p className="text-xs text-destructive">{errors["startDate"]}</p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="delegate-end">结束日期</Label>
                <Input
                  id="delegate-end"
                  type="date"
                  value={form.endDate}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, endDate: event.target.value }))
                  }
                />
                {errors["endDate"] ? (
                  <p className="text-xs text-destructive">{errors["endDate"]}</p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="delegate-reason">委托原因</Label>
              <Input
                id="delegate-reason"
                value={form.reason}
                placeholder="例如：年假期间由同事代审"
                onChange={(event) =>
                  setForm((current) => ({ ...current, reason: event.target.value }))
                }
              />
              {errors["reason"] ? (
                <p className="text-xs text-destructive">{errors["reason"]}</p>
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
    </div>
  );
}
