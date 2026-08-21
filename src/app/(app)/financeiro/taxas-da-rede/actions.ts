"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canConfigureFinanceNetwork } from "@/lib/finance/access";
import { financeErrorMessage } from "@/lib/finance/errors";
import { ruleErrors, type NetworkFeeKind } from "@/lib/finance/network-fees";
import { logAudit } from "@/lib/audit";

type Result = { ok: boolean; error?: string; count?: number };

const DENIED =
  "Só a Franqueadora configura as taxas da rede — é ela quem cobra.";

/**
 * Salvar a regra de uma taxa: o padrão da rede (clinicId nulo) ou o acordo de
 * uma unidade específica.
 *
 * A validação roda aqui E no banco (check constraints). Esta é para o recado
 * ser em português; a que vale é a de lá.
 */
export async function saveNetworkFee(input: {
  clinicId: string | null;
  fee: string;
  kind: NetworkFeeKind;
  percent: number;
  amountCents: number;
  dueDay: number;
  active: boolean;
  note: string;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!canConfigureFinanceNetwork(session)) {
    return { ok: false, error: DENIED };
  }

  const errors = ruleErrors({
    kind: input.kind,
    percent: input.percent,
    amountCents: input.amountCents,
    dueDay: input.dueDay,
  });
  if (errors.length > 0) return { ok: false, error: errors[0] };

  const supabase = await createClient();
  const { error } = await supabase.from("network_fees").upsert(
    {
      clinic_id: input.clinicId,
      fee: input.fee,
      kind: input.kind,
      percent: input.kind === "percent" ? input.percent : 0,
      amount_cents: input.kind === "fixed" ? Math.round(input.amountCents) : 0,
      due_day: input.dueDay,
      active: input.active,
      note: input.note.trim() || null,
      updated_at: new Date().toISOString(),
      updated_by: session.userId,
    },
    { onConflict: "clinic_id,fee" }
  );
  if (error) {
    console.error("saveNetworkFee failed:", error.message);
    return {
      ok: false,
      error: financeErrorMessage(error.message) ?? "Não foi possível salvar.",
    };
  }

  await logAudit({
    action: "update",
    entityType: "network_fee",
    entityId: `${input.clinicId ?? "rede"}:${input.fee}`,
    clinicId: input.clinicId ?? undefined,
  });
  revalidatePath("/financeiro/taxas-da-rede");
  return { ok: true };
}

/**
 * Apagar a exceção de uma unidade: ela volta a seguir a rede.
 *
 * Diferente de desligar a taxa — desligada é um acordo ("esta unidade não paga
 * royalty"); apagada é "esta unidade não tem acordo próprio". Confundir os dois
 * faria a unidade parar de pagar quando alguém quisesse só voltar ao padrão.
 */
export async function clearNetworkFeeOverride(input: {
  clinicId: string;
  fee: string;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!canConfigureFinanceNetwork(session)) {
    return { ok: false, error: DENIED };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("network_fees")
    .delete()
    .eq("clinic_id", input.clinicId)
    .eq("fee", input.fee);
  if (error) {
    console.error("clearNetworkFeeOverride failed:", error.message);
    return { ok: false, error: "Não foi possível voltar ao padrão da rede." };
  }

  await logAudit({
    action: "update",
    entityType: "network_fee_clear",
    entityId: `${input.clinicId}:${input.fee}`,
    clinicId: input.clinicId,
  });
  revalidatePath("/financeiro/taxas-da-rede");
  return { ok: true };
}

/** Gerar as contas das taxas FIXAS do mês, sem esperar o dia 1º. */
export async function chargeFixedFeesNow(input: {
  year: number;
  month: number;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!canConfigureFinanceNetwork(session)) {
    return { ok: false, error: DENIED };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("charge_fixed_network_fees", {
    p_year: input.year,
    p_month: input.month,
  });
  if (error) {
    console.error("charge_fixed_network_fees failed:", error.message);
    return {
      ok: false,
      error:
        financeErrorMessage(error.message) ??
        "Não foi possível gerar as taxas fixas.",
    };
  }

  revalidatePath("/financeiro/taxas-da-rede");
  return { ok: true, count: Number(data ?? 0) };
}
