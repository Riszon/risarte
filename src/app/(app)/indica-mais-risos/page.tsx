import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Plus } from "lucide-react";
import { indicaDb } from "@/lib/indica/db";
import { mensagemDoBanco } from "@/lib/indica/erros";
import { perdaEntre, retornoPct, variacao, type Indicadores } from "@/lib/indica/painel";
import { proximaFaixa, faixaAtingida, type Faixa } from "@/lib/indica/metas";
import { INDICACAO_STATUS_LABEL, type IndicacaoStatus } from "@/lib/indica/status";
import { addDaysIso, formatIsoDateBr, formatIsoMonthBr } from "@/lib/dates";
import { formatBRL } from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FiltrosRecorte } from "./filtros-recorte";
import { lerRecorte } from "./recorte";

export const metadata: Metadata = { title: "Painel — Indica +Risos" };

type Painel = {
  atual: Indicadores;
  anterior: Indicadores;
  anterior_de: string;
  evolucao: { mes: string; conversoes: number; receita_centavos: number; registradas: number }[];
  top_embaixadores: { id: string; codigo: string; nome: string; indicacoes: number; conversoes: number }[];
  top_risartanos: { id: string; nome: string; indicacoes: number; conversoes: number }[];
  acoes: {
    parada_dias: number;
    paradas: { id: string; codigo: string; status: string; indicado: string; dias: number }[];
    paradas_total: number;
    faltaram: number;
    resgates_aguardando: number;
    embaixadores_a_vencer: number;
    alertas_abertos: number;
  };
};

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${String(n).replace(".", ",")}%`);
const reais = (c: number | null | undefined) => (c === null || c === undefined ? "—" : formatBRL(c));

function Variacao({ atual, anterior, menorEhMelhor }: { atual: number | null; anterior: number | null; menorEhMelhor?: boolean }) {
  const v = variacao(atual, anterior, menorEhMelhor);
  if (v.percentual === null) return <span className="text-xs text-muted-foreground">sem base anterior</span>;
  const Icone = v.percentual >= 0 ? ArrowUpRight : ArrowDownRight;
  const cor = v.melhorou === null ? "text-muted-foreground" : v.melhorou ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400";
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${cor}`}>
      <Icone className="size-3" />
      {String(Math.abs(v.percentual)).replace(".", ",")}% vs período anterior
    </span>
  );
}

function Cartao({ titulo, valor, detalhe, children }: { titulo: string; valor: string; detalhe?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{valor}</p>
      {detalhe && <p className="text-xs text-muted-foreground">{detalhe}</p>}
      <div className="mt-1">{children}</div>
    </div>
  );
}

