import { cn } from "@/lib/utils";
import {
  INDICACAO_STATUS_LABEL,
  STATUS_COR,
  type IndicacaoStatus,
} from "@/lib/indica/status";

/** O selo da etapa — a mesma cor em todas as telas do Indica +Risos. */
export function StatusBadge({
  status,
  className,
}: {
  status: IndicacaoStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        STATUS_COR[status],
        className
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {INDICACAO_STATUS_LABEL[status]}
    </span>
  );
}
