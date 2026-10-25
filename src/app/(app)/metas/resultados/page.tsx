import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Download, Trophy } from "lucide-react";
import { formatIsoDateBr } from "@/lib/dates";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { FilterForm } from "@/components/filter-form";
import { Button } from "@/components/ui/button";
import { BarraDaMeta } from "@/components/metas/barra-da-meta";
import { indicadorDe } from "@/lib/metas/indicadores";
import { DESFECHO_LABEL, formatarPct } from "@/lib/metas/regras";
import type { Contagem } from "@/lib/metas/resultados";
import { cn } from "@/lib/utils";
import { carregarResultados } from "./dados";

export const metadata: Metadata = { title: "Resultados — Metas" };

const selectClass = "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";
const inputClass = "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

const COR_DO_DESFECHO: Record<string, string> = {
  stretch: "bg-amber-400/15 text-amber-700 dark:text-amber-300",
  achieved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  not_achieved: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  no_data: "bg-muted text-muted-foreground",
};

function Quadro({
  titulo,
  itens,
  vazio,
  extra,
}: {
  titulo: string;
  itens: (Contagem & { id: string; nome: string; pctMedio?: number | null })[];
  vazio: string;
  extra?: React.ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-3 rounded-xl border bg-card p-5 shadow-sm">
      <h2 className="font-semibold">{titulo}</h2>
      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">{vazio}</p>
      ) : (
        <ul className="space-y-2">
          {itens.map((x, i) => (
            <li key={x.id} className="grid items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[1.5rem_1fr_8rem_9rem]">
              <span className="text-xs tabular-nums text-muted-foreground">{i + 1}º</span>
              <span className="min-w-0 truncate">{x.nome}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {x.atingidas} de {x.comDado} atingida{x.comDado === 1 ? "" : "s"}
                {x.metas > x.comDado ? ` · ${x.metas - x.comDado} sem dados` : ""}
              </span>
              <span className="flex items-center gap-2">
                <BarraDaMeta pct={x.taxa} tamanho="sm" farol={(x.taxa ?? 0) >= 70 ? "verde" : "neutro"} />
                <span className="w-12 text-right text-xs tabular-nums">{formatarPct(x.taxa)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {extra}
    </section>
  );
}

export default async function ResultadosDasMetasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const c = await carregarResultados(sp);
  const r = c.resultados;
  const qs = new URLSearchParams({ de: c.de, ate: c.ate, ...(c.unidade ? { unidade: c.unidade } : {}) });
  const eu = r.pessoas.find((p) => p.id === c.session.userId) ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Metas"
        icone={BarChart3}
        titulo="Resultados das metas"
        descricao="As metas encerradas no período: quantas foram atingidas, onde e em quê. O resultado é o congelado no fim de cada meta — não muda mais."
        voltar={{ href: "/metas", rotulo: "Metas" }}
      >
        {/* Link comum (não <Link>): exportar é ação registrada, e o Next pré-carregaria a rota. */}
        <Button
          nativeButton={false}
          render={<a href={`/metas/resultados/planilha?${qs.toString()}`} />}
          className="bg-primary-foreground text-primary hover:bg-primary-foreground/90"
        >
          <Download className="mr-1 size-4" /> Planilha
        </Button>
      </CabecalhoDeModulo>

      <FilterForm className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 text-sm">
          De <input type="date" name="de" defaultValue={c.de} className={inputClass} />
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          Até <input type="date" name="ate" defaultValue={c.ate} className={inputClass} />
        </label>
        {c.unidadesDoFiltro.length > 1 && (
          <select name="unidade" defaultValue={c.unidade} className={selectClass} aria-label="Unidade">
            <option value="">Todas as unidades</option>
            {c.unidadesDoFiltro.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </select>
        )}
      </FilterForm>

      {c.erro ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{c.erro}</p>
      ) : r.resumo.metas === 0 ? (
        <div className="rounded-xl border px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhuma meta encerrada de {formatIsoDateBr(c.de)} a {formatIsoDateBr(c.ate)}. A meta entra aqui quando termina o
          prazo e o resultado é congelado.
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-5">
            {[
              { t: "Metas encerradas", v: String(r.resumo.metas) },
              { t: "Atingidas", v: String(r.resumo.atingidas) },
              { t: "Super Meta", v: String(r.resumo.superMeta) },
              { t: "Não atingidas", v: String(r.resumo.naoAtingidas) },
              { t: "Taxa de atingimento", v: formatarPct(r.resumo.taxa) },
            ].map((x) => (
              <div key={x.t} className="rounded-xl border bg-card p-4 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{x.t}</p>
                <p className="text-2xl font-semibold tabular-nums">{x.v}</p>
              </div>
            ))}
          </section>
          {r.resumo.semDados > 0 && (
            <p className="text-xs text-muted-foreground">
              {r.resumo.semDados === 1 ? "1 meta ficou" : `${r.resumo.semDados} metas ficaram`} sem dados para apurar e não
              {r.resumo.semDados === 1 ? " entra" : " entram"} na taxa.
            </p>
          )}

          {c.avisoDaLeitura && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">{c.avisoDaLeitura}</p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Quadro
              titulo="Por unidade"
              itens={r.porUnidade}
              vazio="Nenhuma unidade com registro nas metas do período."
              extra={
                <p className="text-xs text-muted-foreground">
                  Conta cada meta em que a unidade teve registro, pelo alvo dela. Unidade sem nenhum registro na meta não
                  entra.
                </p>
              }
            />
            <Quadro
              titulo="Por indicador"
              itens={r.porIndicador.map((x) => ({ ...x, id: x.chave, nome: x.rotulo }))}
              vazio="—"
            />
            <Quadro
              titulo="Por objetivo estratégico"
              itens={r.porObjetivo.map((x) => ({ ...x, id: x.valor || "sem", nome: x.rotulo }))}
              vazio="—"
            />
            {c.gestao ? (
              <Quadro
                titulo="Quem mais atinge (metas individuais)"
                itens={r.pessoas}
                vazio="Nenhuma meta individual encerrada no período."
                extra={
                  <p className="text-xs text-muted-foreground">
                    Só aparece para quem cria metas, e só com as metas que você pode editar. Cada pessoa vê o próprio
                    resultado na ficha da meta.
                  </p>
                }
              />
            ) : (
              <section className="space-y-2 rounded-xl border bg-card p-5 shadow-sm">
                <h2 className="inline-flex items-center gap-2 font-semibold">
                  <Trophy className="size-4 text-amber-600 dark:text-amber-300" aria-hidden /> Você
                </h2>
                <p className="text-sm">
                  {eu
                    ? `Nas metas individuais do período, você atingiu ${eu.atingidas} de ${eu.comDado}.`
                    : "Nenhuma meta individual sua encerrada no período."}
                </p>
              </section>
            )}
          </div>

          <section className="min-w-0 space-y-3 rounded-xl border bg-card p-5 shadow-sm">
            <h2 className="font-semibold">As metas ({r.lista.length})</h2>
            <ul className="divide-y">
              {r.lista.map(({ meta, pct, onde }) => (
                <li key={meta.id} className="grid items-center gap-x-3 gap-y-1 py-2 text-sm sm:grid-cols-[1fr_10rem_9rem]">
                  <Link href={`/metas/${meta.id}`} className="min-w-0 hover:text-primary">
                    <span className="block truncate font-medium">{meta.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {indicadorDe(meta.indicator)?.rotulo ?? meta.indicator} · {onde} · {formatIsoDateBr(meta.starts_on)} a{" "}
                      {formatIsoDateBr(meta.ends_on)} · {meta.code}
                    </span>
                  </Link>
                  <span
                    className={cn(
                      "w-fit rounded-full px-2 py-0.5 text-xs font-medium",
                      COR_DO_DESFECHO[meta.outcome ?? "no_data"]
                    )}
                  >
                    {meta.outcome ? DESFECHO_LABEL[meta.outcome] : "Apurando"}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground sm:text-right">
                    {pct != null ? `${formatarPct(pct)} da meta` : ""}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Só percentuais: os valores em R$ ficam na ficha de cada meta, para quem pode vê-los. Meta mensal: média dos
              meses, e só conta como atingida se atingiu em todos.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
