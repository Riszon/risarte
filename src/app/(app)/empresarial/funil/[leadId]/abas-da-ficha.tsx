"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  CircleAlert,
  ClipboardList,
  FileSpreadsheet,
  Handshake,
  History,
  Presentation,
  Send,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ETAPA_ROTULO,
  type SituacaoDaEtapa,
} from "@/lib/empresarial/etapas-do-funil";
import type {
  AbaDaFichaId,
  ProximoPasso,
} from "@/lib/empresarial/ficha-do-funil";

/**
 * A FICHA DA EMPRESA EM ABAS (OC-00083).
 *
 * ⚠️ TODAS AS ABAS FICAM MONTADAS; a inativa é escondida (`hidden`), não
 * desmontada. São vários formulários independentes, cada um com o seu salvar:
 * desmontar ao trocar de aba apagaria o que a pessoa acabou de digitar e não
 * salvou — e ela descobriria isso só ao voltar. É a mesma escolha da ficha do
 * paciente (`prontuario-tabs.tsx`).
 *
 * Não reusei aquele componente porque ele é do núcleo e esta tela precisa de
 * coisas que ele não tem (abrir na etapa da empresa, selo de situação por
 * aba). Regra do CLAUDE.md §0: o Empresarial cria arquivo próprio em vez de
 * empurrar mudança para arquivo compartilhado.
 *
 * ⚠️ O PRÓXIMO PASSO MORA AQUI DENTRO, E NÃO NO CABEÇALHO (13/10/2026). Ele
 * tem um botão que leva à aba onde o passo se resolve, e quem sabe trocar de
 * aba é este componente. O servidor manda só o DADO (título, detalhe, aba):
 * função não atravessa a fronteira servidor → navegador — foi isso que
 * derrubou todas as telas do treino em 08/09/2026.
 */

const ROTULO: Record<AbaDaFichaId, string> = {
  ...ETAPA_ROTULO,
  historico: "Histórico",
};

const ICONE: Record<AbaDaFichaId, LucideIcon> = {
  levantamento: ClipboardList,
  proposta: FileSpreadsheet,
  apresentacao: Presentation,
  envio: Send,
  fechamento: Handshake,
  historico: History,
};

const SELO: Record<SituacaoDaEtapa["estado"], { icone: LucideIcon; cor: string }> = {
  falta: { icone: CircleAlert, cor: "text-amber-600 dark:text-amber-400" },
  pronto: { icone: Circle, cor: "text-muted-foreground" },
  feito: { icone: CheckCircle2, cor: "text-emerald-600 dark:text-emerald-400" },
};

const TOM: Record<ProximoPasso["tom"], { rotulo: string; classe: string }> = {
  agir: { rotulo: "Próximo passo", classe: "border-gold/50 bg-gold/10" },
  alerta: { rotulo: "Atenção", classe: "border-amber-500/50 bg-amber-500/10" },
  ok: { rotulo: "Situação", classe: "border-emerald-600/40 bg-emerald-600/5" },
  encerrado: { rotulo: "Situação", classe: "border-border bg-muted/40" },
};

export type AbaDaFicha = {
  id: AbaDaFichaId;
  situacao: SituacaoDaEtapa;
  /** Verdadeiro na aba correspondente à fase em que a empresa está agora. */
  agora: boolean;
  painel: ReactNode;
};

const IrParaAba = createContext<((aba: AbaDaFichaId) => void) | null>(null);

/**
 * Um botão, de dentro de qualquer painel, que leva a outra aba — "marque os
 * selos na aba Envio" deixa de ser instrução e vira um clique.
 */
export function BotaoIrParaAba({
  aba,
  children,
}: {
  aba: AbaDaFichaId;
  children: ReactNode;
}) {
  const ir = useContext(IrParaAba);
  if (!ir) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        ir(aba);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }}
    >
      {children}
      <ArrowRight className="ml-1 size-3.5" />
    </Button>
  );
}

export function AbasDaFicha({
  abas,
  inicial,
  proximo,
}: {
  abas: AbaDaFicha[];
  inicial: AbaDaFichaId;
  /** O que fazer agora com esta empresa (dado puro, calculado no servidor). */
  proximo?: ProximoPasso;
}) {
  const [ativa, setAtiva] = useState<AbaDaFichaId>(inicial);
  const tom = proximo ? TOM[proximo.tom] : null;

  return (
    <IrParaAba.Provider value={setAtiva}>
      {proximo && tom && (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3",
            tom.classe
          )}
        >
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {tom.rotulo}
            </p>
            <p className="text-base font-semibold">{proximo.titulo}</p>
            <p className="text-sm text-muted-foreground">{proximo.detalhe}</p>
          </div>
          {proximo.aba !== ativa && (
            <Button type="button" size="sm" onClick={() => setAtiva(proximo.aba)}>
              Ir para {ROTULO[proximo.aba]}
              <ArrowRight className="ml-1 size-3.5" />
            </Button>
          )}
        </div>
      )}

      <div>
        <div className="sticky top-0 z-10 -mx-4 mb-4 overflow-x-auto border-b border-border bg-background/95 px-4 backdrop-blur [-ms-overflow-style:none] [scrollbar-width:none] supports-[backdrop-filter]:bg-background/80 [&::-webkit-scrollbar]:hidden">
          <div role="tablist" className="flex gap-1">
            {abas.map((aba) => {
              const Icone = ICONE[aba.id];
              const selo = SELO[aba.situacao.estado];
              const Selo = selo.icone;
              const ativo = ativa === aba.id;
              return (
                <button
                  key={aba.id}
                  type="button"
                  role="tab"
                  aria-selected={ativo}
                  onClick={() => setAtiva(aba.id)}
                  title={`${ROTULO[aba.id]} — ${aba.situacao.resumo}`}
                  className={cn(
                    "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-left text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    ativo
                      ? "border-gold text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icone
                    className={cn(
                      "size-4 shrink-0",
                      ativo ? "text-gold-tinta" : "text-muted-foreground"
                    )}
                  />
                  <span className="flex flex-col leading-tight">
                    <span className="flex items-center gap-1">
                      {ROTULO[aba.id]}
                      {/* O passo de agora fica marcado mesmo quando a pessoa
                          está olhando outra aba — senão ela perde a referência
                          de onde o trabalho parou. */}
                      {aba.agora && (
                        <span className="rounded bg-gold/20 px-1 text-[10px] font-semibold text-gold-tinta">
                          agora
                        </span>
                      )}
                    </span>
                    <span
                      className={cn("flex items-center gap-1 text-[11px] font-normal", selo.cor)}
                    >
                      <Selo className="size-3 shrink-0" />
                      {aba.situacao.resumo}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {abas.map((aba) => (
          <div
            key={aba.id}
            role="tabpanel"
            hidden={ativa !== aba.id}
            className="space-y-4"
          >
            {aba.painel}
          </div>
        ))}
      </div>
    </IrParaAba.Provider>
  );
}
