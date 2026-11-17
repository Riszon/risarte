import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { podeVerCobrancaDaRede, type LoteDaLista, type LoteLido, type SaldoAnterior } from "@/lib/finance/cobranca-da-rede";
import { CobrancaDaRede } from "./cobranca-da-rede";
import { ConferenciaDasTaxas, type ConferenciaLida } from "./conferencia";
import Link from "next/link";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Cobrança da rede" };

/**
 * ASA6 (4021, spec 20) — A COBRANÇA MENSAL DA REDE às unidades.
 *
 * O Financeiro da Franqueadora e o Admin Master veem a rede; o Gerente e o
 * franqueado, a própria unidade. Dentista, Planner, ASB, TSB, SDR e Recepção
 * não veem (20.15.5) — o banco recusa de novo em cada leitura.
 */
export default async function CobrancaDaRedePage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSessionContext();
  if (!podeVerCobrancaDaRede(session)) redirect("/financeiro");
  const sp = await props.searchParams;
  const lote = typeof sp.lote === "string" ? sp.lote : null;
  const aba = sp.aba === "conferencia" ? "conferencia" : "meses";
  const saldoDe = typeof sp.saldo === "string" ? sp.saldo : null;
  const supabase = await createClient();
  const daRede = session.isAdminMaster || Object.values(session.rolesByClinic).flat().includes("finance_franchisor");
  const unidade = daRede ? null : (session.activeClinic?.id ?? null);

  const { data: lista, error } = await supabase.rpc("franchise_monthly_list", { p_clinic_id: unidade });
  if (error && !/NOT_ALLOWED/.test(error.message)) console.error("franchise monthly list failed:", error.message);
  const semMigracao = !!error && /does not exist|schema cache/i.test(error.message);

  let lido: LoteLido | null = null;
  if (lote) {
    const r = await supabase.rpc("franchise_monthly_read", { p_batch_id: lote });
    if (r.error) console.error("franchise monthly read failed:", r.error.message);
    lido = (r.data ?? null) as LoteLido | null;
  }

  let saldo: SaldoAnterior | null = null;
  const clinicaDoSaldo = saldoDe ?? (lido?.can_manage ? lido.clinic.id : null);
  if (daRede && clinicaDoSaldo) {
    const r = await supabase.rpc("franchise_prior_balance_read", { p_clinic_id: clinicaDoSaldo });
    if (!r.error) saldo = { clinicId: clinicaDoSaldo, ...(r.data as Omit<SaldoAnterior, "clinicId">) };
  }

  let unidades: { id: string; nome: string; falta: string[] }[] = [];
  if (daRede && !semMigracao) {
    const r = await supabase.rpc("franchise_billing_config_read");
    unidades = (((r.data as { units?: { clinic_id: string; name: string; missing: string[] | null }[] } | null)?.units) ?? []).map((u) => ({
      id: u.clinic_id,
      nome: u.name,
      falta: u.missing ?? [],
    }));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Cobrança da rede</h1>
        <p className="text-sm text-muted-foreground">
          A cobrança mensal das taxas da rede à unidade: as taxas fixas e o que não foi retido pelo split, linha a linha.
          A unidade confere ou contesta na prévia; o Financeiro da Franqueadora aprova e emite pela conta da franqueadora.
        </p>
      </div>
      <nav className="flex gap-1 border-b text-sm">
        {(
          [
            ["meses", "Meses", "/financeiro/cobranca-da-rede"],
            ["conferencia", "Conferência das taxas", "/financeiro/cobranca-da-rede?aba=conferencia"],
          ] as const
        ).map(([id, rotulo, href]) => (
          <Link
            key={id}
            href={href}
            aria-current={aba === id ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-3 py-2", aba === id ? "border-primary font-medium" : "border-transparent text-muted-foreground")}
          >
            {rotulo}
          </Link>
        ))}
      </nav>
      {aba === "conferencia" ? (
        <Conferencia supabase={supabase} sp={sp} unidadeFixa={unidade} />
      ) : semMigracao ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          A cobrança mensal ainda não existe neste banco (falta a migração 4021).
        </p>
      ) : (
        <CobrancaDaRede
          lista={(lista ?? []) as LoteDaLista[]}
          lido={lido}
          saldo={saldo}
          daRede={daRede}
          unidades={unidades}
          loteAberto={lote}
        />
      )}
    </div>
  );
}

/** ASA6 (4021a): a aba "Conferência das taxas". O banco decide quem vê o quê. */
async function Conferencia({
  supabase,
  sp,
  unidadeFixa,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  sp: Record<string, string | string[] | undefined>;
  unidadeFixa: string | null;
}) {
  const mes = typeof sp.mes === "string" && /^\d{4}-\d{2}$/.test(sp.mes) ? `${sp.mes}-01` : null;
  const unidade = unidadeFixa ?? (typeof sp.unidade === "string" ? sp.unidade : null);
  const { data, error } = await supabase.rpc("franchise_reconciliation_read", { p_period: mes, p_clinic_id: unidade });
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      return <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">A conferência ainda não existe neste banco (falta a migração 4021a).</p>;
    }
    console.error("franchise reconciliation read failed:", error.message);
    return <p className="text-sm text-muted-foreground">Não foi possível ler a conferência.</p>;
  }
  return <ConferenciaDasTaxas lido={data as ConferenciaLida} unidadeAberta={unidade} />;
}
