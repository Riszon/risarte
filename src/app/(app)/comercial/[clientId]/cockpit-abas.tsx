"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  CircleDot,
  FileSignature,
  Handshake,
  UserRound,
  Video,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AbaDoCockpit, Etapa, SituacaoDaEtapa } from "@/lib/cockpit-comercial";

/**
 * O COCKPIT EM ABAS (OC-00158). No alto, o caminho da venda (as quatro
 * etapas) e o próximo passo; abaixo, uma aba por assunto, abrindo na etapa da
 * vez (`abaInicial`, decidida no servidor).
 *
 * ⚠️ TODAS AS ABAS FICAM MONTADAS; a inativa é escondida (`hidden`). A
 * negociação e a apresentação são formulários com salvar próprio: desmontar ao
 * trocar de aba apagaria o que a pessoa digitou e não salvou. Mesma escolha da
 * ficha do paciente (`prontuario-tabs.tsx`) e do funil do Empresarial.
 *
 * O servidor manda só DADO (etapas, frase, aba): função não atravessa a
 * fronteira servidor → navegador. A aba escolhida vai para o endereço
 * (`?aba=`) sem navegar, para o recarregar e o link voltarem nela.
 */

const ABA: Record<AbaDoCockpit, { rotulo: string; icone: LucideIcon }> = {
  apresentacao: { rotulo: "Apresentação", icone: Video },
  negociacao: { rotulo: "Negociação", icone: Handshake },
  fechamento: { rotulo: "Fechamento", icone: FileSignature },
  cliente: { rotulo: "Cliente", icone: UserRound },
};

const SELO: Record<SituacaoDaEtapa, { icone: LucideIcon; cor: string }> = {
  feito: { icone: CheckCircle2, cor: "text-emerald-600 dark:text-emerald-400" },
  agora: { icone: CircleDot, cor: "text-gold-tinta" },
  depois: { icone: Circle, cor: "text-muted-foreground" },
};

export function CockpitAbas({
  etapas,
  proximo,
  inicial,
  paineis,
}: {
  etapas: Etapa[];
  proximo: string;
  inicial: AbaDoCockpit;
  paineis: Record<AbaDoCockpit, ReactNode>;
}) {
  const [ativa, setAtiva] = useState<AbaDoCockpit>(inicial);
  const agora = etapas.find((e) => e.situacao === "agora") ?? null;

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("aba") === ativa) return;
    url.searchParams.set("aba", ativa);
    window.history.replaceState(window.history.state, "", url);
  }, [ativa]);

  // A aba mostra a pior situação das etapas que moram nela (Fechamento =
  // contrato + pagamento); a Cliente não é etapa e fica sem selo.
  function seloDaAba(aba: AbaDoCockpit): { situacao: SituacaoDaEtapa; detalhe: string } | null {
    const daAba = etapas.filter((e) => e.aba === aba);
    if (daAba.length === 0) return null;
    const pendente = daAba.find((e) => e.situacao === "agora") ?? daAba.find((e) => e.situacao === "depois");
    const e = pendente ?? daAba[daAba.length - 1];
    return { situacao: e.situacao, detalhe: e.detalhe };
  }

  return (
    <div className="space-y-4">
      {/* O caminho da venda + o próximo passo. */}
      <div className="rounded-xl border border-gold/50 bg-gold/10 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Próximo passo
            </p>
            <p className="text-sm font-semibold sm:text-base">{proximo}</p>
          </div>
          {agora && agora.aba !== ativa && (
            <Button type="button" size="sm" onClick={() => setAtiva(agora.aba)}>
              Ir para {ABA[agora.aba].rotulo}
              <ArrowRight className="ml-1 size-3.5" />
            </Button>
          )}
        </div>
        <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Caminho da venda">
          {etapas.map((e, i) => {
            const selo = SELO[e.situacao];
            const Selo = selo.icone;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setAtiva(e.aba)}
                  aria-current={e.situacao === "agora" ? "step" : undefined}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-lg border bg-card px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    e.situacao === "agora" && "border-gold ring-1 ring-gold/40"
                  )}
                >
                  <Selo className={cn("mt-0.5 size-4 shrink-0", selo.cor)} />
                  <span className="min-w-0 leading-tight">
                    <span className="block text-xs font-semibold">
                      {i + 1}. {e.titulo}
                    </span>
                    <span className={cn("block text-[11px]", e.situacao === "feito" ? selo.cor : "text-muted-foreground")}>
                      {e.detalhe}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div>
        <div className="sticky top-0 z-10 -mx-4 mb-4 overflow-x-auto border-b border-border bg-background/95 px-4 backdrop-blur [-ms-overflow-style:none] [scrollbar-width:none] supports-[backdrop-filter]:bg-background/80 [&::-webkit-scrollbar]:hidden">
          <div role="tablist" className="flex gap-1">
            {(Object.keys(ABA) as AbaDoCockpit[]).map((id) => {
              const { rotulo, icone: Icone } = ABA[id];
              const selo = seloDaAba(id);
              const Selo = selo ? SELO[selo.situacao].icone : null;
              const ativo = ativa === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={ativo}
                  onClick={() => setAtiva(id)}
                  className={cn(
                    "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-left text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    ativo
                      ? "border-gold text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icone className={cn("size-4 shrink-0", ativo ? "text-gold-tinta" : "text-muted-foreground")} />
                  <span className="flex flex-col leading-tight">
                    <span>{rotulo}</span>
                    {selo && Selo && (
                      <span className={cn("flex items-center gap-1 text-[11px] font-normal", SELO[selo.situacao].cor)}>
                        <Selo className="size-3 shrink-0" />
                        {selo.detalhe}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {(Object.keys(ABA) as AbaDoCockpit[]).map((id) => (
          <div key={id} role="tabpanel" hidden={ativa !== id} className="space-y-4">
            {paineis[id]}
          </div>
        ))}
      </div>
    </div>
  );
}