export default async function PainelPage({ searchParams }: PageProps<"/indica-mais-risos">) {
  const r = await lerRecorte(await searchParams);
  if (r.semAcesso) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Painel do programa</h1>
        <p className="mt-2 text-sm text-muted-foreground">Você não está em nenhuma unidade. Escolha uma unidade no topo.</p>
      </div>
    );
  }
  const db = await indicaDb();
  const [{ data, error }, { data: campanhas }, { data: metas }] = await Promise.all([
    db.rpc("painel", { p_de: r.de, p_ate: r.ate, p_unidade: r.unidadeId, p_campanha: r.campanhaId }),
    db.from("campanhas").select("id, nome").neq("status", "rascunho").order("inicio", { ascending: false })
      .returns<{ id: string; nome: string }[]>(),
    r.unidadeId
      ? db.from("metas_equipe").select("id, periodo_inicio, periodo_fim, faixas").eq("unidade_id", r.unidadeId).eq("status", "ativa")
          .order("periodo_inicio", { ascending: false }).limit(3)
          .returns<{ id: string; periodo_inicio: string; periodo_fim: string; faixas: Faixa[] }[]>()
      : Promise.resolve({ data: [] as { id: string; periodo_inicio: string; periodo_fim: string; faixas: Faixa[] }[] }),
  ]);
  const p = data as Painel | null;
  const ids = (metas ?? []).map((m) => m.id);
  const { data: apur } = ids.length
    ? await db.from("apuracoes").select("meta_id, valor_apurado, criado_em").in("meta_id", ids).order("criado_em", { ascending: false })
        .returns<{ meta_id: string; valor_apurado: number; criado_em: string }[]>()
    : { data: [] as { meta_id: string; valor_apurado: number; criado_em: string }[] };

  const a = p?.atual;
  const b = p?.anterior;
  const maxConv = Math.max(1, ...(p?.evolucao ?? []).map((m) => m.conversoes));

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Painel do programa</h1>
          <p className="text-sm text-muted-foreground">
            {r.unidadeNome} · {formatIsoDateBr(r.de)} a {formatIsoDateBr(r.ate)}
            {p ? ` · comparado com ${formatIsoDateBr(p.anterior_de)} a ${formatIsoDateBr(addDaysIso(r.de, -1))}` : ""}
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/indica-mais-risos/indicacoes" />}>
          <Plus className="mr-1 size-4" /> Nova indicação
        </Button>
      </div>

      <FiltrosRecorte r={r} campanhas={campanhas ?? []} />

      {error || !a || !b || !p ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error ? mensagemDoBanco(error) : "Não foi possível montar o painel."}
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Cartao titulo="Indicações registradas" valor={String(a.registradas)}>
              <Variacao atual={a.registradas} anterior={b.registradas} />
            </Cartao>
            <Cartao titulo="Taxa de comparecimento" valor={pct(a.taxa_comparecimento)} detalhe={`${a.compareceram} das registradas no período`}>
              <Variacao atual={a.taxa_comparecimento} anterior={b.taxa_comparecimento} />
            </Cartao>
            <Cartao titulo="Taxa de fechamento" valor={pct(a.taxa_fechamento)} detalhe={`${a.fecharam} de ${a.compareceram} que compareceram`}>
              <Variacao atual={a.taxa_fechamento} anterior={b.taxa_fechamento} />
            </Cartao>
            <Cartao titulo="Conversões" valor={String(a.conversoes)} detalhe="fechamentos do período que passaram da carência">
              <Variacao atual={a.conversoes} anterior={b.conversoes} />
            </Cartao>
            <Cartao titulo="Receita dos indicados" valor={reais(a.receita_centavos)} detalhe="vendas fechadas no período (não canceladas)">
              <Variacao atual={a.receita_centavos} anterior={b.receita_centavos} />
            </Cartao>
            <Cartao titulo="Clientes novos vindos de indicação" valor={pct(a.percentual_novos_indicacao)} detalhe={`${a.clientes_novos_indicacao} de ${a.clientes_novos} cadastros novos`}>
              <Variacao atual={a.percentual_novos_indicacao} anterior={b.percentual_novos_indicacao} />
            </Cartao>
            <Cartao
              titulo="Custo do programa"
              valor={reais(a.custo_gerado_centavos)}
              detalhe={`gerado · realizado ${reais(a.custo_realizado_centavos)} · ${a.riso_coins_gerados} Riso Coins`}
            >
              <Variacao atual={a.custo_gerado_centavos} anterior={b.custo_gerado_centavos} menorEhMelhor />
            </Cartao>
            <Cartao
              titulo="Custo por cliente indicado (CAC)"
              valor={reais(a.cac_gerado_centavos)}
              detalhe={`gerado · realizado ${reais(a.cac_realizado_centavos)} · retorno ${retornoPct(a.roi_gerado)}`}
            >
              <Variacao atual={a.cac_gerado_centavos} anterior={b.cac_gerado_centavos} menorEhMelhor />
            </Cartao>
          </div>
          <p className="text-xs text-muted-foreground">
            Custo <strong>gerado</strong> = Riso Coins que o programa deu (menos estornos) pelo valor do Riso Coin, mais prêmios da
            equipe aprovados. Custo <strong>realizado</strong> = resgates entregues mais prêmios aprovados. Retorno = (receita −
            custo) ÷ custo, sobre a RECEITA (não sobre a margem).
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Funil das indicações registradas no período</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {[
                  { rotulo: "Registradas", n: a.registradas, de: null as number | null },
                  { rotulo: "Compareceram", n: a.compareceram, de: a.registradas },
                  { rotulo: "Fecharam", n: a.fecharam, de: a.compareceram },
                  { rotulo: "Convertidas", n: a.convertidas_coorte, de: a.fecharam },
                ].map((e) => (
                  <div key={e.rotulo}>
                    <div className="flex justify-between text-xs">
                      <span>{e.rotulo}</span>
                      <span>
                        <strong>{e.n}</strong>
                        {e.de !== null && perdaEntre(e.de, e.n) !== null ? ` · perda ${pct(perdaEntre(e.de, e.n))}` : ""}
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${a.registradas ? (100 * e.n) / a.registradas : 0}%` }} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Evolução mensal (conversões e receita)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex h-36 items-end gap-1">
                  {p.evolucao.map((m) => (
                    <div key={m.mes} className="flex h-full flex-1 flex-col justify-end" title={`${formatIsoMonthBr(`${m.mes}-01`)}: ${m.conversoes} conversões, ${formatBRL(m.receita_centavos)}`}>
                      <span className="text-center text-[10px] text-muted-foreground">{m.conversoes || ""}</span>
                      <div className="rounded-t bg-primary/80" style={{ height: `${(100 * m.conversoes) / maxConv}%`, minHeight: m.conversoes ? 2 : 0 }} />
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex gap-1">
                  {p.evolucao.map((m) => (
                    <span key={m.mes} className="flex-1 text-center text-[10px] text-muted-foreground">{m.mes.slice(5)}</span>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Receita dos indicados nos 12 meses: {formatBRL(p.evolucao.reduce((s, m) => s + m.receita_centavos, 0))}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Ações do dia</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  <strong>{p.acoes.paradas_total}</strong> indicação(ões) sem movimento há mais de {p.acoes.parada_dias} dias
                </p>
                <ul className="space-y-1">
                  {p.acoes.paradas.map((x) => (
                    <li key={x.id} className="text-xs">
                      <Link href={`/indica-mais-risos/indicacoes/${x.id}`} className="font-medium text-primary hover:underline">{x.codigo}</Link>{" "}
                      {x.indicado} · {INDICACAO_STATUS_LABEL[x.status as IndicacaoStatus] ?? x.status} · {x.dias} dias
                    </li>
                  ))}
                </ul>
                <p><strong>{p.acoes.faltaram}</strong> indicado(s) que faltaram — remarcar</p>
                <p>
                  <Link href="/indica-mais-risos/resgates" className="hover:underline"><strong>{p.acoes.resgates_aguardando}</strong> resgate(s) aguardando</Link>
                </p>
                <p>
                  <Link href="/indica-mais-risos/embaixadores" className="hover:underline"><strong>{p.acoes.embaixadores_a_vencer}</strong> Embaixador(es) com pontos a vencer em 30 dias</Link>
                </p>
                {p.acoes.alertas_abertos > 0 && (
                  <p className="text-amber-700 dark:text-amber-300">
                    <Link href="/indica-mais-risos/auditoria" className="hover:underline"><strong>{p.acoes.alertas_abertos}</strong> alerta(s) de fraude em aberto</Link>
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Destaques do período</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Embaixadores</p>
                  {p.top_embaixadores.length === 0 ? <p className="text-xs text-muted-foreground">—</p> : (
                    <ol className="list-decimal pl-5">
                      {p.top_embaixadores.map((e) => (
                        <li key={e.id}>
                          <Link href={`/indica-mais-risos/embaixadores/${e.id}`} className="hover:underline">{e.nome}</Link>{" "}
                          <span className="text-xs text-muted-foreground">{e.conversoes} conv. · {e.indicacoes} ind.</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Risartanos</p>
                  {p.top_risartanos.length === 0 ? <p className="text-xs text-muted-foreground">—</p> : (
                    <ol className="list-decimal pl-5">
                      {p.top_risartanos.map((x) => (
                        <li key={x.id}>{x.nome || "—"} <span className="text-xs text-muted-foreground">{x.conversoes} conv. · {x.indicacoes} ind.</span></li>
                      ))}
                    </ol>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Metas da equipe</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {!r.unidadeId ? (
                  <p className="text-xs text-muted-foreground">Escolha uma unidade para ver as metas.</p>
                ) : (metas ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhuma meta ativa. <Link href="/indica-mais-risos/equipe" className="text-primary hover:underline">Criar em Equipe</Link>
                  </p>
                ) : (
                  (metas ?? []).map((m) => {
                    const ult = (apur ?? []).find((x) => x.meta_id === m.id);
                    const valor = Number(ult?.valor_apurado ?? 0);
                    const topo = Math.max(1, ...m.faixas.map((f) => f.gatilho));
                    const prox = proximaFaixa(m.faixas, valor);
                    const atingida = faixaAtingida(m.faixas, valor);
                    return (
                      <div key={m.id}>
                        <p className="text-xs text-muted-foreground">
                          {formatIsoDateBr(m.periodo_inicio)} a {formatIsoDateBr(m.periodo_fim)} · {ult ? `apurado ${valor}` : "ainda sem apuração"}
                        </p>
                        <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-muted">
                          <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, (100 * valor) / topo)}%` }} />
                        </div>
                        <p className="mt-1 text-xs">
                          {atingida ? `Faixa ${atingida.nome}` : "Nenhuma faixa ainda"}
                          {prox ? ` · faltam ${prox.falta} para ${prox.faixa.nome}` : ""}
                        </p>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
