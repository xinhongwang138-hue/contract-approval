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
import { isEditableContractStatus } from "@/shared/contract-status";
import { formatDate } from "@/shared/datetime";
import { expiryTone } from "@/shared/lifecycle";
import { formatMoney } from "@/shared/money";
import type { ContractSortField } from "@/shared/schemas/contract";
import type { ContractListItem } from "@/server/services/contract";
import { cn } from "@/lib/utils";
import { ContractStatusBadge } from "./status-badge";

export type ContractTableProps = {
  items: ContractListItem[];
  sort: ContractSortField;
  order: "asc" | "desc";
  sortHref: (field: ContractSortField) => string;
  canEdit: boolean;
  today: Date;
  warningDays: readonly number[];
};

const EXPIRY_TONE_CLASS = {
  expired: "text-destructive font-medium",
  urgent: "text-destructive",
  soon: "text-amber-600",
} as const;

const EXPIRY_TONE_HINT = {
  expired: "已过期",
  urgent: "临近到期",
  soon: "即将到期",
} as const;

function SortHeader({
  field,
  label,
  sort,
  order,
  href,
  className,
}: {
  field: ContractSortField;
  label: string;
  sort: ContractSortField;
  order: "asc" | "desc";
  href: string;
  className?: string;
}) {
  const active = sort === field;
  const Icon = active ? (order === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={className}>
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
  today,
  warningDays,
}: ContractTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="hidden sm:table-cell">合同编号</TableHead>
            <TableHead>标题</TableHead>
            <TableHead className="hidden lg:table-cell">相对方</TableHead>
            <SortHeader
              field="amount"
              label="金额"
              sort={sort}
              order={order}
              href={sortHref("amount")}
              className="hidden md:table-cell"
            />
            <TableHead className="hidden md:table-cell">状态</TableHead>
            <SortHeader
              field="endDate"
              label="到期日"
              sort={sort}
              order={order}
              href={sortHref("endDate")}
              className="hidden md:table-cell"
            />
            <SortHeader
              field="updatedAt"
              label="更新时间"
              sort={sort}
              order={order}
              href={sortHref("updatedAt")}
              className="hidden 2xl:table-cell"
            />
            <TableHead className="sticky right-0 z-10 hidden border-l bg-card text-right md:table-cell">
              操作
            </TableHead>
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
            items.map((item) => {
              const tone = expiryTone(item.status, item.endDate, today, warningDays);
              return (
              <TableRow key={item.id}>
                <TableCell className="hidden font-mono text-xs break-all sm:table-cell">
                  {item.no}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/contracts/${item.id}`}
                    className="font-medium hover:underline"
                  >
                    {item.title}
                  </Link>
                  {/* 状态列在窄屏隐藏，徽标改挂到标题下方独占一行，避免被挤裁 */}
                  <span className="mt-1 block md:hidden">
                    <ContractStatusBadge status={item.status} />
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {item.templateName} · {item.creatorName}
                  </p>
                </TableCell>
                <TableCell className="hidden text-sm lg:table-cell">
                  <p
                    className="max-w-[18rem] truncate"
                    title={`${item.partyAName} → ${item.partyBName}`}
                  >
                    {item.partyAName}
                    <span className="mx-1 text-muted-foreground">→</span>
                    {item.partyBName}
                  </p>
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-sm md:table-cell">
                  {formatMoney(item.amount, item.currency)}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <ContractStatusBadge status={item.status} />
                </TableCell>
                <TableCell
                  className={cn(
                    "hidden whitespace-nowrap text-sm md:table-cell",
                    tone ? EXPIRY_TONE_CLASS[tone] : undefined,
                  )}
                  title={tone ? EXPIRY_TONE_HINT[tone] : undefined}
                >
                  {formatDate(item.endDate)}
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground 2xl:table-cell">
                  {formatDate(item.updatedAt)}
                </TableCell>
                <TableCell className="sticky right-0 z-10 hidden border-l bg-card group-hover/tr:bg-muted/50 md:table-cell">
                  <div className="flex justify-end gap-1">
                    {/* 窄屏只留图标：文字标签会把这一列撑到盖住标题，编辑入口在详情页仍有 */}
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/contracts/${item.id}`} aria-label="查看合同">
                        <Eye className="size-4" />
                        <span className="hidden md:inline">查看</span>
                      </Link>
                    </Button>
                    {canEdit && isEditableContractStatus(item.status) ? (
                      <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="hidden md:inline-flex"
                      >
                        <Link href={`/contracts/${item.id}/edit`} aria-label="编辑合同">
                          <Pencil className="size-4" />
                          编辑
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
