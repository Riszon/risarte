import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Download, Network } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatBRL } from "@/lib/pricing";
import { todayInBrazil } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { FilterForm } from "@/components/filter-form";
import { CampoDeBusca } from "@/components/campo-de-busca";
import {
  aReceberPorData,
  diferencaDaTaxa,
  lerFiltros,
  podeVerRepassesDaFranquia,
  recebidoDaUnidade,
  rotuloDaDivergencia,
  rotuloDaSituacao,
  rotuloDaTaxa,
  rotuloDoMeio,
  rotuloDoMotivo,
  rotuloDoPeriodo,
  totalDoResumo,
  type Parte,
  type Repasses,
} from "@/lib/finance/repasses-franquia";
import { AtualizarSaldo } from "./atualizar-saldo";

export const metadata: Metadata = { title: "Repasses da franquia" };

/**
 * ASA3, entrega 3 (4010) — REPASSES DA FRANQUIA (spec 18.8).
 *
 * As taxas da rede (royalty, fundo, planejamento, comercial) que a unidade
 * paga: no split do Asaas, a receber e na conta a pagar. Quem vê o quê é o
 * BANCO (`franchise_payouts_read`): Admin e Financeiro da Franqueadora, a rede;
 * Gerente e Franqueado, a própria unidade. Nasce só com o Admin.
 *
 * ⚠️ Não confundir com "Repasses" (o pagamento aos dentistas).
 */
export default async function RepassesDaFranquia(props: PageProps<"/financeiro/repasses-da-franquia">) {
  const session = await getSessionContext();
  if (!podeVerRepassesDaFranquia(session)) redirect("/financeiro");
  const sp = await props.searchParams;
  const hoje = todayInBrazil();
  const filtros = lerFiltros(sp, hoje);
  const supabase = await createClient();

  // Quem não vê a rede fica na unidade em que está (P1).
  const daRede = session.isAdminMaster || Object.values(session.rolesByClinic).flat().includes("finance_franchisor");
  const unidade = daRede ? filtros.unidade : (session.activeClinic?.id ?? null);

  const { data, error } = await supabase.rpc("franchise_payouts_read", {
    p_from: filtros.de,
    p_to: filtros.ate,
    p_clinic_id: unidade,
    p_export: null,
  });

  let unidades: { id: string; name: string }[] = [];
  if (daRede) {
    const { data: rows } = await supabase
      .from("clinics")
      .select("id, name")
      .eq("type", "franchise_unit")
      .eq("is_active", true)
      .order("name")
      .returns<{ id: string; name: string }[]>();
    unidades = rows ?? [];
  }

  const params = new URLSearchParams();
  if (filtros.mes) params.set("mes", filtros.mes);
  else {
    params.set("de", filtros.de);
    params.set("ate", filtros.ate);
  }
  if (unidade) params.set("unidade", unidade);
  const planilha = (parte: Parte) => `/financeiro/repasses-da-franquia/planilha?parte=${parte}&${params.toString()}`;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Network className="size-6 text-primary" />
          Repasses da franquia
        </h1>
        <p className="text-sm text-muted-foreground">
          As taxas da rede pagas pela unidade: <strong>no split do Asaas</strong>, <strong>a receber</strong> e{" "}
          <strong>na conta a pagar</strong>. Não é o repasse dos dentistas (Financeiro → Análise → Repasses).
        </p>
      </div>

      <FilterForm className="grid gap-3 sm:grid-cols-4">
        {daRede && unidades.length > 1 && (
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Unidade</span>
            <select name="unidade" defaultValue={filtros.unidade ?? ""} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">Todas</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Mês</span>
          <CampoDeBusca type="month" name="mes" valorDoEndereco={filtros.mes ?? ""} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Ou de</span>
          <CampoDeBusca type="date" name="de" valorDoEndereco={filtros.mes ? "" : filtros.de} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Até</span>
          <CampoDeBusca type="date" name="ate" valorDoEndereco={filtros.mes ? "" : filtros.ate} />
        </label>
      </FilterForm>
      <p className="-mt-3 text-xs text-muted-foreground">
        Período: <strong>{rotuloDoPeriodo(filtros)}</strong>, pela data do pagamento. O liquidado no período usa a data em
        que o Asaas liquidou.
      </p>

      {error || !data ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          Não foi possível ler os repasses. Tente de novo em instantes.
        </p>
      ) : (
        <Conteudo r={data as Repasses} planilha={planilha} />
      )}
    </div>
  );
}

