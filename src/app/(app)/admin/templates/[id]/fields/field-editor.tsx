"use client";

import { useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  ListPlus,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { saveTemplateFieldsAction } from "@/server/actions/templates";
import {
  CONTRACT_FIELD_TYPES,
  FIELD_TYPE_LABELS,
  contractFieldArraySchema,
  type ContractField,
  type ContractFieldType,
} from "@/shared/contract-fields";

const ALWAYS_VALUE = "__always__";
const MAX_FIELDS = 30;

type FieldDraft = {
  key: string;
  label: string;
  type: ContractFieldType;
  required: boolean;
  optionsText: string;
  min: string;
  max: string;
  visibleWhenField: string;
  visibleWhenEquals: string;
};

const EMPTY_FIELD: FieldDraft = {
  key: "",
  label: "",
  type: "text",
  required: false,
  optionsText: "",
  min: "",
  max: "",
  visibleWhenField: "",
  visibleWhenEquals: "",
};

function toDraft(field: ContractField): FieldDraft {
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    optionsText: field.options.join("\n"),
    min: field.min === null ? "" : String(field.min),
    max: field.max === null ? "" : String(field.max),
    visibleWhenField: field.visibleWhen?.field ?? "",
    visibleWhenEquals:
      field.visibleWhen === null ? "" : String(field.visibleWhen.equals),
  };
}

function toInput(draft: FieldDraft) {
  const visibleWhen =
    draft.visibleWhenField !== "" && draft.visibleWhenEquals.trim() !== ""
      ? { field: draft.visibleWhenField, equals: draft.visibleWhenEquals.trim() }
      : null;
  return {
    key: draft.key.trim(),
    label: draft.label.trim(),
    type: draft.type,
    required: draft.required,
    options:
      draft.type === "select"
        ? draft.optionsText
            .split("\n")
            .map((option) => option.trim())
            .filter((option) => option !== "")
        : [],
    min:
      draft.type === "number" && draft.min.trim() !== ""
        ? Number(draft.min)
        : null,
    max:
      draft.type === "number" && draft.max.trim() !== ""
        ? Number(draft.max)
        : null,
    visibleWhen,
  };
}

