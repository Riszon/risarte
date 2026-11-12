import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatBRL } from "@/lib/pricing";
import { todayInBrazil } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { FilterForm } from "@/components/filter-form";
import { CampoDeBusca } from "@/components/campo-de-busca";
import { podeVerPainelDeCobrancas } from "@/lib/finance/selo-atraso";
import { ROTULO_DA_SITUACAO } from "@/lib/cobrancas";
import {
  MEIOS_DO_PAINEL,
  agendaDoAReceber,
  argumentosDaLista,
  lerFiltros,
  rotuloDaSituacao,
  rotuloDoMeio,
  type LinhaAReceber,
  type LinhaEmitida,
} from "@/lib/finance/painel-cobrancas";

export const metadata: Metadata = { title: "Cobranças" };

/**
 * ASA2, entrega 2 (4006) — PAINEL DE COBRANÇAS (spec 16.8.1 e 17.2).
 *
 * Duas abas: "A receber do Asaas" (pago e ainda não liquidado, pela data
 * prevista) e "Cobranças emitidas" (todas as do riSZon, com filtros e
 * planilha). Quem vê o quê é o BANCO: Gerente e Franqueado, a própria
 * unidade; Admin e Financeiro da Franqueadora, a rede. A Recepcionista nunca.
 */
