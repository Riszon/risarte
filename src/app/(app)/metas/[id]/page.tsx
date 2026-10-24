import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Lock, Target, Trophy } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatBrDateTime, formatIsoDateBr, todayInBrazil } from "@/lib/dates";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { BarraDaMeta } from "@/components/metas/barra-da-meta";
import { GraficoDaMeta } from "@/components/metas/grafico-da-meta";
import { PodioDaMeta } from "@/components/metas/podio";
import { canViewMetas, podeEditarMeta } from "@/lib/metas/access";
import {
  lerAlvos,
  lerLeituraDoEquilibrio,
  lerMeta,
  lerParticipantes,
  lerPausas,
  medirMetas,
  nomesDasUnidades,
  type MedicaoLida,
} from "@/lib/metas/dados";
import { APPOINTMENT_TYPE_LABELS } from "@/lib/appointments";
import {
  ORIGENS_DA_VENDA,
  ORIGENS_DO_CLIENTE,
  ROTULO_DO_RECORTE,
  indicadorDe,
  rotuloDaDirecao,
  type Recorte,
} from "@/lib/metas/indicadores";
import {
  DESFECHO_LABEL,
  FAROL_LABEL,
  FAROL_LABEL_LIMITE,
  MODO_LABEL,
  SITUACAO_COR,
  SITUACAO_LABEL,
  formatarPct,
  formatarValor,
  fraseSmart,
  objetivoLabel,
  ondeDaMeta,
  percentualDaMedida,
  periodoCorrente,
  posicao,
  valorDe,
  type Meta,
} from "@/lib/metas/regras";
import { percentuaisDasPessoas, percentuaisDasUnidades, resumirMeta, serieDoGrafico } from "@/lib/metas/resumo";
import { AcoesDaMeta } from "./acoes";

export const metadata: Metadata = { title: "Meta — Metas" };

const TIPO_DA_MUDANCA: Record<string, string> = {
  publish: "Publicou",
  edit: "Alterou",
  pause: "Pausou",
  resume: "Retomou",
  cancel: "Cancelou",
};

function recorteEmTexto(meta: Meta, planos: Map<string, string>): string {
  const ind = indicadorDe(meta.indicator);
  const f = meta.filters as Record<string, unknown>;
  const nome = (r: Recorte, v: string): string => {
    if (r === "appointment_types") return APPOINTMENT_TYPE_LABELS[v as keyof typeof APPOINTMENT_TYPE_LABELS] ?? v;
    if (r === "client_origins") return ORIGENS_DO_CLIENTE.find((o) => o.value === v)?.label ?? v;
    if (r === "sale_origin") return ORIGENS_DA_VENDA.find((o) => o.value === v)?.label ?? v;
    if (r === "ppr_plans") return planos.get(v) ?? "plano";
    return v;
  };
  const partes: string[] = [];
  for (const r of ind?.recortes ?? []) {
    const v = f[r];
    const lista = Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? [v] : [];
    if (lista.length) partes.push(`${ROTULO_DO_RECORTE[r]}: ${lista.map((x) => nome(r, x)).join(", ")}`);
  }
  return partes.join(" · ");
}

