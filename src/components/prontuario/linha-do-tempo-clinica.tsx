"use client";

// OD6 (J2): a linha do tempo clínica + o odontograma de um dia do passado.
// A conta do dia é de `src/lib/odontograma/historico.ts`; aqui é só a tela.

import { useMemo, useState } from "react";
import { CalendarSearch } from "lucide-react";
import { Odontograma } from "@/components/odontograma/odontograma";
import { cn } from "@/lib/utils";
import { BRAZIL_TIME_ZONE, formatIsoDateBr, todayInBrazil } from "@/lib/dates";
import type { DadosDoOdontograma } from "@/lib/odontograma/carregar";
import { marcasNoDia } from "@/lib/odontograma/historico";
import { ROTULO_DO_TIPO, porDia, type EventoClinico, type TipoDeEvento } from "@/lib/prontuario/linha-do-tempo";

const COR_DO_TIPO: Record<TipoDeEvento, string> = {
  consentimento: "bg-zinc-400",
  anamnese: "bg-sky-500",
  avaliacao: "bg-sky-600",
  diagnostico: "bg-indigo-600",
  achado: "bg-indigo-400",
  plano: "bg-amber-500",
  sessao: "bg-emerald-600",
  evolucao: "bg-emerald-500",
  adendo: "bg-amber-600",
  documento: "bg-zinc-500",
  prontuario: "bg-rose-500",
};

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { timeZone: BRAZIL_TIME_ZONE, hour: "2-digit", minute: "2-digit" });

export function LinhaDoTempoClinica({
  eventos,
  odonto,
}: {
  eventos: EventoClinico[];
  /** Nulo = o desenho não carregou; a lista segue. */
  odonto: DadosDoOdontograma | null;
}) {
  const hoje = todayInBrazil();
  const [dia, setDia] = useState(hoje);
  const dias = useMemo(() => porDia(eventos), [eventos]);
  const marcas = useMemo(
    () =>
      odonto
        ? marcasNoDia(dia, odonto.achados ?? [], odonto.situacoes, odonto.historico, odonto.regrasDasSessoes)
        : [],
    [dia, odonto]
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,1.1fr)]">
      <section className="min-w-0 space-y-3">
        {dias.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Nenhum registro clínico ainda.
          </p>
        ) : (
          dias.map((d) => (
            <div key={d.dia} className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{formatIsoDateBr(d.dia)}</h3>
                {odonto && (
                  <button
                    type="button"
                    onClick={() => setDia(d.dia)}
                    aria-pressed={dia === d.dia}
                    className={cn(
                      "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]",
                      dia === d.dia ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
                    )}
                  >
                    <CalendarSearch className="size-3" /> ver o odontograma neste dia
                  </button>
                )}
              </div>
              <ul className="space-y-1 border-l pl-3">
                {d.eventos.map((e, i) => (
                  <li key={`${d.dia}-${i}`} className="relative text-sm">
                    <span
                      className={cn("absolute -left-[17px] top-1.5 size-2 rounded-full", COR_DO_TIPO[e.tipo])}
                      aria-hidden
                    />
                    <span className="text-xs tabular-nums text-muted-foreground">{hora(e.quando)}</span>{" "}
                    <span className="text-xs font-medium text-muted-foreground">{ROTULO_DO_TIPO[e.tipo]} ·</span>{" "}
                    <span>{e.titulo}</span>
                    {e.detalhe && <span className="text-xs text-muted-foreground"> — {e.detalhe}</span>}
                    {e.quem && <span className="text-xs text-muted-foreground"> · {e.quem}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {odonto && (
        <section className="min-w-0 space-y-2 lg:sticky lg:top-4 lg:self-start">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">O odontograma em</h3>
            <input
              type="date"
              value={dia}
              max={hoje}
              onChange={(e) => e.target.value && setDia(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              aria-label="Dia do odontograma"
            />
            {dia !== hoje && (
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => setDia(hoje)}>
                voltar para hoje
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            O diagnóstico definido até esse dia e o que já tinha sido feito até ele (o vermelho é o
            achado que pedia tratamento naquele dia).
          </p>
          <Odontograma
            key={dia}
            modo="leitura"
            denticaoInicial={odonto.denticao}
            nomes={odonto.nomes}
            faces={odonto.faces}
            marcas={marcas}
          />
        </section>
      )}
    </div>
  );
}