function fmtData(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
const brl = (v: number | null | undefined) => (v == null ? "—" : formatBRL(Number(v)));
const pct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

function Secao({
  titulo,
  descricao,
  planilha,
  children,
}: {
  titulo: string;
  descricao?: React.ReactNode;
  planilha?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{titulo}</h2>
          {descricao && <p className="text-xs text-muted-foreground">{descricao}</p>}
        </div>
        {planilha && (
          <a
            href={planilha}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
            title="Fica registrado na auditoria quem baixou, quando e com quais filtros."
          >
            <Download className="size-3.5" /> Planilha
          </a>
        )}
      </div>
      {children}
    </section>
  );
}

const TH = "px-2 py-1.5 font-medium";
const TD = "px-2 py-1.5";
const NUM = "px-2 py-1.5 text-right tabular-nums";

function Paciente({ id, nome, codigo }: { id: string | null; nome: string | null; codigo: string | null }) {
  return (
    <>
      {id ? (
        <Link href={`/prontuarios/${id}?aba=financeiro`} className="hover:underline">
          {nome ?? "—"}
        </Link>
      ) : (
        (nome ?? "—")
      )}
      {codigo && <span className="ml-1 font-mono text-[11px] text-muted-foreground">{codigo}</span>}
    </>
  );
}

function Conteudo({ r, planilha }: { r: Repasses; planilha: (p: Parte) => string }) {
  const total = totalDoResumo(r.resumo);
  const varias = r.resumo.length > 1;
  const un = (id: string) => r.unidades[id] ?? "—";
  const porData = aReceberPorData(r.a_receber);
  const temMensageria = r.taxas.some((t) => t.mensageria > 0);

  return (
    <div className="space-y-8">
      {/* PARTE 0 — saldo e resumo (ajustes 3 e 6) */}
      {r.rede && r.saldo && (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm",
            r.saldo.alerta && "border-amber-400 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
          )}
        >
          <div>
            <p className="text-xs text-muted-foreground">Saldo da conta Asaas da franqueadora ({r.saldo.conta})</p>
            <p className="text-lg font-semibold tabular-nums">
              {r.saldo.saldo_cents == null ? "ainda não conferido" : brl(r.saldo.saldo_cents)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {r.saldo.conferido_em
                ? `Conferido no Asaas em ${new Date(r.saldo.conferido_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                : "A rotina diária confere o saldo às 00:05; o botão confere agora."}
              {" · "}
              Mínimo: {r.saldo.minimo_cents == null ? "não definido" : brl(r.saldo.minimo_cents)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {r.saldo.alerta && (
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-4" />
                {r.saldo.alerta === "negativo"
                  ? "Saldo NEGATIVO: um estorno pode ter tirado da franqueadora."
                  : "Saldo abaixo do mínimo definido."}
              </p>
            )}
            <AtualizarSaldo />
          </div>
        </div>
      )}

      <Secao
        titulo="Resumo"
        descricao="A taxa devida pelos recebimentos do período e onde ela está. A conta a pagar é a das taxas dos meses do período."
        planilha={planilha("resumo")}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] overflow-hidden rounded-lg border text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className={cn(TH, "text-left")}>Unidade</th>
                <th className={cn(TH, "text-right")}>Taxa devida</th>
                <th className={cn(TH, "text-right")}>Paga no split</th>
                <th className={cn(TH, "text-right")}>A receber</th>
                <th className={cn(TH, "text-right")}>Foi para a conta a pagar</th>
                <th className={cn(TH, "text-right")}>Conta a pagar aberta</th>
                <th className={cn(TH, "text-right")}>Conta a pagar vencida</th>
              </tr>
            </thead>
            <tbody>
              {r.resumo.length === 0 && (
                <tr>
                  <td colSpan={7} className={cn(TD, "text-muted-foreground")}>
                    Nenhum recebimento com taxa no período.
                  </td>
                </tr>
              )}
              {r.resumo.map((l) => (
                <tr key={l.clinic_id} className="border-t">
                  <td className={TD}>{l.name}</td>
                  <td className={NUM}>{brl(l.devido)}</td>
                  <td className={NUM}>{brl(l.pago_no_split)}</td>
                  <td className={NUM}>{brl(l.a_receber)}</td>
                  <td className={NUM}>{brl(l.foi_para_conta_a_pagar)}</td>
                  <td className={NUM}>{brl(l.conta_a_pagar_aberta)}</td>
                  <td className={cn(NUM, l.conta_a_pagar_vencida > 0 && "font-medium text-destructive")}>{brl(l.conta_a_pagar_vencida)}</td>
                </tr>
              ))}
              {varias && (
                <tr className="border-t bg-muted/30 font-medium">
                  <td className={TD}>Total da rede</td>
                  <td className={NUM}>{brl(total.devido)}</td>
                  <td className={NUM}>{brl(total.pago_no_split)}</td>
                  <td className={NUM}>{brl(total.a_receber)}</td>
                  <td className={NUM}>{brl(total.foi_para_conta_a_pagar)}</td>
                  <td className={NUM}>{brl(total.conta_a_pagar_aberta)}</td>
                  <td className={NUM}>{brl(total.conta_a_pagar_vencida)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Secao>

      {/* PARTE 1 — recebido com split × por fora (ajuste 2) */}
      <Secao
        titulo="Recebido com split × por fora"
        descricao="Como o dinheiro entrou, a fatia de cada forma no total recebido da unidade e a média da rede. Recebimento estornado não conta como recebido; a taxa dele, se continua devida, aparece em 'Estornado'."
        planilha={planilha("recebido")}
      >
        {r.resumo.map((u) => {
          const linhas = recebidoDaUnidade(r, u.clinic_id);
          const motivos = r.motivos_sem_split.filter((m) => m.clinic_id === u.clinic_id);
          return (
            <div key={u.clinic_id} className="space-y-1">
              {varias && <p className="text-sm font-medium">{u.name}</p>}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] overflow-hidden rounded-lg border text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className={cn(TH, "text-left")}>Como foi recebido</th>
                      <th className={cn(TH, "text-right")}>Recebido</th>
                      <th className={cn(TH, "text-right")}>% da unidade</th>
                      <th className={cn(TH, "text-right")}>% média da rede</th>
                      <th className={cn(TH, "text-right")}>Taxa devida</th>
                      <th className={cn(TH, "text-right")}>Paga no split</th>
                      <th className={cn(TH, "text-right")}>Na conta a pagar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => (
                      <tr key={l.valor} className="border-t">
                        <td className={TD}>
                          {l.rotulo}
                          {l.n > 0 && <span className="ml-1 text-[11px] text-muted-foreground">({l.n})</span>}
                        </td>
                        <td className={NUM}>{brl(l.recebido)}</td>
                        <td className={NUM}>{pct(l.percentual)}</td>
                        <td
                          className={cn(
                            NUM,
                            "text-muted-foreground",
                            l.valor !== "split" && l.valor !== "estornado" && l.percentual - l.mediaDaRede >= 10 && "font-medium text-amber-700 dark:text-amber-300"
                          )}
                        >
                          {pct(l.mediaDaRede)}
                        </td>
                        <td className={NUM}>{brl(l.devido)}</td>
                        <td className={NUM}>{brl(l.pago_no_split)}</td>
                        <td className={NUM}>{brl(l.conta_a_pagar)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {motivos.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Asaas sem split:{" "}
                  {motivos.map((m) => `${rotuloDoMotivo(m.motivo)} (${m.n}, ${brl(m.recebido)})`).join(" · ")}
                </p>
              )}
            </div>
          );
        })}
      </Secao>

      {/* PARTE 2 — liquidado por unidade e taxa, conferido por cobrança (ajustes 1 e 5) */}
      <Secao
        titulo="Liquidado por unidade e taxa"
        descricao={
          <>
            Conferência <strong>por cobrança</strong>: o devido e o liquidado das mesmas cobranças pagas no período. O que o Asaas
            ainda não liquidou está em &ldquo;a receber&rdquo;, não na diferença. Diferença até{" "}
            {brl(r.tolerancia_cents)} por cobrança é absorvida.
          </>
        }
        planilha={planilha("taxas")}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] overflow-hidden rounded-lg border text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                {varias && <th className={cn(TH, "text-left")}>Unidade</th>}
                <th className={cn(TH, "text-left")}>Taxa</th>
                <th className={cn(TH, "text-right")}>Devido</th>
                <th className={cn(TH, "text-right")}>Liquidado</th>
                <th className={cn(TH, "text-right")}>Diferença</th>
                <th className={cn(TH, "text-right")}>A receber</th>
                <th className={cn(TH, "text-left")}>Situação</th>
              </tr>
            </thead>
            <tbody>
              {r.taxas.length === 0 && (
                <tr>
                  <td colSpan={7} className={cn(TD, "text-muted-foreground")}>
                    Nenhuma cobrança com split paga no período.
                  </td>
                </tr>
              )}
              {[...r.taxas]
                .sort((a, b) => un(a.clinic_id).localeCompare(un(b.clinic_id)) || a.fee.localeCompare(b.fee))
                .map((t) => {
                  const dif = diferencaDaTaxa(t);
                  return (
                    <tr key={`${t.clinic_id}-${t.fee}`} className="border-t">
                      {varias && <td className={TD}>{un(t.clinic_id)}</td>}
                      <td className={TD}>{rotuloDaTaxa(t.fee)}</td>
                      <td className={NUM}>{brl(t.devido_liquidadas)}</td>
                      <td className={NUM}>{brl(t.liquidado)}</td>
                      <td className={cn(NUM, dif != null && dif < 0 && "text-amber-700 dark:text-amber-300")}>{brl(dif)}</td>
                      <td className={NUM}>{brl(t.a_receber)}</td>
                      <td className={cn(TD, "text-xs text-muted-foreground")}>
                        {[
                          t.absorvidas > 0 && `${t.absorvidas} absorvida(s)`,
                          t.mensageria > 0 && `${t.mensageria} provável mensageria`,
                          t.divergentes > 0 && `${t.divergentes} divergente(s)`,
                          t.fora_do_split ? `${brl(t.fora_do_split)} saiu do split` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "conferido"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {temMensageria && (
          <p className="rounded border border-sky-300 bg-sky-50 p-2 text-xs text-sky-950 dark:bg-sky-950/30 dark:text-sky-100">
            <strong>Provável mensageria:</strong> a unidade tem os avisos do Asaas ligados e a falta é do tamanho da tarifa de
            mensageria (até o percentual da taxa × R$ 0,99). Enquanto o Asaas não confirmar se essa tarifa sai do valor líquido,
            isso aparece como nota, não como divergência. O que faltou foi para a conta a pagar.
          </p>
        )}
        {r.cobrancas.length > 0 && (
          <details className="rounded-lg border p-2 text-sm">
            <summary className="cursor-pointer select-none">
              Cobrança por cobrança ({new Set(r.cobrancas.map((c) => c.charge_id)).size})
              <a href={planilha("cobrancas")} className="ml-3 text-xs underline" title="Fica registrado na auditoria.">
                planilha
              </a>
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className={cn(TH, "text-left")}>Paciente</th>
                    <th className={cn(TH, "text-left")}>Pago em</th>
                    <th className={cn(TH, "text-left")}>Carteira</th>
                    <th className={cn(TH, "text-left")}>Taxa</th>
                    <th className={cn(TH, "text-right")}>Devido</th>
                    <th className={cn(TH, "text-right")}>Liquidado</th>
                    <th className={cn(TH, "text-left")}>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {r.cobrancas.map((l) => (
                    <tr key={`${l.charge_id}-${l.carteira}-${l.taxa}`} className="border-t">
                      <td className={TD}>
                        <Paciente id={l.client_id} nome={l.cliente} codigo={l.codigo} />
                        <span className="ml-1 text-[11px] text-muted-foreground">{rotuloDoMeio(l.meio)}</span>
                      </td>
                      <td className={TD}>{fmtData(l.pago_em)}</td>
                      <td className={cn(TD, "text-xs")}>{l.carteira ?? "—"}</td>
                      <td className={TD}>{rotuloDaTaxa(l.taxa)}</td>
                      <td className={NUM}>{brl(l.devido)}</td>
                      <td className={NUM}>{brl(l.liquidado)}</td>
                      <td className={cn(TD, "text-xs")}>{rotuloDaSituacao(l.situacao)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </Secao>

      {/* PARTE 3 — a receber e liquidado no período (16.8.2, P4) */}
      <Secao
        titulo="Repasses a receber"
        descricao="Taxas de cobranças já pagas que o Asaas ainda não liquidou, de qualquer período, pela data prevista de crédito da cobrança (no cartão, cerca de 32 dias depois)."
        planilha={planilha("a_receber")}
      >
        {porData.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada a receber agora.</p>
        ) : (
          <table className="w-full overflow-hidden rounded-lg border text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className={cn(TH, "text-left")}>Data prevista</th>
                <th className={cn(TH, "text-right")}>Cobranças</th>
                <th className={cn(TH, "text-right")}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {porData.map((d) => (
                <tr key={d.data ?? "sem"} className={cn("border-t", d.atrasado && "text-amber-800 dark:text-amber-300")}>
                  <td className={TD}>
                    {d.data ? fmtData(d.data) : "Sem data prevista"}
                    {d.atrasado && <span className="ml-1 text-[11px] font-medium">atrasado</span>}
                  </td>
                  <td className={NUM}>{d.cobrancas}</td>
                  <td className={NUM}>{brl(d.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {r.a_receber.length > 0 && (
          <details className="rounded-lg border p-2 text-sm">
            <summary className="cursor-pointer select-none">Por cobrança e taxa ({r.a_receber.length})</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <tbody>
                  {r.a_receber.map((l) => (
                    <tr key={`${l.charge_id}-${l.taxa}`} className="border-t">
                      <td className={TD}>
                        <Paciente id={l.client_id} nome={l.cliente} codigo={l.codigo} />
                        {varias && <span className="ml-1 text-[11px] text-muted-foreground">· {un(l.clinic_id)}</span>}
                      </td>
                      <td className={TD}>{rotuloDoMeio(l.meio)}</td>
                      <td className={TD}>previsto {fmtData(l.previsto)}</td>
                      <td className={TD}>{rotuloDaTaxa(l.taxa)}</td>
                      <td className={NUM}>{brl(l.valor)}</td>
                      <td className={cn(TD, "text-xs")}>{l.bloqueado ? "bloqueado" : l.atrasado ? "atrasado" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
        {r.liquidado_no_periodo.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Liquidado no período (pela data do Asaas):{" "}
            {Object.entries(
              r.liquidado_no_periodo.reduce<Record<string, number>>((acc, l) => {
                acc[l.fee] = (acc[l.fee] ?? 0) + Number(l.liquidado);
                return acc;
              }, {})
            )
              .map(([fee, v]) => `${rotuloDaTaxa(fee)} ${brl(v)}`)
              .join(" · ")}
          </p>
        )}
      </Secao>

      {/* PARTE 4 — divergências (P5: só mostram e levam à ficha) */}
      <Secao
        titulo="Divergências e ocorrências"
        descricao="Só para conferir: cada linha leva à ficha. Abater ou dispensar fica para a cobrança mensal da franquia (ASA6)."
        planilha={planilha("divergencias")}
      >
        {r.divergencias.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma no período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] overflow-hidden rounded-lg border text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className={cn(TH, "text-left")}>Data</th>
                  <th className={cn(TH, "text-left")}>Ocorrência</th>
                  <th className={cn(TH, "text-left")}>Paciente</th>
                  <th className={cn(TH, "text-right")}>Valor</th>
                  <th className={cn(TH, "text-left")}>Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {r.divergencias.map((d, i) => (
                  <tr key={i} className={cn("border-t", d.tipo === "mensageria" && "text-muted-foreground")}>
                    <td className={TD}>{fmtData(d.data)}</td>
                    <td className={TD}>{rotuloDaDivergencia(d.tipo)}</td>
                    <td className={TD}>
                      <Paciente id={d.client_id} nome={d.cliente} codigo={d.codigo} />
                      {varias && <span className="ml-1 text-[11px] text-muted-foreground">· {un(d.clinic_id)}</span>}
                    </td>
                    <td className={NUM}>{d.tipo === "estorno" && !d.valor ? "sem taxa da rede" : brl(d.valor)}</td>
                    <td className={cn(TD, "text-xs")}>
                      {[d.detalhe, d.autor && `por ${d.autor}`, d.motivo && `“${d.motivo}”`].filter(Boolean).join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>

      {/* PARTE 5 — dispensas (14.5) */}
      <Secao
        titulo="Dispensas do período"
        descricao="Quitações por valor menor e arredondamentos: quanto foi dispensado de cada natureza, por quem e por quê."
        planilha={planilha("dispensas")}
      >
        {r.dispensas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma no período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] overflow-hidden rounded-lg border text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className={cn(TH, "text-left")}>Data</th>
                  <th className={cn(TH, "text-left")}>Paciente</th>
                  <th className={cn(TH, "text-right")}>Principal</th>
                  <th className={cn(TH, "text-right")}>Benefício</th>
                  <th className={cn(TH, "text-right")}>Multa</th>
                  <th className={cn(TH, "text-right")}>Juros</th>
                  <th className={cn(TH, "text-right")}>Total</th>
                  <th className={cn(TH, "text-left")}>Quem e por quê</th>
                </tr>
              </thead>
              <tbody>
                {r.dispensas.map((d) => (
                  <tr key={d.id} className="border-t">
                    <td className={TD}>{fmtData(d.data)}</td>
                    <td className={TD}>
                      <Paciente id={d.client_id} nome={d.cliente} codigo={d.codigo} />
                    </td>
                    <td className={NUM}>{brl(d.principal)}</td>
                    <td className={NUM}>{brl(d.beneficio)}</td>
                    <td className={NUM}>{brl(d.multa)}</td>
                    <td className={NUM}>{brl(d.juros)}</td>
                    <td className={cn(NUM, "font-medium")}>{brl(d.total)}</td>
                    <td className={cn(TD, "text-xs")}>
                      {d.autor ?? "—"}
                      {d.motivo && ` · “${d.motivo}”`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>
    </div>
  );
}