export default async function PainelDeCobrancas(props: PageProps<"/financeiro/cobrancas">) {
  const session = await getSessionContext();
  if (!podeVerPainelDeCobrancas(session)) redirect("/financeiro");
  const sp = await props.searchParams;
  const aba = sp.aba === "emitidas" ? "emitidas" : "receber";
  const filtros = lerFiltros(sp);
  const supabase = await createClient();
  const hoje = todayInBrazil();

  const { data: clinicRows } = await supabase
    .from("clinics")
    .select("id, name, type")
    .eq("type", "franchise_unit")
    .eq("is_active", true)
    .order("name")
    .returns<{ id: string; name: string; type: string }[]>();
  const unidades = clinicRows ?? [];

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) params.set(k, v);
  const hrefDaAba = (a: string) => {
    const p = new URLSearchParams(params);
    p.set("aba", a);
    return `/financeiro/cobrancas?${p.toString()}`;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Receipt className="size-6 text-primary" />
          Cobranças
        </h1>
        <p className="text-sm text-muted-foreground">
          As cobranças do Asaas emitidas pelo riSZon. <strong>Cobranças criadas direto no painel do Asaas não aparecem aqui.</strong>
        </p>
      </div>

      <nav className="flex gap-1 border-b">
        {[
          { chave: "receber", rotulo: "A receber do Asaas" },
          { chave: "emitidas", rotulo: "Cobranças emitidas" },
        ].map((a) => (
          <Link
            key={a.chave}
            href={hrefDaAba(a.chave)}
            className={cn(
              "border-b-2 px-3 py-2 text-sm",
              aba === a.chave ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {a.rotulo}
          </Link>
        ))}
      </nav>

      <FilterForm className="grid gap-3 sm:grid-cols-4">
        <input type="hidden" name="aba" value={aba} />
        {unidades.length > 1 && (
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Unidade</span>
            <select name="unidade" defaultValue={filtros.unidade ?? ""} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">Todas as que você vê</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {aba === "emitidas" && (
          <>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Situação</span>
              <select name="situacao" defaultValue={filtros.situacoes?.[0] ?? ""} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                <option value="">Todas</option>
                {Object.entries(ROTULO_DA_SITUACAO).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Meio</span>
              <select name="meio" defaultValue={filtros.meios?.[0] ?? ""} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                <option value="">Todos</option>
                {MEIOS_DO_PAINEL.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {m.rotulo}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Período pela data de</span>
              <select name="data" defaultValue={filtros.data} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                <option value="emissao">Emissão</option>
                <option value="vencimento">Vencimento</option>
                <option value="pagamento">Pagamento</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">De</span>
              <CampoDeBusca type="date" name="de" valorDoEndereco={filtros.de ?? ""} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Até</span>
              <CampoDeBusca type="date" name="ate" valorDoEndereco={filtros.ate ?? ""} />
            </label>
          </>
        )}
      </FilterForm>

      {aba === "receber" ? (
        <AReceber unidade={filtros.unidade} hoje={hoje} />
      ) : (
        <Emitidas filtros={filtros} params={params} />
      )}
    </div>
  );
}

function Erro() {
  return (
    <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
      Não foi possível ler as cobranças. Tente de novo em instantes.
    </p>
  );
}

function Valores({ soma }: { soma: { qtd: number; bruto: number; taxa: number; liquido: number } }) {
  return (
    <>
      <td className="px-2 py-1.5 text-right tabular-nums">{soma.qtd}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{formatBRL(soma.bruto)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{formatBRL(soma.taxa)}</td>
      <td className="px-2 py-1.5 text-right font-medium tabular-nums">{formatBRL(soma.liquido)}</td>
    </>
  );
}

function Cabecalho({ primeira }: { primeira: string }) {
  return (
    <thead className="bg-muted/40 text-xs text-muted-foreground">
      <tr>
        <th className="px-2 py-1.5 text-left font-medium">{primeira}</th>
        <th className="px-2 py-1.5 text-right font-medium">Cobranças</th>
        <th className="px-2 py-1.5 text-right font-medium">Bruto</th>
        <th className="px-2 py-1.5 text-right font-medium">Taxa do Asaas</th>
        <th className="px-2 py-1.5 text-right font-medium">Líquido</th>
      </tr>
    </thead>
  );
}

function fmtData(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

async function AReceber({ unidade, hoje }: { unidade: string | null; hoje: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gateway_receivables_due", { p_clinic_id: unidade });
  if (error) return <Erro />;
  const linhas = (data ?? []) as LinhaAReceber[];
  const ag = agendaDoAReceber(linhas, hoje);

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        O que os pacientes <strong>já pagaram</strong> e o Asaas <strong>ainda não creditou</strong>, pela data prevista
        de liquidação. Quando chega o aviso de &ldquo;recebido&rdquo;, o valor sai daqui e entra na conta &ldquo;Asaas&rdquo; da
        unidade.
      </p>

      <section className="grid gap-3 sm:grid-cols-5">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Total a receber (líquido)</p>
          <p className="text-xl font-semibold tabular-nums">{formatBRL(ag.total.liquido)}</p>
          <p className="text-[11px] text-muted-foreground">
            {ag.total.qtd} cobrança(s) · bruto {formatBRL(ag.total.bruto)}
          </p>
        </div>
        {ag.faixas.map((f) => (
          <div key={f.chave} className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{f.rotulo}</p>
            <p className="text-lg font-semibold tabular-nums">{formatBRL(f.soma.liquido)}</p>
            <p className="text-[11px] text-muted-foreground">{f.soma.qtd} cobrança(s)</p>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Por meio de pagamento</h2>
        <table className="w-full overflow-hidden rounded-lg border text-sm">
          <Cabecalho primeira="Meio" />
          <tbody>
            {ag.porMeio.map((m) => (
              <tr key={m.valor} className="border-t">
                <td className="px-2 py-1.5">{m.rotulo}</td>
                <Valores soma={m.soma} />
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {ag.porUnidade.length > 1 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Por unidade</h2>
          <table className="w-full overflow-hidden rounded-lg border text-sm">
            <Cabecalho primeira="Unidade" />
            <tbody>
              {ag.porUnidade.map((u) => (
                <tr key={u.clinicId} className="border-t">
                  <td className="px-2 py-1.5">{u.nome}</td>
                  <Valores soma={u.soma} />
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Dia a dia</h2>
        {ag.porDia.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada a receber do Asaas agora.</p>
        ) : (
          <table className="w-full overflow-hidden rounded-lg border text-sm">
            <Cabecalho primeira="Data prevista" />
            <tbody>
              {ag.porDia.map((d) => (
                <tr key={d.data ?? "sem"} className={cn("border-t", d.data && d.data < hoje && "text-amber-800 dark:text-amber-300")}>
                  <td className="px-2 py-1.5">
                    {d.data ? fmtData(d.data) : "Sem data prevista"}
                    {d.data && d.data < hoje && <span className="ml-1 text-[11px]">(passou da data)</span>}
                  </td>
                  <Valores soma={d.soma} />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {linhas.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Cobranças a receber</h2>
          <table className="w-full overflow-hidden rounded-lg border text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Paciente</th>
                <th className="px-2 py-1.5 text-left font-medium">Meio</th>
                <th className="px-2 py-1.5 text-left font-medium">Pago em</th>
                <th className="px-2 py-1.5 text-left font-medium">Previsto para</th>
                <th className="px-2 py-1.5 text-right font-medium">Líquido</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.charge_id} className="border-t">
                  <td className="px-2 py-1.5">
                    {l.client_id ? (
                      <Link href={`/prontuarios/${l.client_id}?aba=financeiro`} className="hover:underline">
                        {l.client_name ?? "—"}
                      </Link>
                    ) : (
                      "—"
                    )}
                    {l.client_code && <span className="ml-1 font-mono text-[11px] text-muted-foreground">{l.client_code}</span>}
                    {ag.porUnidade.length > 1 && <span className="ml-1 text-[11px] text-muted-foreground">· {l.clinic_name}</span>}
                  </td>
                  <td className="px-2 py-1.5">{rotuloDoMeio(l.billing_type)}</td>
                  <td className="px-2 py-1.5">{fmtData(l.paid_on)}</td>
                  <td className="px-2 py-1.5">{fmtData(l.credit_date)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatBRL(Number(l.net_cents ?? Number(l.paid_cents ?? 0) - Number(l.fee_cents ?? 0)))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

async function Emitidas({
  filtros,
  params,
}: {
  filtros: ReturnType<typeof lerFiltros>;
  params: URLSearchParams;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gateway_charges_list", argumentosDaLista(filtros, false));
  if (error) return <Erro />;
  const linhas = (data ?? []) as LinhaEmitida[];
  const p = new URLSearchParams(params);
  p.delete("aba");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {linhas.length === 1000 ? "As 1.000 mais recentes — use os filtros para afinar." : `${linhas.length} cobrança(s).`}
        </p>
        {linhas.length > 0 && (
          <a
            href={`/financeiro/cobrancas/planilha?${p.toString()}`}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            title="Fica registrado na auditoria quem baixou, quando e com quais filtros."
          >
            Baixar planilha
          </a>
        )}
      </div>
      {linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma cobrança com estes filtros.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] overflow-hidden rounded-lg border text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Paciente</th>
                <th className="px-2 py-1.5 text-left font-medium">Meio</th>
                <th className="px-2 py-1.5 text-left font-medium">Situação</th>
                <th className="px-2 py-1.5 text-left font-medium">Vencimento</th>
                <th className="px-2 py-1.5 text-right font-medium">Valor</th>
                <th className="px-2 py-1.5 text-left font-medium">Pago em</th>
                <th className="px-2 py-1.5 text-right font-medium">Líquido</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.charge_id} className="border-t">
                  <td className="px-2 py-1.5">
                    {l.client_id ? (
                      <Link href={`/prontuarios/${l.client_id}?aba=financeiro`} className="hover:underline">
                        {l.client_name ?? "—"}
                      </Link>
                    ) : (
                      "—"
                    )}
                    {l.client_code && <span className="ml-1 font-mono text-[11px] text-muted-foreground">{l.client_code}</span>}
                    <span className="ml-1 text-[11px] text-muted-foreground">
                      {l.installment_seq ? `parcela ${l.installment_seq} · ` : ""}
                      {l.clinic_name}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">{rotuloDoMeio(l.billing_type)}</td>
                  <td className="px-2 py-1.5">
                    {rotuloDaSituacao(l.status)}
                    {l.is_overdue_reissue && <span className="ml-1 text-[11px] text-muted-foreground">(nova data)</span>}
                  </td>
                  <td className="px-2 py-1.5">{fmtData(l.due_date)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{l.value_cents == null ? "—" : formatBRL(Number(l.value_cents))}</td>
                  <td className="px-2 py-1.5">{fmtData(l.paid_on)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{l.net_cents == null ? "—" : formatBRL(Number(l.net_cents))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
