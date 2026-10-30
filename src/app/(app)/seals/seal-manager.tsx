"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Stamp } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  pickSealAction,
  returnSealAction,
} from "@/server/actions/lifecycle";
import { formatDateTime } from "@/shared/datetime";
import { CONTRACT_STATUS_LABELS } from "@/shared/contract-status";
import type { ContractStatus } from "@/shared/state-machines";
import { SEAL_STATE_LABELS, SEAL_TYPE_LABELS, type SealState, type SealType } from "@/shared/lifecycle";

export type SealRowView = {
  id: string;
  contractId: string;
  contractNo: string;
  contractTitle: string;
  contractStatus: ContractStatus;
  sealType: SealType;
  copies: number;
  applicantName: string;
  appliedAt: string;
  pickedAt: string | null;
  returnedAt: string | null;
  notaryNo: string | null;
  state: SealState;
};

export function SealManager({
  rows,
  pagination,
}: {
  rows: SealRowView[];
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    total: number;
    basePath: string;
    baseQuery: Record<string, string | undefined>;
  };
}) {
  const [returning, setReturning] = useState<SealRowView | null>(null);
  const [notaryNo, setNotaryNo] = useState("");
  const [pending, startTransition] = useTransition();

  // 服务端不能把函数传进客户端组件，这里本地拼装分页链接
  function buildHref(overrides: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({
      ...pagination.baseQuery,
      ...overrides,
    })) {
      if (value) {
        params.set(key, value);
      }
    }
    const qs = params.toString();
    return qs ? `${pagination.basePath}?${qs}` : pagination.basePath;
  }

  function openReturn(row: SealRowView): void {
    setNotaryNo(row.notaryNo ?? "");
    setReturning(row);
  }

  function handlePick(row: SealRowView): void {
    startTransition(async () => {
      const result = await pickSealAction(row.id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("已登记取件");
    });
  }

  function handleSubmitReturn(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData();
    data.set("id", returning?.id ?? "");
    data.set("notaryNo", notaryNo);
    startTransition(async () => {
      const result = await returnSealAction(data);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("已登记归还");
      setReturning(null);
    });
  }

  return (
    <Card>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Stamp className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">暂无用印申请</p>
            <p className="text-xs text-muted-foreground">
              流程里带「创建用印申请」动作的合同审批通过后，会出现在这里。
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>合同</TableHead>
                  <TableHead>章类型</TableHead>
                  <TableHead className="text-right">份数</TableHead>
                  <TableHead>申请人</TableHead>
                  <TableHead>申请时间</TableHead>
                  <TableHead>取件</TableHead>
                  <TableHead>归还</TableHead>
                  <TableHead>用印编号</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        href={`/contracts/${row.contractId}`}
                        className="block max-w-64 truncate text-sm font-medium hover:underline"
                      >
                        {row.contractTitle}
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground">{row.contractNo}</p>
                    </TableCell>
                    <TableCell>{SEAL_TYPE_LABELS[row.sealType]}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.copies}</TableCell>
                    <TableCell>{row.applicantName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(row.appliedAt)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.pickedAt ? formatDateTime(row.pickedAt) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.returnedAt ? formatDateTime(row.returnedAt) : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.notaryNo ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge
                          variant={
                            row.state === "returned"
                              ? "outline"
                              : row.state === "pending_return"
                                ? "secondary"
                                : "default"
                          }
                        >
                          {SEAL_STATE_LABELS[row.state]}
                        </Badge>
                        <Badge variant="outline">
                          {CONTRACT_STATUS_LABELS[row.contractStatus] ?? row.contractStatus}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {row.state === "pending_pick" ? (
                          <Button
                            size="sm"
                            disabled={pending}
                            onClick={() => handlePick(row)}
                          >
                            登记取件
                          </Button>
                        ) : null}
                        {row.state === "pending_return" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() => openReturn(row)}
                          >
                            登记归还
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {pagination.totalPages > 1 ? (
          <div className="mt-4 flex items-center justify-end gap-2">
            {pagination.page <= 1 ? (
              <Button variant="outline" size="sm" disabled>
                上一页
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link href={buildHref({ page: String(pagination.page - 1) })}>
                  上一页
                </Link>
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              第 {pagination.page} / {pagination.totalPages} 页，共 {pagination.total} 条
            </span>
            {pagination.page >= pagination.totalPages ? (
              <Button variant="outline" size="sm" disabled>
                下一页
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link href={buildHref({ page: String(pagination.page + 1) })}>
                  下一页
                </Link>
              </Button>
            )}
          </div>
        ) : null}
      </CardContent>

      <Dialog open={returning !== null} onOpenChange={(open) => (open ? null : setReturning(null))}>
        <DialogContent>
          <form onSubmit={handleSubmitReturn} className="space-y-4">
            <DialogHeader>
              <DialogTitle>登记用印归还</DialogTitle>
              <DialogDescription>
                {returning
                  ? `合同 ${returning.contractNo} · ${SEAL_TYPE_LABELS[returning.sealType]} ${returning.copies} 份`
                  : ""}
                归还登记后，已用印的合同会自动进入履行中。
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-2">
              <Label htmlFor="seal-notary-no">用印编号（选填）</Label>
              <Input
                id="seal-notary-no"
                value={notaryNo}
                maxLength={40}
                placeholder="例如 YZ-2026-0001"
                onChange={(event) => setNotaryNo(event.target.value)}
              />
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  取消
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? "提交中…" : "确认归还"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
