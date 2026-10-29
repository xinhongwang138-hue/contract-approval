import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CONTRACT_STATUS_LABELS } from "@/shared/contract-status";
import type { ContractStatus } from "@/shared/state-machines";

const STATUS_CLASSES: Record<ContractStatus, string> = {
  draft: "border-slate-200 bg-slate-100 text-slate-700",
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  approving: "border-blue-200 bg-blue-50 text-blue-700",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  to_seal: "border-cyan-200 bg-cyan-50 text-cyan-700",
  sealed: "border-teal-200 bg-teal-50 text-teal-700",
  active: "border-green-200 bg-green-50 text-green-700",
  rejected: "border-red-200 bg-red-50 text-red-700",
  withdrawn: "border-zinc-200 bg-zinc-100 text-zinc-600",
  amended: "border-violet-200 bg-violet-50 text-violet-700",
  expired: "border-orange-200 bg-orange-50 text-orange-700",
  terminated: "border-rose-200 bg-rose-50 text-rose-700",
  archived: "border-stone-200 bg-stone-100 text-stone-600",
};

export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  return (
    <Badge variant="outline" className={cn("border", STATUS_CLASSES[status])}>
      {CONTRACT_STATUS_LABELS[status]}
    </Badge>
  );
}
