import { cn } from "@/lib/utils";
import {
  SITUACAO_ROTULO,
  type FaixaDeIdade,
  type SituacaoDeRelato,
} from "@/lib/system-reports";

/**
 * Os selos da tela de Problemas — a lista e o detalhe usam os mesmos, para a
 * mesma situação nunca ter duas cores.
 */

const COR_DA_SITUACAO: Record<SituacaoDeRelato, string> = {
  aberto: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  em_analise: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  resolvido: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  nao_e_defeito: "bg-muted text-muted-foreground",
};

export function SeloDeSituacao({
  situacao,
  className,
}: {
  situacao: SituacaoDeRelato;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
        COR_DA_SITUACAO[situacao],
        className
      )}
    >
      {SITUACAO_ROTULO[situacao]}
    </span>
  );
}

const COR_DA_IDADE: Record<FaixaDeIdade, string> = {
  recente: "text-muted-foreground",
  atencao: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  atrasado: "bg-destructive/10 text-destructive",
};

/**
 * O tempo parado, com a cor da faixa (até 2 dias, 3 a 7, acima de 7). A cor
 * nunca vem sozinha: o texto diz os dias, para quem não distingue as cores.
 */
export function CorDaIdade({
  faixa,
  children,
}: {
  faixa: FaixaDeIdade | null;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 font-medium tabular-nums",
        faixa ? COR_DA_IDADE[faixa] : "text-muted-foreground"
      )}
    >
      {children}
    </span>
  );
}
