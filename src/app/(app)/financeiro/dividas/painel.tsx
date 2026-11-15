"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { formatIsoMonthBr } from "@/lib/dates";
import type { DebtListRow } from "@/lib/finance/dividas";
import {
  FILTRO_INICIAL,
  aging,
  distribuicao,
  evolucaoMensal,
  evolucaoPorCategoria,
  fotosDoFiltro,
  indicadoresDoPainel,
  linhasDoPainel,
  saudeFinanceira,
  type AcordoDoPainel,
  type DreDoDevedor,
  type FiltroDoPainel,
  type FotoDoMes,
} from "@/lib/finance/dividas-painel";
import { BarrasHorizontais, BarrasVerticais, GraficoDeLinhas } from "@/components/dividas/graficos";
import type { BaseDasDividas } from "./dados";
import { SELECT_CLASS } from "./formulario-da-divida";

// O PAINEL do Levantamento de Dívidas (fase 6, plano 3 e 3.10 do pedido): os
// cards e os gráficos, com o seletor de devedor ("Rede consolidada" ou um
// CNPJ), a etiqueta e o "sem contestadas e judiciais" (D17). Tudo é conta
// pura (`dividas-painel.ts`) sobre o que a página já leu; o passado vem da
// fotografia mensal, nunca reconstruído.

type Distribuicao = "credor" | "categoria" | "natureza";