export default async function MetaPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!canViewMetas(session)) redirect("/");
  const { id } = await params;
  const db = await createClient();
  const meta = await lerMeta(db, id);
  if (!meta) notFound();

  const hoje = todayInBrazil();
  const [medicoes, pausas, alvos, nomes, participantes, mudancas, marcos] = await Promise.all([
    meta.status === "draft" ? Promise.resolve(new Map<string, MedicaoLida>()) : medirMetas(db, [meta]),
    lerPausas(db, [id]),
    lerAlvos(db, [id]),
    nomesDasUnidades(db),
    lerParticipantes(db, id),
    db
      .from("goal_changes")
      .select("id, changed_at, kind, reason, autor:profiles!goal_changes_changed_by_fkey ( full_name )")
      .eq("goal_id", id)
      .order("changed_at", { ascending: false })
      .limit(200),
    db.from("goal_milestones").select("id, label, indicator, due_on, target_value").eq("goal_id", id).order("position").limit(100),
  ]);
  const [{ data: planosPpr }, equilibrio] = await Promise.all([
    db.from("ppr_plans").select("id, name").limit(100),
    // O1: as duas leituras (R$ e atendimentos) — só para quem vê o financeiro.
    meta.indicator === "breakeven_reached" && meta.status !== "draft"
      ? lerLeituraDoEquilibrio(db, id)
      : Promise.resolve(null),
  ]);
  const nomesDosPlanos = new Map((planosPpr ?? []).map((p) => [p.id as string, p.name as string]));
  const lida = medicoes.get(id);
  const minhasPausas = pausas.get(id) ?? [];
  const meusAlvos = alvos.get(id) ?? [];
  const resumo = resumirMeta(meta, lida?.medicao ?? null, minhasPausas, hoje, meusAlvos, lida?.erro ?? null);
  const ind = resumo.indicador;
  const unidade = ind?.unidade ?? "count";
  const s = resumo.situacao;
  const foto = resumo.foto;
  const podeEditar = podeEditarMeta(session, meta);
  const nomeDaPessoa = new Map(participantes.lista.map((p) => [p.user_id, p.full_name]));

  const frase = fraseSmart({
    indicador: ind,
    direction: meta.direction,
    target_mode: meta.target_mode,
    target_value: meta.target_value,
    individual_rule: meta.individual_rule,
    individual_value: meta.individual_value,
    periodicity: meta.periodicity,
    starts_on: meta.starts_on,
    ends_on: meta.ends_on,
    onde: meta.scope === "network" ? "na rede toda" : `em ${ondeDaMeta(meta, nomes)}`,
  });

  const serie = serieDoGrafico(meta, lida?.medicao?.live ?? null, periodoCorrente(meta, hoje), hoje, minhasPausas);
  // Ranking com números só quando o número É da pessoa na meta: alvo
  // individual, ou participantes escolhidos (a meta conta só o que eles
  // fizeram). Coletiva com "toda a equipe" lista os nomes — senão a recepção
  // aparece com "R$ 0,00" numa meta de vendas que é do consultor.
  const rankingFazSentido = meta.target_mode !== "collective" || Boolean(foto?.restricted);
  const pessoas =
    foto && participantes.lista.length > 0 && ind?.porPessoa && rankingFazSentido
      ? percentuaisDasPessoas(meta, foto, meusAlvos, participantes.lista.map((p) => p.user_id)).sort(
          (a, b) => (b.pct ?? -1) - (a.pct ?? -1)
        )
      : [];
  const unidadesDaMeta = foto && foto.n_clinics > 1 ? foto.by_clinic : [];
  // M4 (Q4): o campeonato — posição pelo % do alvo de cada unidade.
  const ranking = meta.show_ranking !== false;
  const linhasDasUnidades =
    foto && unidadesDaMeta.length > 0
      ? percentuaisDasUnidades(meta, foto, meusAlvos).map((x) => ({ u: x.medida, alvo: x.alvo, pct: x.pct }))
      : [];
  const listaDasUnidades = linhasDasUnidades.map((x) => ({ id: x.u.id, pct: x.pct }));
  const unidadesOrdenadas = linhasDasUnidades
    .map((x) => ({ ...x, lugar: posicao(listaDasUnidades, x.u.id, resumo.limite)?.lugar ?? null }))
    .sort((a, b) =>
      ranking
        ? (a.lugar ?? 9999) - (b.lugar ?? 9999)
        : (nomes.get(a.u.id) ?? "").localeCompare(nomes.get(b.u.id) ?? "", "pt-BR")
    );
  const listaDasPessoas = pessoas.map((p) => ({ id: p.id, pct: p.pct }));
  const lugarDaPessoa = (id: string) => posicao(listaDasPessoas, id, resumo.limite)?.lugar ?? null;
  const recompensas = [
    meta.reward_text ? { t: "Ao atingir a meta", c: meta.reward_text } : null,
    meta.stretch_reward_text ? { t: "Ao atingir a Super Meta", c: meta.stretch_reward_text } : null,
  ].filter((x): x is { t: string; c: string } => x !== null);
  const marcosLidos = lida?.medicao?.milestones ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <CabecalhoDeModulo
        chapeu={`Metas · ${meta.code}`}
        icone={Target}
        titulo={
          <span className="inline-flex flex-wrap items-center gap-2">
            {meta.name}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SITUACAO_COR[s]}`}>{SITUACAO_LABEL[s]}</span>
          </span>
        }
        descricao={frase}
        voltar={{ href: "/metas", rotulo: "Metas" }}
      >
        <AcoesDaMeta id={id} status={s} podeEditar={podeEditar} />
      </CabecalhoDeModulo>

      {(s === "paused" || s === "cancelled") && meta.status_reason && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <strong>{s === "paused" ? "Pausada" : "Cancelada"}:</strong> {meta.status_reason}
        </p>
      )}

      {recompensas.length > 0 && s !== "cancelled" && (
        <div className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-400/50 bg-amber-400/5 p-3 text-sm">
          <Trophy className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden />
          <div className="min-w-0 space-y-0.5">
            {recompensas.map((r) => (
              <p key={r.t}>
                <span className="text-muted-foreground">{r.t}:</span> <strong>{r.c}</strong>
              </p>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------ o realizado */}
      {s !== "draft" && s !== "scheduled" && s !== "cancelled" && (
        <section className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
          {resumo.erro ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">{resumo.erro} Recarregue a página em instantes.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{resumo.rotuloDoPeriodo}</p>
                  <p className="text-4xl font-semibold tabular-nums">{formatarPct(resumo.pct)}</p>
                  <p className="text-sm text-muted-foreground">
                    {resumo.escondido ? (
                      <span className="inline-flex items-center gap-1">
                        <Lock className="size-3.5" aria-hidden /> Os números do financeiro ficam com a gestão; você vê o percentual da meta.
                      </span>
                    ) : resumo.alvo != null && foto && meta.periodicity === "whole" ? (
                      <>
                        {formatarValor(unidade, resumo.valor)} de {formatarValor(unidade, resumo.alvo)}
                      </>
                    ) : resumo.alvo != null && foto && s !== "finished" ? (
                      <>
                        {formatarValor(unidade, resumo.valor)} de {formatarValor(unidade, resumo.alvo)} neste mês
                      </>
                    ) : resumo.pessoas ? (
                      "Média dos participantes (cada um conta até 100%)"
                    ) : null}
                  </p>
                </div>
                <div className="text-right text-sm">
                  {s === "active" && (
                    <p>
                      <span className="font-medium">
                        {(resumo.limite ? FAROL_LABEL_LIMITE : FAROL_LABEL)[resumo.farol]}
                      </span>
                      {resumo.projecao != null && (
                        <span className="block text-muted-foreground">
                          {resumo.limite
                            ? `No ritmo atual, chega a ${formatarPct(resumo.projecao)} do limite`
                            : `No ritmo atual, termina em ${formatarPct(resumo.projecao)}`}
                        </span>
                      )}
                    </p>
                  )}
                  {resumo.diasRestantes != null && (
                    <p className="text-muted-foreground">
                      {resumo.diasRestantes === 1 ? "Último dia" : `${resumo.diasRestantes} dias restantes`}
                    </p>
                  )}
                  {resumo.pessoas && (
                    <p className="text-muted-foreground">
                      {resumo.pessoas.atingiram} de {resumo.pessoas.total} participantes já atingiram
                    </p>
                  )}
                  {s === "finished" && meta.outcome && <p className="font-semibold">{DESFECHO_LABEL[meta.outcome]}</p>}
                  {s === "closing" && (
                    <p className="text-muted-foreground">O prazo terminou: o resultado é congelado na madrugada seguinte.</p>
                  )}
                </div>
              </div>
              <BarraDaMeta
                pct={resumo.pct}
                pctSuper={resumo.pctSuper}
                farol={resumo.farol}
                limite={resumo.limite}
                esperado={s === "active" && ind?.tipo === "sum" ? resumo.esperado : null}
              />
              {resumo.pctSuper != null && (
                <p className="text-xs text-muted-foreground">
                  Super Meta: {formatarValor(unidade, meta.stretch_value)} ({formatarPct(resumo.pctSuper)} da meta) — o traço dourado marca a meta.
                </p>
              )}
              {equilibrio && equilibrio.ponto != null && (
                <div className="grid gap-3 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Em R$</p>
                    <p>
                      Receita líquida de {formatarValor("brl", equilibrio.receita_liquida)} para um ponto de equilíbrio de{" "}
                      {formatarValor("brl", equilibrio.ponto)}.
                    </p>
                    <p className="font-medium">
                      {equilibrio.receita_liquida >= equilibrio.ponto
                        ? `Passou o ponto em ${formatarValor("brl", equilibrio.receita_liquida - equilibrio.ponto)}.`
                        : `Faltam ${formatarValor("brl", equilibrio.ponto - equilibrio.receita_liquida)} para empatar.`}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Em atendimentos</p>
                    {equilibrio.atendimentos_necessarios != null ? (
                      <>
                        <p>
                          {equilibrio.atendimentos} atendimentos concluídos de {equilibrio.atendimentos_necessarios} necessários
                          para pagar a estrutura, na margem média por atendimento do período.
                        </p>
                        <p className="font-medium">
                          {equilibrio.atendimentos >= equilibrio.atendimentos_necessarios
                            ? "A estrutura já está paga."
                            : `Faltam ${equilibrio.atendimentos_necessarios - equilibrio.atendimentos} atendimentos para empatar.`}
                        </p>
                      </>
                    ) : (
                      <p className="text-muted-foreground">Sem atendimentos concluídos no período para fazer a conta.</p>
                    )}
                  </div>
                </div>
              )}
              {serie.pontos.length > 1 && (
                <GraficoDaMeta
                  pontos={serie.pontos}
                  legendaRealizado={serie.legendaRealizado}
                  legendaEsperado={serie.legendaEsperado}
                />
              )}
            </>
          )}
        </section>
      )}

      {s === "scheduled" && (
        <p className="rounded-xl border bg-card p-4 text-sm">
          A meta começa em <strong>{formatIsoDateBr(meta.starts_on)}</strong>. A partir daí a barra é medida sozinha.
        </p>
      )}
      {s === "draft" && (
        <p className="rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground">
          Rascunho: só quem pode editar vê. Publique para a meta aparecer para os participantes.
        </p>
      )}

      {/* ------------------------------------------------ meses */}
      {resumo.meses.length > 0 && s !== "draft" && (
        <section className="space-y-2 rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="font-semibold">Mês a mês</h2>
          <ul className="grid gap-2 sm:grid-cols-3">
            {resumo.meses.map((m) => (
              <li key={m.from} className="rounded-lg border p-3 text-sm">
                <p className="text-xs text-muted-foreground">
                  {formatIsoDateBr(m.from)} a {formatIsoDateBr(m.to)}
                </p>
                <p className="font-medium">
                  {m.atingiu === null
                    ? m.from <= hoje && m.to >= hoje
                      ? "Em andamento"
                      : m.from > hoje
                        ? "Ainda não começou"
                        : "Apurando"
                    : m.atingiu
                      ? "Atingido"
                      : "Não atingido"}
                  {m.pct != null && <span className="text-muted-foreground"> · {formatarPct(m.pct)}</span>}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------ participantes */}
      {s !== "draft" && (
        <section className="space-y-3 rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Participantes ({participantes.lista.length})</h2>
            {foto?.restricted && (
              <p className="text-xs text-muted-foreground">A meta conta só o que os participantes fizeram ({ind?.quemConta}).</p>
            )}
          </div>
          {participantes.erro ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">{participantes.erro}</p>
          ) : pessoas.length > 0 ? (
            <ol className="space-y-2">
              {[...pessoas].sort((a, b) => (lugarDaPessoa(a.id) ?? 9999) - (lugarDaPessoa(b.id) ?? 9999)).map((p) => {
                const lugar = lugarDaPessoa(p.id);
                const papeis = participantes.lista.find((x) => x.user_id === p.id)?.roles ?? [];
                const temAlvo = meta.target_mode !== "collective";
                return (
                  <li key={p.id} className="grid items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[2rem_1fr_10rem_12rem]">
                    <span className="text-xs text-muted-foreground tabular-nums">{ranking && lugar != null ? `${lugar}º` : ""}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{nomeDaPessoa.get(p.id) ?? "—"}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {papeis.map((r) => ROLE_LABELS[r as UserRole] ?? r).join(", ")}
                      </span>
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {p.valor != null ? formatarValor(unidade, p.valor) : p.pct != null ? "" : "—"}
                      {temAlvo && p.alvo != null && !resumo.escondido ? ` de ${formatarValor(unidade, p.alvo)}` : ""}
                    </span>
                    {temAlvo ? (
                      <span className="flex items-center gap-2">
                        <BarraDaMeta pct={p.pct} tamanho="sm" farol={(p.pct ?? 0) >= 100 ? "verde" : "neutro"} />
                        <span className="w-12 text-right text-xs tabular-nums">{formatarPct(p.pct)}</span>
                      </span>
                    ) : (
                      <span />
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <ul className="flex flex-wrap gap-1.5 text-xs">
              {participantes.lista.map((p) => (
                <li key={p.user_id} className="rounded-full bg-muted px-2 py-0.5">
                  {p.full_name}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ------------------------------------------------ unidades (D2) */}
      {unidadesDaMeta.length > 0 && (
        <section className="space-y-3 rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="font-semibold">{ranking ? "Campeonato entre unidades" : "Por unidade"}</h2>
          {ranking && (
            <PodioDaMeta
              itens={unidadesOrdenadas
                .filter((x) => x.lugar != null)
                .map((x) => ({ id: x.u.id, nome: nomes.get(x.u.id) ?? "Unidade", pct: x.pct, lugar: x.lugar as number }))}
            />
          )}
          <ul className="space-y-2">
            {unidadesOrdenadas.map(({ u, alvo, pct, lugar }) => (
                <li key={u.id} className="grid items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[2rem_1fr_12rem_12rem]">
                  <span className="text-xs text-muted-foreground tabular-nums">{ranking && lugar != null ? `${lugar}º` : ""}</span>
                  <span className="truncate">{nomes.get(u.id) ?? "Unidade"}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {u.pct !== undefined ? "" : `${formatarValor(unidade, valorDe(u))} de ${formatarValor(unidade, alvo)}`}
                  </span>
                  <span className="flex items-center gap-2">
                    <BarraDaMeta
                      pct={pct}
                      tamanho="sm"
                      farol={resumo.limite ? ((pct ?? 0) > 100 ? "vermelho" : "verde") : (pct ?? 0) >= 100 ? "verde" : "neutro"}
                    />
                    <span className="w-12 text-right text-xs tabular-nums">{formatarPct(pct)}</span>
                  </span>
                </li>
              ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Unidade sem nenhum registro no período não aparece aqui.
            {ranking ? " A posição é pelo percentual do alvo de cada unidade." : ""}
            {resumo.limite ? " No limite, o percentual é o quanto dele cada unidade já usou — quem usou menos fica na frente." : ""}
          </p>
        </section>
      )}

      {/* ------------------------------------------------ marcos */}
      {(marcos.data ?? []).length > 0 && (
        <section className="space-y-3 rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="font-semibold">Marcos intermediários</h2>
          <ul className="space-y-2">
            {(marcos.data ?? []).map((m) => {
              const mi = indicadorDe(m.indicator as string);
              const lido = marcosLidos.find((x) => x.id === m.id)?.snapshot ?? null;
              const alvo = Number(m.target_value);
              const pct = lido ? percentualDaMedida(lido.total, "increase", alvo) : null;
              const venceu = (m.due_on as string) < hoje;
              return (
                <li key={m.id as string} className="grid items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[1fr_12rem]">
                  <span>
                    <span className="block font-medium">{m.label as string}</span>
                    <span className="block text-xs text-muted-foreground">
                      {mi?.rotulo} · até {formatIsoDateBr(m.due_on as string)} · alvo {formatarValor(mi?.unidade ?? "count", alvo)}
                      {lido && lido.total.pct === undefined && <> · realizado {formatarValor(mi?.unidade ?? "count", valorDe(lido.total))}</>}
                      {venceu && pct != null && (pct >= 100 ? " · atingido" : " · não atingido")}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <BarraDaMeta pct={pct} tamanho="sm" farol={(pct ?? 0) >= 100 ? "verde" : "neutro"} />
                    <span className="w-12 text-right text-xs tabular-nums">{formatarPct(pct)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------ o SMART */}
      <section className="grid gap-3 md:grid-cols-2">
        {[
          {
            l: "S",
            t: "Específica",
            c: (
              <>
                <p>
                  <span className="text-muted-foreground">Indicador:</span> {ind?.rotulo ?? meta.indicator}
                  {recorteEmTexto(meta, nomesDosPlanos) && <span className="text-muted-foreground"> · {recorteEmTexto(meta, nomesDosPlanos)}</span>}
                </p>
                <p>
                  <span className="text-muted-foreground">Onde:</span> {ondeDaMeta(meta, nomes)}
                </p>
                <p className="whitespace-pre-line">
                  <span className="text-muted-foreground">Como:</span> {meta.how_text ?? "—"}
                </p>
              </>
            ),
          },
          {
            l: "M",
            t: "Mensurável",
            c: (
              <>
                <p>{rotuloDaDirecao(ind, meta.direction)} · {MODO_LABEL[meta.target_mode]}</p>
                {meta.target_value != null && !resumo.escondido && (
                  <p>
                    <span className="text-muted-foreground">
                      {meta.target_mode === "individual" ? "Total a dividir" : "Alvo"}:
                    </span>{" "}
                    {formatarValor(unidade, meta.target_value)}
                    {meta.periodicity === "monthly" ? " por mês" : ""}
                  </p>
                )}
                {meta.individual_value != null && !resumo.escondido && (
                  <p>
                    <span className="text-muted-foreground">Cada participante:</span> {formatarValor(unidade, meta.individual_value)}
                  </p>
                )}
                {meta.stretch_value != null && !resumo.escondido && (
                  <p>
                    <span className="text-muted-foreground">Super Meta:</span> {formatarValor(unidade, meta.stretch_value)}
                  </p>
                )}
                {meta.baseline_value != null && !resumo.escondido && (
                  <p className="text-xs text-muted-foreground">
                    Linha de base: {formatarValor(unidade, meta.baseline_value)}
                    {meta.baseline_from && meta.baseline_to
                      ? ` (histórico de ${formatIsoDateBr(meta.baseline_from)} a ${formatIsoDateBr(meta.baseline_to)})`
                      : ""}
                  </p>
                )}
              </>
            ),
          },
          {
            l: "A",
            t: "Atingível",
            c: (
              <>
                <p className="whitespace-pre-line">
                  <span className="text-muted-foreground">Recursos:</span> {meta.resources_text ?? "—"}
                </p>
                {meta.attainable_note && (
                  <p className="whitespace-pre-line">
                    <span className="text-muted-foreground">Por que é possível:</span> {meta.attainable_note}
                  </p>
                )}
              </>
            ),
          },
          {
            l: "R",
            t: "Relevante",
            c: (
              <>
                <p>
                  <span className="text-muted-foreground">Objetivo:</span> {objetivoLabel(meta.strategic_objective)}
                </p>
                <p className="whitespace-pre-line">
                  <span className="text-muted-foreground">Por que agora:</span> {meta.relevance_text ?? "—"}
                </p>
                {recompensas.map((r) => (
                  <p key={r.t}>
                    <span className="text-muted-foreground">Reconhecimento {r.t.toLowerCase()}:</span> {r.c}
                  </p>
                ))}
              </>
            ),
          },
          {
            l: "T",
            t: "Temporal",
            c: (
              <p>
                {formatIsoDateBr(meta.starts_on)} a {formatIsoDateBr(meta.ends_on)} ·{" "}
                {meta.periodicity === "monthly" ? "alvo para cada mês" : "alvo para o período inteiro"}
                {minhasPausas.length > 0 && (
                  <span className="block text-xs text-muted-foreground">
                    Pausas: {minhasPausas.map((p) => `${formatIsoDateBr(p.de)} a ${p.ate ? formatIsoDateBr(p.ate) : "hoje"}`).join("; ")}
                  </span>
                )}
              </p>
            ),
          },
        ].map((b) => (
          <div key={b.l} className="flex gap-3 rounded-xl border bg-card p-4 text-sm shadow-sm">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
              {b.l}
            </span>
            <div className="min-w-0 space-y-1">
              <p className="font-semibold">{b.t}</p>
              {b.c}
            </div>
          </div>
        ))}
      </section>

      {/* ------------------------------------------------ histórico */}
      {(mudancas.data ?? []).length > 0 && (
        <section className="space-y-2 rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="font-semibold">Histórico</h2>
          <ul className="space-y-1.5 text-sm">
            {(mudancas.data ?? []).map((c) => {
              const autor = (c.autor as { full_name?: string } | null)?.full_name ?? "—";
              return (
                <li key={c.id as string} className="flex flex-wrap gap-x-2">
                  <span className="text-xs tabular-nums text-muted-foreground">{formatBrDateTime(c.changed_at as string)}</span>
                  <span>
                    <strong>{autor}</strong> {(TIPO_DA_MUDANCA[c.kind as string] ?? c.kind)?.toString().toLowerCase()} a meta
                  </span>
                  {c.reason && <span className="text-muted-foreground">— {c.reason as string}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
