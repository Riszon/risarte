"use client";

import { useState, type ReactNode } from "react";
import {
  CheckCircle2,
  Circle,
  CircleAlert,
  ClipboardList,
  FileSpreadsheet,
  Handshake,
  Presentation,
  Send,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ETAPA_ROTULO,
  type EtapaDaFicha,
  type SituacaoDaEtapa,
} from "@/lib/empresarial/etapas-do-funil";

/**
 * A FICHA DA EMPRESA EM ABAS (OC-00083).
 *
 * ⚠️ TODAS AS ABAS FICAM MONTADAS; a inativa é escondida (`hidden`), não
 * desmontada. São quatro formulários independentes, cada um com o seu salvar:
 * desmontar ao trocar de aba apagaria o que a pessoa acabou de digitar e não
 * salvou — e ela descobriria isso só ao voltar. É a mesma escolha da ficha do
 * paciente (`prontuario-tabs.tsx`).
 *
 * Não reusei aquele componente porque ele é do núcleo e esta tela precisa de
 * coisas que ele não tem (abrir na etapa da empresa, selo de situação por
 * aba). Regra do CLAUDE.md §0: o Empresarial cria arquivo próprio em vez de
 * empurrar mudança para arquivo compartilhado.
 */

const ICONE: Record<EtapaDaFicha, LucideIcon> = {
  levantamento: ClipboardList,
  proposta: FileSpreadsheet,
  apresentacao: Presentation,
  envio: Send,
  fechamento: Handshake,
};

const SELO: Record<SituacaoDaEtapa["estado"], { icone: LucideIcon; cor: string }> = {
  falta: { icone: CircleAlert, cor: "text-amber-600 dark:text-amber-400" },
  pronto: { icone: Circle, cor: "text-muted-foreground" },
  feito: { icone: CheckCircle2, cor: "text-emerald-600 dark:text-emerald-400" },
};

export type AbaDaFicha = {
  id: EtapaDaFicha;
  situacao: SituacaoDaEtapa;
  /** Verdadeiro na aba correspondente à fase em que a empresa está agora. */
  agora: boolean;
  painel: ReactNode;
};

export function AbasDaFicha({
  abas,
  inicial,
}: {
  abas: AbaDaFicha[];
  inicial: EtapaDaFicha;
}) {
  const [ativa, setAtiva] = useState<EtapaDaFicha>(inicial);

  return (
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
                title={`${ETAPA_ROTULO[aba.id]} — ${aba.situacao.resumo}`}
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
                    {ETAPA_ROTULO[aba.id]}
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
  );
}
