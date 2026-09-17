import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { getSessionContext, pode } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatBrDate, todayInBrazil } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { FilterForm } from "@/components/filter-form";
import {
  MODULO_ROTULO,
  TIPO_ROTULO,
  faixaDeIdade,
  rotuloDeDuracao,
} from "@/lib/system-reports";
import {
  PERIODOS,
  lerPeriodo,
  maiorDe,
  podeVerPainelDeRelatos,
  rotuloDeHoras,
  rotuloDoPonto,
  taxa,
  type PainelDeRelatos,
} from "@/lib/painel-de-relatos";
import { instanteDoPedido } from "../dados";
import { CorDaIdade, SeloDeSituacao } from "../selos";

export const metadata: Metadata = { title: "Painel de relatos" };

/**
 * O PAINEL DE RELATOS (0258) — pedido do dono, 16/09/2026.
 *
 * A conta inteira mora no banco (`system_reports_dashboard`), e é ele que
 * decide o escopo de quem pediu: rede (Admin e Franqueadora, com ranking de
 * pessoas) ou as próprias unidades (Gerente e Franqueado, sem ranking de
 * pessoas). A tela só desenha — somar aqui seria somar só o que a RLS deixa
 * cada um ler, e a Franqueadora veria meia rede chamada de rede.
 *
 * Sem biblioteca de gráfico, como o resto do sistema: barras são divs com
 * largura proporcional, sempre com o número escrito do lado.
 */
