import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { podeVerCobrancaDaRede, type LoteDaLista, type LoteLido, type SaldoAnterior } from "@/lib/finance/cobranca-da-rede";
import { CobrancaDaRede } from "./cobranca-da-rede";

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
      {semMigracao ? (
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