export function PainelDasDividas({
  base,
  linhas,
  acordos,
  fotos,
  hoje,
  semRegraUnica,
  dre,
  periodoDaDre,
}: {
  base: BaseDasDividas;
  linhas: DebtListRow[];
  acordos: (AcordoDoPainel & { parcelasDoMesCents: number })[];
  /** Fase 7: a DRE dos meses fechados de cada CNPJ (pares para atravessar ao navegador). */
  dre: [string, DreDoDevedor][];
  periodoDaDre: { de: string; ate: string };
  /** Nulo = a fotografia não pôde ser lida. */
  fotos: FotoDoMes[] | null;
  hoje: string;
  /** Sem a 0408 no banco, o saldo é o antigo (sem acordo). */
  semRegraUnica: boolean;
}) {
  const [f, setF] = useState<FiltroDoPainel>(FILTRO_INICIAL);
  const [comMovimento, setComMovimento] = useState(false);
  const [dist, setDist] = useState<Distribuicao>("credor");
  const mesAtual = `${hoje.slice(0, 7)}-01`;

  const nomeDoDevedor = useMemo(() => new Map(base.devedores.map((d) => [d.id, d.nome])), [base]);
  const nomeDaCategoria = useMemo(() => new Map(base.categorias.map((c) => [c.id, c.nome])), [base]);
  const nomeDaNatureza = useMemo(() => new Map(base.naturezas.map((n) => [n.code, n.label])), [base]);
  const nomeDoCredor = useMemo(() => new Map(base.credores.map((c) => [c.id, c.nome])), [base]);

  const rows = useMemo(() => linhasDoPainel(linhas, f), [linhas, f]);
  const ind = useMemo(() => indicadoresDoPainel(rows, acordos, hoje), [rows, acordos, hoje]);
  const fotosF = useMemo(() => fotosDoFiltro(fotos ?? [], f), [fotos, f]);
  const evolucao = useMemo(() => evolucaoMensal(fotosF, rows, mesAtual), [fotosF, rows, mesAtual]);
  const devedoresComDivida = useMemo(
    () => base.devedores.filter((d) => linhas.some((r) => r.clinicId === d.id && r.status !== "baixada")),
    [base, linhas]
  );
  // Rede consolidada: uma linha por CNPJ + a da rede.
  const seriesDaEvolucao = useMemo(() => {
    const meses = evolucao.map((p) => p.mes);
    const rede = { chave: "rede", rotulo: f.devedor ? nomeDoDevedor.get(f.devedor) ?? "Devedor" : "Rede consolidada", valores: evolucao.map((p) => p.saldoCents) };
    if (f.devedor || devedoresComDivida.length < 2) return { meses, series: [rede] };
    const porDevedor = devedoresComDivida.slice(0, 5).map((d) => {
      const e = evolucaoMensal(fotosDoFiltro(fotos ?? [], { ...f, devedor: d.id }), linhasDoPainel(linhas, { ...f, devedor: d.id }), mesAtual);
      const porMes = new Map(e.map((p) => [p.mes, p.saldoCents]));
      return { chave: d.id, rotulo: d.nome, valores: meses.map((m) => porMes.get(m) ?? 0) };
    });
    return { meses, series: [rede, ...porDevedor] };
  }, [evolucao, f, nomeDoDevedor, devedoresComDivida, fotos, linhas, mesAtual]);
  const porCategoria = useMemo(
    () => evolucaoPorCategoria(fotosF, rows, mesAtual, (id) => nomeDaCategoria.get(id) ?? "—"),
    [fotosF, rows, mesAtual, nomeDaCategoria]
  );
  const fatias = useMemo(
    () =>
      dist === "credor"
        ? distribuicao(rows, (r) => r.supplierId, (k) => nomeDoCredor.get(k) ?? "—")
        : dist === "categoria"
          ? distribuicao(rows, (r) => r.categoryId, (k) => nomeDaCategoria.get(k) ?? "—")
          : distribuicao(rows, (r) => r.natureCode, (k) => nomeDaNatureza.get(k) ?? k),
    [rows, dist, nomeDoCredor, nomeDaCategoria, nomeDaNatureza]
  );
  const faixas = useMemo(() => aging(rows, hoje), [rows, hoje]);
  const comparativo = useMemo(() => distribuicao(rows, (r) => r.clinicId, (k) => nomeDoDevedor.get(k) ?? "—", 12), [rows, nomeDoDevedor]);
  const semHistorico = evolucao.length <= 1;
  const saude = useMemo(() => saudeFinanceira(rows, acordos, new Map(dre), nomeDoDevedor), [rows, acordos, dre, nomeDoDevedor]);
  const pct = (x: number | null) => (x === null ? "sem dados" : `${(x * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
  const vezes = (x: number | null) => (x === null ? "sem dados" : `${x.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mês(es)`);
  const t = ind.totais;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3 text-sm">
        <label className="block min-w-48">
          <span className="text-[11px] text-muted-foreground">Devedor</span>
          <select className={SELECT_CLASS} value={f.devedor} onChange={(e) => setF({ ...f, devedor: e.target.value })}>
            <option value="">Rede consolidada</option>
            {base.devedores.map((d) => (
              <option key={d.id} value={d.id}>{d.nome}</option>
            ))}
          </select>
        </label>
        <label className="block min-w-40">
          <span className="text-[11px] text-muted-foreground">Etiqueta</span>
          <select className={SELECT_CLASS} value={f.etiqueta} onChange={(e) => setF({ ...f, etiqueta: e.target.value })}>
            <option value="">Todas</option>
            {base.etiquetas.filter((e) => e.ativa).map((e) => (
              <option key={e.id} value={e.id}>{e.nome}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" className="accent-primary" checked={f.semContestadas} onChange={(e) => setF({ ...f, semContestadas: e.target.checked })} />
          Sem as contestadas e judiciais
        </label>
        <span className="pb-2 text-xs text-muted-foreground">{rows.length} dívida{rows.length === 1 ? "" : "s"} no filtro</span>
      </div>

      {semRegraUnica && (
        <p className="rounded-lg border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Sem a migração 0408 neste banco: o saldo das dívidas renegociadas não reflete o acordo.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao titulo="Total devido" valor={formatBRL(t.devidoCents)}
          nota={t.contestadaJudicialCents > 0 ? `dos quais ${formatBRL(t.contestadaJudicialCents)} contestado ou judicial` : `${t.quantidade} dívida(s)`} />
        <Cartao titulo="Estimado para regularizar" valor={formatBRL(t.estimadoCents)} nota="a proposta, quando há; senão o devido" />
        <Cartao titulo="Custo total para regularizar" valor={formatBRL(t.custoTotalCents)}
          nota={t.custasCents > 0 ? `com ${formatBRL(t.custasCents)} de custas de cartório` : "sem custas de cartório em aberto"} />
        <Cartao titulo="Economia potencial" valor={formatBRL(t.economiaCents)}
          nota={t.descontoMedio === null ? "nenhuma dívida com proposta" : `desconto médio de ${Math.round(t.descontoMedio * 100)}% (só onde há proposta)`} />
        <Cartao titulo="Sem proposta" valor={formatBRL(t.semPropostaCents)} nota="pendência de negociação" />
        <Cartao titulo="Propostas atuais" valor={formatBRL(t.propostasCents)} nota={`sobre ${formatBRL(t.comPropostaDevidoCents)} devidos`} />
        <Cartao titulo="Já quitado" valor={formatBRL(ind.quitadoCents)} nota="pago nos títulos e nas parcelas" />
        <Cartao titulo="Economia já obtida" valor={formatBRL(ind.economiaObtidaCents)} nota="desconto dos acordos em dia ou cumpridos" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Contagem titulo="Em atraso" c={ind.emAtraso} />
        <Contagem titulo="Inadimplentes" c={ind.inadimplentes} />
        <Contagem titulo="Negativadas" c={ind.negativadas} />
        <Contagem titulo="Protestadas" c={ind.protestadas} />
        <Contagem titulo="Com ação judicial" c={ind.judiciais} />
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">Acordos valendo</p>
            <p className="text-lg font-semibold tabular-nums">{formatBRL(ind.acordos.saldoCents)}</p>
            <p className="text-[11px] text-muted-foreground">
              {ind.acordos.quantidade} acordo(s) · {formatBRL(ind.acordos.proximos30Cents)} em 30 dias
              {ind.acordos.quebrados > 0 && ` · ${ind.acordos.quebrados} quebrado(s)`}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="py-3 text-sm">
          <p className="mb-1 flex items-center gap-1.5 font-medium">
            <AlertTriangle className="size-4 text-red-700 dark:text-red-300" /> CNPJs com restrição
          </p>
          {ind.cnpjsComRestricao.length === 0 ? (
            <p className="text-muted-foreground">Nenhum CNPJ com negativação, protesto ou ação judicial no filtro.</p>
          ) : (
            <ul className="flex flex-wrap gap-x-6 gap-y-1">
              {ind.cnpjsComRestricao.map((c) => (
                <li key={c.clinicId}>
                  <span className="font-medium">{c.nome}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    — {[c.negativadas && `${c.negativadas} negativada(s)`, c.protestadas && `${c.protestadas} protestada(s)`, c.judiciais && `${c.judiciais} judicial(is)`]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Secao titulo="Saúde financeira">
        <p className="text-xs text-muted-foreground">
          Receita bruta média e custo financeiro (juros, multas e encargos, conta 4.2.01) de {formatIsoMonthBr(periodoDaDre.de)} a{" "}
          {formatIsoMonthBr(periodoDaDre.ate)}, pela DRE de cada CNPJ. O comprometimento divide as parcelas de acordo que vencem neste
          mês pela receita média. CNPJ sem receita lançada aparece como “sem dados”.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1">Devedor</th>
                <th className="px-2 py-1 text-right">Devido</th>
                <th className="px-2 py-1 text-right">Receita média/mês</th>
                <th className="px-2 py-1 text-right">Meses de receita</th>
                <th className="px-2 py-1 text-right">Parcelas de acordo no mês</th>
                <th className="px-2 py-1 text-right">Comprometimento</th>
                <th className="px-2 py-1 text-right">Custo financeiro (3 meses)</th>
              </tr>
            </thead>
            <tbody>
              {[...saude.linhas, ...(saude.linhas.length > 1 ? [saude.rede] : [])].map((l) => (
                <tr key={l.clinicId || "rede"} className={cn("border-t", !l.clinicId && "font-semibold")}>
                  <td className="px-2 py-1.5">{l.nome}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatBRL(l.devidoCents)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{l.receitaMediaCents === null ? "sem dados" : formatBRL(l.receitaMediaCents)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{vezes(l.mesesDeReceita)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatBRL(l.parcelasDoMesCents)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{pct(l.comprometimento)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{l.custoFinanceiroCents === null ? "sem dados" : formatBRL(l.custoFinanceiroCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Secao>

      <Secao titulo="Evolução mensal do saldo devedor">
        {fotos === null ? (
          <p className="text-sm text-muted-foreground">Não foi possível ler a fotografia mensal agora.</p>
        ) : (
          <>
            {semHistorico && (
              <p className="text-xs text-muted-foreground">
                Sem histórico ainda: a fotografia de cada mês é guardada no dia 1º do mês seguinte. Por enquanto, só o mês corrente
                (calculado agora).
              </p>
            )}
            <div className="max-w-4xl">
              <GraficoDeLinhas meses={seriesDaEvolucao.meses} series={seriesDaEvolucao.series} ultimoAoVivo rotulo="Saldo devedor ao fim de cada mês" largura={860} />
            </div>
            <p className="text-[11px] text-muted-foreground">* mês corrente, até hoje.</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-primary" checked={comMovimento} onChange={(e) => setComMovimento(e.target.checked)} />
              Ver também o quitado no mês e as dívidas novas
            </label>
            {comMovimento && (
              <div className="max-w-4xl">
              <BarrasVerticais
                eixo={evolucao.map((p) => `${p.mes.slice(5, 7)}/${p.mes.slice(2, 4)}${p.aoVivo ? "*" : ""}`)}
                series={[
                  { chave: "pago", rotulo: "Quitado no mês", valores: evolucao.map((p) => p.pagoCents) },
                  { chave: "novas", rotulo: "Dívidas novas", valores: evolucao.map((p) => p.novasCents) },
                ]}
                rotulo="Quitado e dívidas novas por mês"
                largura={860}
              />
              </div>
            )}
          </>
        )}
      </Secao>

      <div className="grid gap-4 lg:grid-cols-2">
        <Secao titulo="Quanto se deve, por…">
          <div className="flex gap-1 text-xs">
            {(["credor", "categoria", "natureza"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDist(d)}
                className={cn("rounded-full border px-2.5 py-0.5", dist === d ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground")}
              >
                {d === "credor" ? "Credor" : d === "categoria" ? "Categoria" : "Natureza"}
              </button>
            ))}
          </div>
          <BarrasHorizontais itens={fatias} rotulo={`Devido por ${dist}`} />
        </Secao>

        <Secao titulo="Faixas de atraso (aging)">
          <BarrasVerticais
            eixo={faixas.map((x) => x.rotulo)}
            series={[{ chave: "devido", rotulo: "Devido", valores: faixas.map((x) => x.valorCents) }]}
            rotulo="Devido por faixa de atraso"
            largura={520}
          />
          <p className="text-[11px] text-muted-foreground">Pelo título mais antigo em aberto (no acordo, a parcela). O que ainda não venceu fica fora.</p>
        </Secao>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Secao titulo="Evolução por categoria">
          <GraficoDeLinhas meses={porCategoria.meses} series={porCategoria.series} ultimoAoVivo rotulo="Saldo por categoria, mês a mês" largura={520} />
        </Secao>
        {!f.devedor && (
          <Secao titulo="Comparativo entre devedores">
            <BarrasHorizontais itens={comparativo} rotulo="Devido por devedor" />
          </Secao>
        )}
      </div>
    </div>
  );
}

function Cartao({ titulo, valor, nota }: { titulo: string; valor: string; nota: string }) {
  return (
    <Card>
      <CardContent className="py-3">
        <p className="text-xs text-muted-foreground">{titulo}</p>
        <p className="text-xl font-semibold tabular-nums">{valor}</p>
        <p className="text-[11px] text-muted-foreground">{nota}</p>
      </CardContent>
    </Card>
  );
}

function Contagem({ titulo, c }: { titulo: string; c: { quantidade: number; valorCents: number } }) {
  return (
    <Card>
      <CardContent className="py-3">
        <p className="text-xs text-muted-foreground">{titulo}</p>
        <p className="text-lg font-semibold tabular-nums">{formatBRL(c.valorCents)}</p>
        <p className="text-[11px] text-muted-foreground">{c.quantidade} dívida{c.quantidade === 1 ? "" : "s"}</p>
      </CardContent>
    </Card>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-2 py-3">
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {children}
      </CardContent>
    </Card>
  );
}
