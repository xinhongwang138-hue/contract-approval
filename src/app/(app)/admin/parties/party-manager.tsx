"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { deletePartyAction, savePartyAction } from "@/server/actions/parties";

export type PartyType = "customer" | "supplier" | "other";

type Contact = { name: string; phone: string; email: string };

export type PartyRow = {
  id: string;
  name: string;
  uscc: string | null;
  type: PartyType;
  address: string | null;
  contacts: Contact[];
  contractCount: number;
  updatedAtLabel: string;
};

const TYPE_LABELS: Record<PartyType, string> = {
  customer: "客户",
  supplier: "供应商",
  other: "其他",
};

type FormState = {
  name: string;
  uscc: string;
  type: PartyType;
  address: string;
  contacts: Contact[];
};

const EMPTY_FORM: FormState = {
  name: "",
  uscc: "",
  type: "customer",
  address: "",
  contacts: [],
};

const EMPTY_CONTACT: Contact = { name: "", phone: "", email: "" };

export function PartyManager({ parties }: { parties: PartyRow[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PartyRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formKey, setFormKey] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, startSaving] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<PartyRow | null>(null);
  const [deleting, startDeleting] = useTransition();

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormKey((key) => key + 1);
    setDialogOpen(true);
  }

  function openEdit(row: PartyRow) {
    setEditing(row);
    setForm({
      name: row.name,
      uscc: row.uscc ?? "",
      type: row.type,
      address: row.address ?? "",
      contacts: row.contacts,
    });
    setFieldErrors({});
    setFormKey((key) => key + 1);
    setDialogOpen(true);
  }

  function updateContact(index: number, patch: Partial<Contact>) {
    setForm((current) => ({
      ...current,
      contacts: current.contacts.map((contact, position) =>
        position === index ? { ...contact, ...patch } : contact,
      ),
    }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData();
    if (editing) {
      data.set("id", editing.id);
    }
    data.set("name", form.name);
    data.set("uscc", form.uscc);
    data.set("type", form.type);
    data.set("address", form.address);
    data.set(
      "contacts",
      JSON.stringify(
        form.contacts.map((contact) => ({
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
        })),
      ),
    );

    startSaving(async () => {
      const result = await savePartyAction(data);
      if (result.ok) {
        toast.success(editing ? "相对方已更新" : "相对方已创建");
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
      const result = await deletePartyAction(target.id);
      if (result.ok) {
        toast.success(`已删除「${target.name}」`);
      } else {
        toast.error(result.message);
      }
      setDeleteTarget(null);
    });
  }

  const contactError = Object.entries(fieldErrors).find(([key]) =>
    key.startsWith("contacts"),
  )?.[1];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          新建相对方
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>统一社会信用代码</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>联系人</TableHead>
              <TableHead className="text-right">关联合同</TableHead>
              <TableHead>更新时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parties.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  没有符合条件的相对方
                </TableCell>
              </TableRow>
            ) : (
              parties.map((row) => {
                const primaryContact = row.contacts[0];
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{row.name}</span>
                        {row.address ? (
                          <span className="text-xs text-muted-foreground">
                            {row.address}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.uscc ?? (
                        <span className="font-sans text-muted-foreground">未填写</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{TYPE_LABELS[row.type]}</Badge>
                    </TableCell>
                    <TableCell>
                      {primaryContact ? (
                        <div className="flex flex-col">
                          <span>{primaryContact.name}</span>
                          {primaryContact.phone ? (
                            <span className="text-xs text-muted-foreground">
                              {primaryContact.phone}
                            </span>
                          ) : null}
                          {row.contacts.length > 1 ? (
                            <span className="text-xs text-muted-foreground">
                              共 {row.contacts.length} 位
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">未维护</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.contractCount}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {row.updatedAtLabel}
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
                          aria-label={`删除 ${row.name}`}
                          disabled={row.contractCount > 0}
                          onClick={() => setDeleteTarget(row)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent key={formKey} className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{editing ? "编辑相对方" : "新建相对方"}</DialogTitle>
              <DialogDescription>
                统一社会信用代码用于查重；已被合同引用的相对方不允许删除。
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="party-name">名称</Label>
                <Input
                  id="party-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                  maxLength={100}
                  autoFocus
                />
                {fieldErrors.name ? (
                  <p className="text-xs text-destructive">{fieldErrors.name}</p>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="party-type">类型</Label>
                <Select
                  value={form.type}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      type:
                        value === "supplier" || value === "other"
                          ? value
                          : "customer",
                    }))
                  }
                >
                  <SelectTrigger id="party-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">客户</SelectItem>
                    <SelectItem value="supplier">供应商</SelectItem>
                    <SelectItem value="other">其他</SelectItem>
                  </SelectContent>
                </Select>
                {fieldErrors.type ? (
                  <p className="text-xs text-destructive">{fieldErrors.type}</p>
                ) : null}
              </div>

              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="party-uscc">统一社会信用代码</Label>
                <Input
                  id="party-uscc"
                  value={form.uscc}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      uscc: event.target.value.toUpperCase(),
                    }))
                  }
                  maxLength={18}
                  placeholder="18 位，选填"
                  className="font-mono uppercase"
                />
                {fieldErrors.uscc ? (
                  <p className="text-xs text-destructive">{fieldErrors.uscc}</p>
                ) : null}
              </div>

              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="party-address">地址</Label>
                <Textarea
                  id="party-address"
                  value={form.address}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      address: event.target.value,
                    }))
                  }
                  maxLength={200}
                  rows={2}
                />
                {fieldErrors.address ? (
                  <p className="text-xs text-destructive">{fieldErrors.address}</p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>联系人</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={form.contacts.length >= 10}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      contacts: [...current.contacts, EMPTY_CONTACT],
                    }))
                  }
                >
                  <Plus className="size-4" />
                  添加联系人
                </Button>
              </div>
              {form.contacts.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  暂无联系人，可添加最多 10 位
                </p>
              ) : (
                <div className="space-y-2">
                  {form.contacts.map((contact, index) => (
                    <div
                      key={index}
                      className="grid grid-cols-[1fr_1fr_1fr_auto] items-start gap-2 rounded-md border p-2"
                    >
                      <div className="grid gap-1">
                        <Input
                          aria-label={`联系人 ${index + 1} 姓名`}
                          placeholder="姓名"
                          value={contact.name}
                          maxLength={30}
                          onChange={(event) =>
                            updateContact(index, { name: event.target.value })
                          }
                        />
                      </div>
                      <Input
                        aria-label={`联系人 ${index + 1} 电话`}
                        placeholder="电话（选填）"
                        value={contact.phone}
                        maxLength={25}
                        onChange={(event) =>
                          updateContact(index, { phone: event.target.value })
                        }
                      />
                      <Input
                        aria-label={`联系人 ${index + 1} 邮箱`}
                        placeholder="邮箱（选填）"
                        type="email"
                        value={contact.email}
                        onChange={(event) =>
                          updateContact(index, { email: event.target.value })
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`移除联系人 ${index + 1}`}
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            contacts: current.contacts.filter(
                              (_item, position) => position !== index,
                            ),
                          }))
                        }
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {contactError ? (
                <p className="text-xs text-destructive">{contactError}</p>
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
            <AlertDialogTitle>删除相对方「{deleteTarget?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              已被合同引用的相对方无法删除。删除为软删除，历史合同保留原值。
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
