import { Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { textoDoSelo } from "@/lib/finance/selo-atraso";

/**
 * ASA2 (4006) — o selo "Em atraso há N dias" (spec 17.1). Sem valor nenhum:
 * serve para a recepção tratar do pagamento com discrição, fora da sala
 * clínica. Não bloqueia nada (D11). Quem vê já foi decidido pelo banco.
 */
export function SeloEmAtraso({
  dias,
  compacto = false,
  className,
}: {
  dias: number | null | undefined;
  compacto?: boolean;
  className?: string;
}) {
  if (dias == null || dias <= 0) return null;
  const texto = textoDoSelo(dias);
  return (
    <span
      title={texto}
      aria-label={texto}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-red-300 bg-red-50 font-medium text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200",
        compacto ? "px-1.5 py-0 text-[10px] leading-4" : "px-2 py-0.5 text-xs",
        className
      )}
    >
      <Wallet className={compacto ? "size-2.5" : "size-3"} aria-hidden />
      {compacto ? `atraso ${dias}d` : texto}
    </span>
  );
}
