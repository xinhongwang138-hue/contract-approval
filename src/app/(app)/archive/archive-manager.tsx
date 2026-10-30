"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Archive } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { archiveContractAction } from "@/server/actions/lifecycle";
import { CONTRACT_STATUS_LABELS } from "@/shared/contract-status";
import { formatDate } from "@/shared/datetime";
import { formatMoney } from "@/shared/money";
import type { ContractStatus } from "@/shared/state-machines";

export type ArchiveRowView = {
  id: string;
  no: string;
  title: string;
  amount: string;
  status: ContractStatus;
  endDate: string;
  sealedAt: string | null;
  effectiveAt: string | null;
  archivedAt: string | null;
};

export function ArchiveManager({
  tab,
  rows,
  pagination,
}: {
  tab: "pending" | "archived";
  rows: ArchiveRowView[];
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    total: number;
    basePath: string;
    baseQuery: Record<string, string | undefined>;
  };
}) {
  const [target, setTarget] = useState<ArchiveRowView | null>(null);
  const [note, setNote] = useState("");
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

  function openArchive(row: ArchiveRowView): void {
    setNote("");
    setTarget(row);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData();
    data.set("id", target?.id ?? "");
    data.set("note", note);
    startTransition(async () => {
      const result = await archiveContractAction(data);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("合同已归档");
      setTarget(null);
    });
  }

  return (
    <Card>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Archive className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">
              {tab === "archived" ? "还没有已归档合同" : "没有待归档合同"}
            </p>
            <p className="text-xs text-muted-foreground">
              {tab === "archived"
                ? "归档后的合同会长期保留在这里，只读不可编辑。"
                : "合同进入履行中、变更中、已到期或已终止后，才会出现在这里。"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>合同</TableHead>
                  <TableHead>编号</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>到期日</TableHead>
                  <TableHead>用印</TableHead>
                  <TableHead>生效</TableHead>
                  {tab === "archived" ? <TableHead>归档时间</TableHead> : null}
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        href={`/contracts/${row.id}`}
                        className="block max-w-64 truncate text-sm font-medium hover:underline"
                      >
                        {row.title}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {row.no}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.amount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.status === "archived" ? "outline" : "secondary"}>
                        {CONTRACT_STATUS_LABELS[row.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(row.endDate)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.sealedAt ? formatDate(row.sealedAt) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.effectiveAt ? formatDate(row.effectiveAt) : "—"}
                    </TableCell>
                    {tab === "archived" ? (
                      <TableCell className="text-xs text-muted-foreground">
                        {row.archivedAt ? formatDate(row.archivedAt) : "—"}
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <div className="flex justify-end">
                        {tab === "pending" ? (
                          <Button size="sm" onClick={() => openArchive(row)}>
                            归档
                          </Button>
                        ) : (
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/contracts/${row.id}`}>查看</Link>
                          </Button>
                        )}
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

      <Dialog open={target !== null} onOpenChange={(open) => (open ? null : setTarget(null))}>
        <DialogContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>归档合同</DialogTitle>
              <DialogDescription>
                {target ? `${target.no} · ${target.title}` : ""}
                归档后合同与附件转为只读，此操作不可撤销。
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-2">
              <Label htmlFor="archive-note">归档备注（选填）</Label>
              <Textarea
                id="archive-note"
                rows={3}
                maxLength={200}
                value={note}
                placeholder="例如：履行完毕，纸质件移交档案室 A-2026-118"
                onChange={(event) => setNote(event.target.value)}
              />
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  取消
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? "归档中…" : "确认归档"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