export function FieldEditor({
  templateId,
  initialFields,
}: {
  templateId: string;
  initialFields: ContractField[];
}) {
  const [drafts, setDrafts] = useState<FieldDraft[]>(() =>
    initialFields.map(toDraft),
  );
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [saving, startSaving] = useTransition();

  function updateDraft(index: number, patch: Partial<FieldDraft>) {
    setDrafts((current) =>
      current.map((draft, position) =>
        position === index ? { ...draft, ...patch } : draft,
      ),
    );
  }

  function addField() {
    setDrafts((current) =>
      current.length >= MAX_FIELDS ? current : [...current, { ...EMPTY_FIELD }],
    );
  }

  function removeField(index: number) {
    setDrafts((current) => current.filter((_, position) => position !== index));
    setErrors({});
  }

  function moveField(index: number, direction: -1 | 1) {
    const target = index + direction;
    setDrafts((current) => {
      if (target < 0 || target >= current.length) {
        return current;
      }
      const next = [...current];
      const currentDraft = next[index];
      const targetDraft = next[target];
      if (!currentDraft || !targetDraft) {
        return current;
      }
      next[index] = targetDraft;
      next[target] = currentDraft;
      return next;
    });
    setErrors({});
  }

  function handleSave() {
    const input = drafts.map(toInput);
    const parsed = contractFieldArraySchema.safeParse(input);
    if (!parsed.success) {
      const nextErrors: Record<number, string> = {};
      for (const issue of parsed.error.issues) {
        const index = typeof issue.path[0] === "number" ? issue.path[0] : 0;
        nextErrors[index] = [nextErrors[index], issue.message]
          .filter(Boolean)
          .join("；");
      }
      setErrors(nextErrors);
      toast.error(parsed.error.issues[0]?.message ?? "字段配置有误");
      return;
    }

    setErrors({});
    startSaving(async () => {
      const result = await saveTemplateFieldsAction(
        templateId,
        JSON.stringify(parsed.data),
      );
      if (result.ok) {
        setDrafts(parsed.data.map(toDraft));
        toast.success("字段已保存");
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          共 {drafts.length} / {MAX_FIELDS} 个字段，字段标识用于表单数据与条件表达式。
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={addField} disabled={drafts.length >= MAX_FIELDS}>
            <Plus className="size-4" />
            添加字段
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            <Save className="size-4" />
            {saving ? "保存中…" : "保存字段"}
          </Button>
        </div>
      </div>

      {drafts.length === 0 ? (
        <button
          type="button"
          onClick={addField}
          className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-14 text-muted-foreground transition-colors hover:bg-muted/50"
        >
          <ListPlus className="size-8" />
          <span className="text-sm">还没有字段，点击添加第一个字段</span>
        </button>
      ) : (
        <div className="space-y-3">
          {drafts.map((draft, index) => {
            const previousOptions = drafts
              .slice(0, index)
              .map((field) => ({ key: field.key.trim(), label: field.label }))
              .filter((field) => field.key !== "");
            const error = errors[index];

            return (
              <div
                key={index}
                className="rounded-lg border bg-card p-4 shadow-xs"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">
                    字段 {index + 1}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {draft.label || draft.key || "未命名"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={index === 0}
                      onClick={() => moveField(index, -1)}
                      aria-label="上移字段"
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={index === drafts.length - 1}
                      onClick={() => moveField(index, 1)}
                      aria-label="下移字段"
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeField(index)}
                      aria-label="删除字段"
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor={`field-${index}-key`}>
                      字段标识 <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id={`field-${index}-key`}
                      value={draft.key}
                      placeholder="例如 amount"
                      onChange={(event) =>
                        updateDraft(index, { key: event.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`field-${index}-label`}>
                      字段名称 <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id={`field-${index}-label`}
                      value={draft.label}
                      placeholder="例如 合同金额"
                      onChange={(event) =>
                        updateDraft(index, { label: event.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`field-${index}-type`}>字段类型</Label>
                    <Select
                      value={draft.type}
                      onValueChange={(value) =>
                        updateDraft(index, {
                          type: value as ContractFieldType,
                          optionsText: value === "select" ? draft.optionsText : "",
                          min: value === "number" ? draft.min : "",
                          max: value === "number" ? draft.max : "",
                        })
                      }
                    >
                      <SelectTrigger id={`field-${index}-type`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CONTRACT_FIELD_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {FIELD_TYPE_LABELS[type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>是否必填</Label>
                    <div className="flex h-9 items-center gap-2 rounded-md border px-3">
                      <Switch
                        checked={draft.required}
                        onCheckedChange={(checked) =>
                          updateDraft(index, { required: checked })
                        }
                        aria-label="是否必填"
                      />
                      <span className="text-sm text-muted-foreground">
                        {draft.required ? "必填" : "选填"}
                      </span>
                    </div>
                  </div>

                  {draft.type === "select" ? (
                    <div className="grid gap-1.5 sm:col-span-2">
                      <Label htmlFor={`field-${index}-options`}>
                        选项（每行一个）
                      </Label>
                      <Textarea
                        id={`field-${index}-options`}
                        value={draft.optionsText}
                        rows={3}
                        placeholder={"月结\n现结"}
                        onChange={(event) =>
                          updateDraft(index, { optionsText: event.target.value })
                        }
                      />
                    </div>
                  ) : null}

                  {draft.type === "number" ? (
                    <div className="grid grid-cols-2 gap-3 sm:col-span-2">
                      <div className="grid gap-1.5">
                        <Label htmlFor={`field-${index}-min`}>最小值</Label>
                        <Input
                          id={`field-${index}-min`}
                          type="number"
                          value={draft.min}
                          onChange={(event) =>
                            updateDraft(index, { min: event.target.value })
                          }
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor={`field-${index}-max`}>最大值</Label>
                        <Input
                          id={`field-${index}-max`}
                          type="number"
                          value={draft.max}
                          onChange={(event) =>
                            updateDraft(index, { max: event.target.value })
                          }
                        />
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-1.5 sm:col-span-2">
                    <Label>显示条件</Label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Select
                        value={draft.visibleWhenField || ALWAYS_VALUE}
                        onValueChange={(value) =>
                          updateDraft(index, {
                            visibleWhenField:
                              value === ALWAYS_VALUE ? "" : value,
                            visibleWhenEquals:
                              value === ALWAYS_VALUE
                                ? ""
                                : draft.visibleWhenEquals,
                          })
                        }
                        disabled={previousOptions.length === 0}
                      >
                        <SelectTrigger
                          aria-label="显示条件依赖字段"
                          className="w-full"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALWAYS_VALUE}>始终显示</SelectItem>
                          {previousOptions.map((field) => (
                            <SelectItem key={field.key} value={field.key}>
                              {field.label || field.key}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {draft.visibleWhenField ? (
                        <Input
                          value={draft.visibleWhenEquals}
                          placeholder="当该字段等于此值时显示"
                          onChange={(event) =>
                            updateDraft(index, {
                              visibleWhenEquals: event.target.value,
                            })
                          }
                        />
                      ) : (
                        <div className="hidden items-center text-xs text-muted-foreground sm:flex">
                          仅当前面存在字段时可配置条件显示。
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {error ? (
                  <p className="mt-3 text-xs text-destructive">{error}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {drafts.length > 0 ? (
        <div className="flex justify-end">
          <Button type="button" onClick={handleSave} disabled={saving}>
            <Save className="size-4" />
            {saving ? "保存中…" : "保存字段"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
