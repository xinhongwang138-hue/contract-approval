import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Eye, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/shared/datetime";
import { formatMoney } from "@/shared/money";
import type { ContractSortField } from "@/shared/schemas/contract";
import type { ContractListItem } from "@/server/services/contract";
import { ContractStatusBadge } from "./status-badge";

export type ContractTableProps = {
  items: ContractListItem[];
  sort: ContractSortField;
  order: "asc" | "desc";
  sortHref: (field: ContractSortField) => string;
  canEdit: boolean;
};

function SortHeader({
  field,
  label,
  sort,
  order,
  href,
}: {
  field: ContractSortField;
  label: string;
  sort: ContractSortField;
  order: "asc" | "desc";
  href: string;
}) {
  const active = sort === field;
  const Icon = active ? (order === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead>
      <Link
        href={href}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <Icon className="size-3.5" />
      </Link>
    </TableHead>
  );
}

export function ContractTable({
  items,
  sort,
  order,
  sortHref,
  canEdit,
}: ContractTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>合同编号</TableHead>
            <TableHead>标题</TableHead>
            <TableHead>相对方</TableHead>
            <SortHeader
              field="amount"
              label="金额"
              sort={sort}
              order={order}
              href={sortHref("amount")}
            />
            <TableHead>状态</TableHead>
            <SortHeader
              field="endDate"
              label="到期日"
              sort={sort}
              order={order}
              href={sortHref("endDate")}
            />
            <SortHeader
              field="updatedAt"
              label="更新时间"
              sort={sort}
              order={order}
              href={sortHref("updatedAt")}
            />
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={8}
                className="py-12 text-center text-muted-foreground"
              >
                <p className="mb-1 text-sm">没有符合条件的合同</p>
                <p className="text-xs">调整筛选条件，或新建一份合同草稿。</p>
              </TableCell>
            </TableRow>
          ) : (
            items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-mono text-xs">{item.no}</TableCell>
                <TableCell>
                  <Link
                    href={`/contracts/${item.id}`}
                    className="font-medium hover:underline"
                  >
                    {item.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {item.templateName} · {item.creatorName}
                  </p>
                </TableCell>
                <TableCell className="text-sm">
                  {item.partyAName}
                  <span className="mx-1 text-muted-foreground">→</span>
                  {item.partyBName}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {formatMoney(item.amount, item.currency)}
                </TableCell>
                <TableCell>
                  <ContractStatusBadge status={item.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {formatDate(item.endDate)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatDate(item.updatedAt)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/contracts/${item.id}`}>
                        <Eye className="size-4" />
                        查看
                      </Link>
                    </Button>
                    {canEdit && item.status === "draft" ? (
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/contracts/${item.id}/edit`}>
                          <Pencil className="size-4" />
                          编辑
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
