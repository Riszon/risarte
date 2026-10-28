import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TOM, type Tom } from "@/lib/tons";

/**
 * O MINI-CARTÃO DA FAIXA "PROGRAMAS E TRATAMENTOS" DO PRONTUÁRIO (28/10/2026).
 *
 * Um molde só para PPR+, Ortodontia e Empresarial: ícone, título, a situação
 * dita UMA vez (o selo), uma linha de contexto, o miolo e as ações. Antes
 * cada programa era um cartão grande, empilhado antes das abas, repetindo a
 * situação no selo, no título e numa caixa colorida.
 */
export function MiniCartao({
  icone: Icone,
  titulo,
  situacao,
  linha,
  children,
  acoes,
  className,
}: {
  icone: LucideIcon;
  titulo: ReactNode;
  situacao?: { rotulo: string; tom: Tom } | null;
  /** Uma linha curta de contexto, em cinza, logo abaixo do título. */
  linha?: ReactNode;
  children?: ReactNode;
  acoes?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-xl border-l-2 border-l-gold bg-card p-3 text-sm ring-1 ring-foreground/10",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <h2 className="flex min-w-0 items-center gap-1.5 font-semibold">
          <Icone className="size-4 shrink-0 text-gold-foreground" aria-hidden />
          <span className="truncate">{titulo}</span>
        </h2>
        {situacao && (
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              TOM[situacao.tom]
            )}
          >
            {situacao.rotulo}
          </span>
        )}
      </div>
      {linha && <p className="text-xs text-muted-foreground">{linha}</p>}
      {children}
      {acoes && (
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">{acoes}</div>
      )}
    </section>
  );
}
