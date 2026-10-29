"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ContractField } from "@/shared/contract-fields";

type DynamicFormProps = {
  fields: ContractField[];
  values: Record<string, string>;
  errors: Record<string, string>;
  onChange: (key: string, value: string) => void;
};

export function DynamicForm({
  fields,
  values,
  errors,
  onChange,
}: DynamicFormProps) {
  const visibility = new Map<string, boolean>();

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((field) => {
        const condition = field.visibleWhen;
        const visible =
          condition === null ||
          (visibility.get(condition.field) === true &&
            String(values[condition.field] ?? "") === String(condition.equals));
        visibility.set(field.key, visible);
        if (!visible) {
          return null;
        }

        const error = errors[`formData.${field.key}`];
        const value = values[field.key] ?? "";
        const inputId = `form-field-${field.key}`;

        return (
          <div
            key={field.key}
            className={
              field.type === "textarea" ? "grid gap-1.5 sm:col-span-2" : "grid gap-1.5"
            }
          >
            <Label htmlFor={inputId}>
              {field.label}
              {field.required ? (
                <span className="ml-0.5 text-destructive">*</span>
              ) : null}
            </Label>

            {field.type === "textarea" ? (
              <Textarea
                id={inputId}
                value={value}
                rows={3}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
            ) : field.type === "select" ? (
              <select
                id={inputId}
                value={value}
                onChange={(event) => onChange(field.key, event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs"
              >
                <option value="">请选择</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={inputId}
                type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
                inputMode={field.type === "number" ? "decimal" : undefined}
                min={field.type === "number" ? (field.min ?? undefined) : undefined}
                max={field.type === "number" ? (field.max ?? undefined) : undefined}
                value={value}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
            )}

            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function visibleFormValues(
  fields: ContractField[],
  values: Record<string, string>,
): Record<string, string> {
  const visibility = new Map<string, boolean>();
  const result: Record<string, string> = {};

  for (const field of fields) {
    const condition = field.visibleWhen;
    const visible =
      condition === null ||
      (visibility.get(condition.field) === true &&
        String(values[condition.field] ?? "") === String(condition.equals));
    visibility.set(field.key, visible);
    if (visible && String(values[field.key] ?? "").trim() !== "") {
      result[field.key] = (values[field.key] ?? "").trim();
    }
  }

  return result;
}
