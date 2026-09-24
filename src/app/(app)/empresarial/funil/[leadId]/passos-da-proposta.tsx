"use client";

import type { ReactNode } from "react";
import {
  BadgePercent,
  CheckCircle2,
  Circle,
  CircleAlert,
  FileSignature,
  Gift,
  Timer,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SituacaoDaEtapa } from "@/lib/empresarial/etapas-do-funil";
import {
  PASSOS_DA_PROPOSTA,
  PASSO_ROTULO,
  type PassoDaProposta,
} from "@/lib/empresarial/passos-da-proposta";

/**
 * A TRILHA DE PASSOS DA ABA PROPOSTA (relato do dono, 24/09/2026).
 *
 * ⚠️ TODOS OS PAINÉIS FICAM MONTADOS; o inativo é escondido (`hidden`), nunca
 * desmontado. Isto não é detalhe de implementação — é o que impede a tela de
 * apagar o que a pessoa acabou de digitar: o formulário principal atravessa
 * TRÊS passos (preços, prazos e dados do contrato) com um `<form>` só, e
 * campo desmontado não é enviado no salvar. Mesma escolha das abas da ficha
 * (`abas-da-ficha.tsx`) e da ficha do paciente.
 *
 * ⚠️ E É UMA TRILHA, NÃO UM ASSISTENTE. Não existe "próximo" obrigatório:
 * quem volta numa proposta em follow-up quer mexer numa faixa e sair, não
 * reler seis passos. O número serve de ordem sugerida, não de tranca — a
 * mesma decisão que fez as abas da ficha não serem trancadas.
 */

const ICONE: Record<PassoDaProposta, LucideIcon> = {
  precos: Wallet,
  condicoes: BadgePercent,
  beneficios: Gift,
  prazos: Timer,
  texto: FileSignature,
  contrato: FileSignature,
};

const SELO: Record<SituacaoDaEtapa["estado"], { icone: LucideIcon; cor: string }> = {
  falta: { icone: CircleAlert, cor: "text-amber-600 dark:text-amber-400" },
  pronto: { icone: Circle, cor: "text-muted-foreground" },
  feito: { icone: CheckCircle2, cor: "text-emerald-600 dark:text-emerald-400" },
};

export function TrilhaDaProposta({
  ativo,
  aoTrocar,
  situacoes,
}: {
  ativo: PassoDaProposta;
  aoTrocar: (p: PassoDaProposta) => void;
  situacoes: Record<PassoDaProposta, SituacaoDaEtapa>;
}) {
  return (
    <nav
      aria-label="Passos da proposta"
      // Em tela estreita vira uma faixa que rola de lado, como a fita de abas
      // da ficha — empilhar seis cartões cheios de texto devolveria a lista
      // longa que este trabalho veio desfazer.
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {PASSOS_DA_PROPOSTA.map((passo, i) => {
        const Icone = ICONE[passo];
        const situacao = situacoes[passo];
        const selo = SELO[situacao.estado];
        const Selo = selo.icone;
        const atual = ativo === passo;
        return (
          <button
            key={passo}
            type="button"
            aria-current={atual ? "step" : undefined}
            onClick={() => aoTrocar(passo)}
            title={`${PASSO_ROTULO[passo]} — ${situacao.resumo}`}
            className={cn(
              "flex min-w-[11.5rem] items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:min-w-0",
              atual
                ? "border-gold bg-gold/10"
                : "border-transparent hover:border-border hover:bg-muted/50"
            )}
          >
            {/* ⚠️ `gold-foreground`, NÃO `primary`. O próprio globals.css
                avisa: `--gold-foreground` é a cor de texto para FUNDO SÓLIDO
                de destaque. Com `text-primary` o número ficava escuro sobre
                fundo escuro e simplesmente sumia do círculo. */}
            <span
              className={cn(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                atual
                  ? "bg-gold text-gold-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {i + 1}
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span
                className={cn(
                  "flex items-center gap-1.5 text-sm font-medium",
                  atual ? "text-foreground" : "text-muted-foreground"
                )}
              >
                <Icone className="size-3.5 shrink-0" />
                {PASSO_ROTULO[passo]}
              </span>
              <span
                className={cn(
                  "mt-0.5 flex items-start gap-1 text-[11px] leading-snug",
                  selo.cor
                )}
              >
                <Selo className="mt-px size-3 shrink-0" />
                {/* Duas linhas em vez de cortar: "3 faixas · mín. 10 · exceden…"
                    escondia justamente o aviso do excedente, que é a parte que
                    faz alguém agir. */}
                <span className="line-clamp-2">{situacao.resumo}</span>
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/** Um passo. Fica montado sempre; escondido quando não é o ativo. */
export function PainelDoPasso({
  visivel,
  children,
}: {
  visivel: boolean;
  children: ReactNode;
}) {
  return (
    <div hidden={!visivel} className="space-y-4">
      {children}
    </div>
  );
}
