"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveContractFormAction } from "@/server/actions/contracts";
import type { ContractField } from "@/shared/contract-fields";
import { DynamicForm, visibleFormValues } from "./dynamic-form";

export type ContractFormTemplate = {
  id: string;
  code: string;
  name: string;
  category: string;
  fields: ContractField[];
};

export type ContractFormOptions = {
  templates: ContractFormTemplate[];
  types: { id: string; key: string; name: string }[];
  parties: { id: string; name: string; type: string; uscc: string | null }[];
};

export type ContractFormInitial = {
  id: string;
  templateId: string;
  typeId: string;
  title: string;
  partyAId: string;
  partyBId: string;
  amount: string;
  currency: string;
  signDate: string;
  startDate: string;
  endDate: string;
  formValues: Record<string, string>;
  bodyMarkdown: string;
};

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs";

const CURRENCIES = ["CNY", "USD", "EUR", "GBP", "JPY"] as const;

export function ContractForm({
  options,
  initial,
}: {
  options: ContractFormOptions;
  initial: ContractFormInitial | null;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    saveContractFormAction,
    null,
  );
  const navigated = useRef(false);

  const defaultTemplate =
    options.templates.find((template) => template.id === initial?.templateId) ??
    options.templates[0];

  const [templateId, setTemplateId] = useState(
    initial?.templateId ?? defaultTemplate?.id ?? "",
  );
  const [typeId, setTypeId] = useState(
    initial?.typeId ?? options.types[0]?.id ?? "",
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [partyAId, setPartyAId] = useState(initial?.partyAId ?? "");
  const [partyBId, setPartyBId] = useState(initial?.partyBId ?? "");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? "CNY");
  const [signDate, setSignDate] = useState(initial?.signDate ?? "");
  const [startDate, setStartDate] = useState(initial?.startDate ?? "");
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [bodyMarkdown, setBodyMarkdown] = useState(initial?.bodyMarkdown ?? "");
  const [formValues, setFormValues] = useState<Record<string, string>>(
    initial?.formValues ?? {},
  );

  const template = options.templates.find((item) => item.id === templateId);
  const fields = template?.fields ?? [];
  const isEdit = initial !== null;
  const fieldErrors = state && !state.ok ? (state.fields ?? {}) : {};

  useEffect(() => {
    if (!state?.ok || navigated.current) {
      return;
    }
    navigated.current = true;
    toast.success(isEdit ? "草稿已保存" : "草稿已创建");
    router.push(`/contracts/${state.data.id}`);
    router.refresh();
  }, [state, isEdit, router]);

  const missingOptions =
    options.templates.length === 0 ||
    options.types.length === 0 ||
    options.parties.length < 2;

  if (missingOptions) {
    return (
      <Alert>
        <AlertTitle>暂无法起草合同</AlertTitle>
        <AlertDescription>
          需要至少一个启用的模板、一个合同类型和两个相对方。请联系管理员先完成主数据配置。
        </AlertDescription>
      </Alert>
    );
  }

  const submitFormData = JSON.stringify(
    visibleFormValues(fields, formValues),
  );

  return (
    <form action={formAction} className="space-y-6">
      {isEdit ? <input type="hidden" name="id" value={initial.id} /> : null}
      {isEdit ? (
        <input type="hidden" name="templateId" value={templateId} />
      ) : null}
      <input type="hidden" name="formData" value={submitFormData} />

      {state && !state.ok ? (
        <Alert variant="destructive">
          <AlertTitle>保存失败</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <section className="rounded-lg border bg-card p-4 shadow-xs">
        <h2 className="mb-4 text-sm font-semibold">基础信息</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="templateId">
              合同模板 <span className="text-destructive">*</span>
            </Label>
            <select
              id="templateId"
              name={isEdit ? undefined : "templateId"}
              value={templateId}
              disabled={isEdit}
              onChange={(event) => {
                setTemplateId(event.target.value);
                setFormValues({});
              }}
              className={selectClass}
            >
              {options.templates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}（{item.code}）
                </option>
              ))}
            </select>
            {isEdit ? (
              <p className="text-xs text-muted-foreground">
                模板创建后不可更换，如需更换请新建合同。
              </p>
            ) : null}
            {fieldErrors["templateId"] ? (
              <p className="text-xs text-destructive">{fieldErrors["templateId"]}</p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="typeId">
              合同类型 <span className="text-destructive">*</span>
            </Label>
            <select
              id="typeId"
              name="typeId"
              value={typeId}
              onChange={(event) => setTypeId(event.target.value)}
              className={selectClass}
            >
              {options.types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
            {fieldErrors["typeId"] ? (
              <p className="text-xs text-destructive">{fieldErrors["typeId"]}</p>
            ) : null}
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="title">
              合同标题 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="title"
              name="title"
              value={title}
              maxLength={100}
              placeholder="例如 2026 年度办公用品采购合同"
              onChange={(event) => setTitle(event.target.value)}
            />
            {fieldErrors["title"] ? (
              <p className="text-xs text-destructive">{fieldErrors["title"]}</p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="partyAId">
              甲方 <span className="text-destructive">*</span>
            </Label>
            <select
              id="partyAId"
              name="partyAId"
              value={partyAId}
              onChange={(event) => {
                const next = event.target.value;
                setPartyAId(next);
                if (next === partyBId) {
                  setPartyBId("");
                }
              }}
              className={selectClass}
            >
              <option value="">请选择甲方</option>
              {options.parties.map((party) => (
                <option key={party.id} value={party.id}>
                  {party.name}
                  {party.uscc ? `（${party.uscc}）` : ""}
                </option>
              ))}
            </select>
            {fieldErrors["partyAId"] ? (
              <p className="text-xs text-destructive">{fieldErrors["partyAId"]}</p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="partyBId">
              乙方 <span className="text-destructive">*</span>
            </Label>
            <select
              id="partyBId"
              name="partyBId"
              value={partyBId}
              onChange={(event) => setPartyBId(event.target.value)}
              className={selectClass}
            >
              <option value="">请选择乙方</option>
              {options.parties
                .filter((party) => party.id !== partyAId)
                .map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.name}
                    {party.uscc ? `（${party.uscc}）` : ""}
                  </option>
                ))}
            </select>
            {fieldErrors["partyBId"] ? (
              <p className="text-xs text-destructive">{fieldErrors["partyBId"]}</p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="amount">
              合同金额 <span className="text-destructive">*</span>
            </Label>
            <div className="flex gap-2">
              <Input
                id="amount"
                name="amount"
                value={amount}
                inputMode="decimal"
                placeholder="0.00"
                onChange={(event) => setAmount(event.target.value)}
              />
              <select
                name="currency"
                aria-label="币种"
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
                className="h-9 w-24 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs"
              >
                {CURRENCIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            {fieldErrors["amount"] ? (
              <p className="text-xs text-destructive">{fieldErrors["amount"]}</p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="signDate">
              签署日期 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="signDate"
              name="signDate"
              type="date"
              value={signDate}
              onChange={(event) => setSignDate(event.target.value)}
            />
            {fieldErrors["signDate"] ? (
              <p className="text-xs text-destructive">{fieldErrors["signDate"]}</p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="startDate">
              开始日期 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="startDate"
              name="startDate"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
            {fieldErrors["startDate"] ? (
              <p className="text-xs text-destructive">{fieldErrors["startDate"]}</p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="endDate">
              结束日期 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="endDate"
              name="endDate"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
            {fieldErrors["endDate"] ? (
              <p className="text-xs text-destructive">{fieldErrors["endDate"]}</p>
            ) : null}
          </div>
        </div>
      </section>

      {fields.length > 0 ? (
        <section className="rounded-lg border bg-card p-4 shadow-xs">
          <h2 className="mb-1 text-sm font-semibold">模板字段</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            字段来自模板「{template?.name}」，带 * 的为必填项。
          </p>
          <DynamicForm
            fields={fields}
            values={formValues}
            errors={fieldErrors}
            onChange={(key, value) =>
              setFormValues((current) => ({ ...current, [key]: value }))
            }
          />
        </section>
      ) : null}

      <section className="rounded-lg border bg-card p-4 shadow-xs">
        <div className="mb-4">
          <h2 className="text-sm font-semibold">合同正文</h2>
          <p className="text-xs text-muted-foreground">
            正文以 Markdown 保存，每次修改都记录在版本历史中。
          </p>
        </div>
        <Textarea
          id="bodyMarkdown"
          name="bodyMarkdown"
          value={bodyMarkdown}
          rows={10}
          placeholder="请输入合同正文…"
          onChange={(event) => setBodyMarkdown(event.target.value)}
        />
        {fieldErrors["bodyMarkdown"] ? (
          <p className="mt-2 text-xs text-destructive">
            {fieldErrors["bodyMarkdown"]}
          </p>
        ) : null}
      </section>

      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild variant="outline">
          <Link href={isEdit ? `/contracts/${initial.id}` : "/contracts"}>
            取消
          </Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "保存中…" : isEdit ? "保存修改" : "保存草稿"}
        </Button>
      </div>
    </form>
  );
}