export default async function PainelDeRelatosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionContext();
  if (!pode(session, "menu.sistema") || !podeVerPainelDeRelatos(session)) {
    redirect("/problemas");
  }

  const params = await searchParams;
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const hoje = todayInBrazil();
  const periodo = lerPeriodo(
    { periodo: um(params.periodo), de: um(params.de), ate: um(params.ate) },
    hoje
  );
  const unidadePedida = um(params.unidade);
  const unidade =
    unidadePedida && /^[0-9a-f-]{36}$/i.test(unidadePedida) ? unidadePedida : null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("system_reports_dashboard", {
    p_de: periodo.de,
    p_ate: periodo.ate,
    p_clinic_id: unidade,
  });

  if (error) {
    if (error.message.includes("NOT_ALLOWED")) redirect("/problemas");
    const faltaMigracao =
      error.code === "PGRST202" || error.message.includes("Could not find the function");
    if (!faltaMigracao) throw new Error(error.message);
    return (
      <Casca>
        <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <p>
            O painel ainda não foi ligado neste banco. Falta aplicar a{" "}
            <strong>migração 0258</strong>.
          </p>
        </div>
      </Casca>
    );
  }

  const d = data as PainelDeRelatos;
  const agora = instanteDoPedido();
  const t = d.totais;
  const nomeDaUnidade = d.escopo.unidades.find((u) => u.id === unidade)?.nome;
  const escopo = nomeDaUnidade
    ? nomeDaUnidade
    : d.escopo.rede
      ? "a rede inteira"
      : d.escopo.unidades.map((u) => u.nome).join(", ");

  const linkDoPeriodo = (valor: string) => {
    const q = new URLSearchParams({ periodo: valor });
    if (unidade) q.set("unidade", unidade);
    return `/problemas/painel?${q.toString()}`;
  };

  return (
    <Casca>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Painel de relatos</h1>
        <p className="text-sm text-muted-foreground">
          Como a equipe está ajudando a melhorar o sistema — {escopo}, de{" "}
          <strong className="font-medium text-foreground">
            {formatBrDate(`${periodo.de}T12:00:00-03:00`)}
          </strong>{" "}
          a{" "}
          <strong className="font-medium text-foreground">
            {formatBrDate(`${periodo.ate}T12:00:00-03:00`)}
          </strong>
          .
        </p>
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
        <nav className="flex flex-wrap gap-1 text-sm" aria-label="Período">
          {PERIODOS.map((p) => (
            <Link
              key={p.value}
              href={linkDoPeriodo(p.value)}
              aria-current={periodo.pronto === p.value ? "page" : undefined}
              className={cn(
                "rounded-md border px-3 py-1.5",
                periodo.pronto === p.value
                  ? "border-primary bg-primary font-medium text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground"
              )}
            >
              {p.label}
            </Link>
          ))}
        </nav>
        <FilterForm className="flex flex-wrap items-end gap-3 text-sm">
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">De</span>
            <input
              type="date"
              name="de"
              defaultValue={periodo.de}
              max={hoje}
              className="h-9 rounded-md border bg-background px-2"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">Até</span>
            <input
              type="date"
              name="ate"
              defaultValue={periodo.ate}
              max={hoje}
              className="h-9 rounded-md border bg-background px-2"
            />
          </label>
          {d.escopo.unidades.length > 1 && (
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">Unidade</span>
              <select
                name="unidade"
                defaultValue={unidade ?? ""}
                className="h-9 rounded-md border bg-background px-2"
              >
                <option value="">
                  {d.escopo.rede ? "Toda a rede" : "Todas as minhas"}
                </option>
                {d.escopo.unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </select>
            </label>
          )}
        </FilterForm>
      </div>

      {t.relatos === 0 ? (
        <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          Nenhum relato registrado neste período{nomeDaUnidade ? " nesta unidade" : ""}.
          Experimente um período maior.
        </p>
      ) : (
        <>
          {/* Números de destaque */}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Numero
              rotulo="Relatados"
              valor={String(t.relatos)}
              detalhe={`${t.erros} ${t.erros === 1 ? "problema" : "problemas"} · ${t.duvidas} ${t.duvidas === 1 ? "dúvida" : "dúvidas"} · ${t.sugestoes} ${t.sugestoes === 1 ? "sugestão" : "sugestões"}`}
            />
            <Proporcao
              rotulo="Problemas solucionados"
              parte={t.erros_resolvidos}
              total={t.erros}
              detalhe={
                t.erros_nao_defeito > 0
                  ? `+ ${t.erros_nao_defeito} que não eram defeito`
                  : undefined
              }
            />
            <Proporcao
              rotulo="Sugestões implantadas"
              parte={t.sugestoes_implantadas}
              total={t.sugestoes}
              detalhe={
                t.sugestoes_recusadas > 0
                  ? `${t.sugestoes_recusadas} não ${t.sugestoes_recusadas === 1 ? "seguiu" : "seguiram"} adiante`
                  : undefined
              }
            />
            <Numero
              rotulo="Respostas enviadas"
              valor={String(d.respostas_enviadas)}
              detalhe={
                t.duvidas > 0
                  ? `${t.duvidas_respondidas} de ${t.duvidas} ${t.duvidas === 1 ? "dúvida respondida" : "dúvidas respondidas"}`
                  : "mensagens do suporte no período"
              }
            />
            <Numero
              rotulo="Tempo até a 1ª resposta"
              valor={rotuloDeHoras(d.tempos.resposta_mediana_h) ?? "sem dado"}
              detalhe={
                d.tempos.respondidos > 0
                  ? `metade responde em até isso · média ${rotuloDeHoras(d.tempos.resposta_media_h)} · ${d.tempos.respondidos} ${d.tempos.respondidos === 1 ? "respondido" : "respondidos"}`
                  : "nenhum relato respondido ainda"
              }
            />
            <Numero
              rotulo="Tempo até concluir"
              valor={rotuloDeHoras(d.tempos.conclusao_mediana_h) ?? "sem dado"}
              detalhe={
                d.tempos.concluidos > 0
                  ? `metade conclui em até isso · média ${rotuloDeHoras(d.tempos.conclusao_media_h)} · ${d.tempos.concluidos} ${d.tempos.concluidos === 1 ? "concluído" : "concluídos"}`
                  : "nenhum relato concluído ainda"
              }
            />
            <Numero
              rotulo="Ainda em aberto"
              valor={String(t.em_aberto)}
              alerta={t.sem_resposta > 0}
              detalhe={
                t.sem_resposta > 0
                  ? `${t.sem_resposta} ainda sem nenhuma resposta`
                  : "todos já receberam resposta"
              }
            />
            <Numero
              rotulo="Reabertos"
              valor={String(t.reabertos)}
              detalhe="a solução não funcionou na primeira vez"
            />
          </section>

          {/* Série */}
          <Secao
            titulo={`Relatados × concluídos, por ${d.escopo.grao === "week" ? "semana" : "mês"}`}
            legenda={
              <span className="flex gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-sky-600" /> relatados
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-emerald-500" /> concluídos
                </span>
              </span>
            }
          >
            <Serie serie={d.serie} grao={d.escopo.grao} />
          </Secao>

          {/* Por parte do sistema */}
          <Secao titulo="Por parte do sistema">
            <PorModulo linhas={d.por_modulo} />
          </Secao>

          <div className="grid gap-5 lg:grid-cols-2">
            <Secao titulo="Unidades que mais contribuem">
              <RankingDeUnidades linhas={d.por_unidade} />
            </Secao>
            <Secao titulo="Pessoas mais colaborativas">
              {d.por_pessoa ? (
                <RankingDePessoas linhas={d.por_pessoa} />
              ) : (
                <p className="p-4 text-sm text-muted-foreground">
                  O ranking de pessoas fica com a Franqueadora.
                </p>
              )}
            </Secao>
          </div>
        </>
      )}

      {/* Parados — o que está aberto agora, de qualquer data */}
      <Secao titulo="Esperando há mais tempo (abertos agora, de qualquer data)">
        {d.parados.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Nenhum relato em aberto.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-3 py-2 font-medium">Código</th>
                  <th className="px-3 py-2 font-medium">Tipo · parte</th>
                  <th className="px-3 py-2 font-medium">Unidade</th>
                  <th className="px-3 py-2 font-medium">Situação</th>
                  <th className="px-3 py-2 text-right font-medium">Aberto há</th>
                </tr>
              </thead>
              <tbody>
                {d.parados.map((p) => {
                  const idade = agora - Date.parse(p.criado_em);
                  return (
                    <tr key={p.code} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">
                        <Link href={`/problemas/${p.code}`} className="hover:underline">
                          {p.code}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        {TIPO_ROTULO[p.kind]} ·{" "}
                        {p.modulo === "sem" ? "sem parte" : MODULO_ROTULO[p.modulo]}
                      </td>
                      <td className="px-3 py-2">{p.unidade}</td>
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap items-center gap-1">
                          <SeloDeSituacao situacao={p.status} />
                          {p.sem_resposta && (
                            <span className="rounded-full border border-primary/30 px-2 py-0.5 text-[11px]">
                              sem resposta
                            </span>
                          )}
                          {p.reopened_count > 0 && (
                            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
                              reaberto
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
                        <CorDaIdade faixa={faixaDeIdade(idade)}>{rotuloDeDuracao(idade)}</CorDaIdade>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Secao>

      <details className="rounded-lg border p-4 text-sm">
        <summary className="cursor-pointer font-medium">Como ler este painel</summary>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
          <li>
            O período olha a <strong>data em que o relato foi registrado</strong>.
            &quot;Solucionados&quot; e &quot;implantadas&quot; são, desses, quantos já estão
            resolvidos hoje.
          </li>
          <li>
            <strong>Respostas enviadas</strong> conta as mensagens do suporte escritas no
            período, de qualquer relato.
          </li>
          <li>
            Os tempos mostram a <strong>mediana</strong> — metade dos relatos foi respondida
            (ou concluída) em até esse tempo — e a média ao lado. A mediana não se deixa
            puxar por um caso que ficou esquecido. Relato ainda sem resposta não entra na
            conta: contá-lo como zero o faria parecer o mais rápido de todos.
            {d.tempos.concluidos_sem_data > 0 &&
              ` ${d.tempos.concluidos_sem_data} ${d.tempos.concluidos_sem_data === 1 ? "relato encerrado antes do relógio existir ficou" : "relatos encerrados antes do relógio existir ficaram"} de fora do tempo até concluir.`}
          </li>
          <li>
            <strong>Aproveitado</strong> = resolvido: problema corrigido, sugestão
            implantada ou dúvida esclarecida. &quot;Não é defeito&quot; conta como
            participação, não como aproveitado.
          </li>
          <li>
            Os rankings deixam de fora os relatos do próprio Admin Master, que é quem
            corrige. Eles contam quantidade — uma unidade maior tende a relatar mais; a
            coluna de pessoas ajuda a comparar.
          </li>
          <li>
            A lista &quot;Esperando há mais tempo&quot; é o que está aberto <strong>agora</strong>,
            de qualquer data, e não mostra o título (ele pode citar paciente).
          </li>
        </ul>
      </details>
    </Casca>
  );
}

function Casca({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6">
      <Link
        href="/problemas"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Problemas
      </Link>
      {children}
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  detalhe,
  alerta,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  alerta?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border bg-card p-4", alerta && "border-amber-400/60")}>
      <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
        {rotulo}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-muted-foreground">{detalhe}</p>}
    </div>
  );
}

function Proporcao({
  rotulo,
  parte,
  total,
  detalhe,
}: {
  rotulo: string;
  parte: number;
  total: number;
  detalhe?: string;
}) {
  const pct = taxa(parte, total);
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
        {rotulo}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {total === 0 ? (
          <span className="text-base font-normal text-muted-foreground">nenhum no período</span>
        ) : (
          <>
            {parte} <span className="text-base font-normal text-muted-foreground">de {total}</span>
          </>
        )}
      </p>
      {pct !== null && (
        <div className="mt-2 flex items-center gap-2">
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
          </span>
          <span className="text-xs font-medium tabular-nums">{pct}%</span>
        </div>
      )}
      {detalhe && <p className="mt-1 text-xs text-muted-foreground">{detalhe}</p>}
    </div>
  );
}

function Secao({
  titulo,
  legenda,
  children,
}: {
  titulo: string;
  legenda?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {legenda}
      </div>
      {children}
    </section>
  );
}

function Serie({
  serie,
  grao,
}: {
  serie: PainelDeRelatos["serie"];
  grao: "week" | "month";
}) {
  const maior = maiorDe(serie.flatMap((s) => [s.relatados, s.concluidos]));
  return (
    <div className="overflow-x-auto p-4">
      <div className="flex min-w-max items-end gap-3" style={{ height: 160 }}>
        {serie.map((s) => (
          <div key={s.inicio} className="flex h-full w-12 flex-col items-center justify-end gap-1">
            <div className="flex h-full w-full items-end justify-center gap-1">
              {[
                // Cores FIXAS, não os tokens do tema: no tema da Franqueadora o
                // dourado vira marinho, e as duas barras ficavam iguais.
                { n: s.relatados, cor: "bg-sky-600", rotulo: "relatados" },
                { n: s.concluidos, cor: "bg-emerald-500", rotulo: "concluídos" },
              ].map((b) => (
                <div
                  key={b.rotulo}
                  className="flex h-full w-4 flex-col items-center justify-end"
                  title={`${b.n} ${b.rotulo}`}
                >
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {b.n > 0 ? b.n : ""}
                  </span>
                  <span
                    className={cn("w-full rounded-t-sm", b.cor)}
                    style={{ height: `${(b.n / maior) * 100}%`, minHeight: b.n > 0 ? 2 : 0 }}
                  />
                </div>
              ))}
            </div>
            <span className="border-t pt-1 text-[10px] whitespace-nowrap text-muted-foreground">
              {rotuloDoPonto(s.inicio, grao)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PorModulo({ linhas }: { linhas: PainelDeRelatos["por_modulo"] }) {
  const maior = maiorDe(linhas.map((l) => l.relatos));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="px-3 py-2 font-medium">Parte do sistema</th>
            <th className="px-3 py-2 font-medium">Relatos</th>
            <th className="px-3 py-2 text-right font-medium">Problemas solucionados</th>
            <th className="px-3 py-2 text-right font-medium">Sugestões implantadas</th>
            <th className="px-3 py-2 text-right font-medium">Dúvidas</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.modulo} className="border-b last:border-0">
              <td className="px-3 py-2 whitespace-nowrap">
                {l.modulo === "sem" ? (
                  <span className="text-muted-foreground">Sem parte informada</span>
                ) : (
                  MODULO_ROTULO[l.modulo]
                )}
              </td>
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary/70"
                      style={{ width: `${(l.relatos / maior) * 100}%` }}
                    />
                  </span>
                  <span className="tabular-nums">{l.relatos}</span>
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                <DeCom parte={l.erros_resolvidos} total={l.erros} />
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                <DeCom parte={l.implantadas} total={l.sugestoes} />
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {l.duvidas || <span className="text-muted-foreground">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "2 de 3 (67%)" — ou um traço quando não houve nenhum. */
function DeCom({ parte, total }: { parte: number; total: number }) {
  if (total === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      {parte} de {total}{" "}
      <span className="text-xs text-muted-foreground">({taxa(parte, total)}%)</span>
    </>
  );
}

function Posicao({ n }: { n: number }) {
  return (
    <span
      className={cn(
        "grid size-6 place-items-center rounded-full text-xs font-semibold tabular-nums",
        n === 1 ? "bg-gold text-gold-foreground" : "bg-muted text-muted-foreground"
      )}
    >
      {n}º
    </span>
  );
}

function RankingDeUnidades({ linhas }: { linhas: PainelDeRelatos["por_unidade"] }) {
  if (linhas.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">Nenhum relato das unidades no período.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="px-3 py-2 font-medium" />
            <th className="px-3 py-2 font-medium">Unidade</th>
            <th className="px-3 py-2 text-right font-medium">Relatos</th>
            <th className="px-3 py-2 text-right font-medium">Aproveitados</th>
            <th className="px-3 py-2 text-right font-medium">Sugestões implantadas</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={l.clinic_id} className="border-b last:border-0">
              <td className="px-3 py-2">
                <Posicao n={i + 1} />
              </td>
              <td className="px-3 py-2">
                <p>{l.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {l.pessoas === 1 ? "1 pessoa relatou" : `${l.pessoas} pessoas relataram`}
                </p>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{l.relatos}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {l.aproveitados}{" "}
                <span className="text-xs text-muted-foreground">({taxa(l.aproveitados, l.relatos)}%)</span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                <DeCom parte={l.implantadas} total={l.sugestoes} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RankingDePessoas({ linhas }: { linhas: NonNullable<PainelDeRelatos["por_pessoa"]> }) {
  if (linhas.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">Nenhum relato da equipe no período.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="px-3 py-2 font-medium" />
            <th className="px-3 py-2 font-medium">Pessoa</th>
            <th className="px-3 py-2 text-right font-medium">Relatos</th>
            <th className="px-3 py-2 text-right font-medium">Aproveitados</th>
            <th className="px-3 py-2 text-right font-medium">Sugestões implantadas</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={l.reporter_id} className="border-b last:border-0">
              <td className="px-3 py-2">
                <Posicao n={i + 1} />
              </td>
              <td className="px-3 py-2">
                <p>{l.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {[l.papel, l.unidades].filter(Boolean).join(" · ")}
                </p>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{l.relatos}</td>
              <td className="px-3 py-2 text-right tabular-nums">{l.aproveitados}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                <DeCom parte={l.implantadas} total={l.sugestoes} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
