"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canConfigureFinanceNetwork } from "@/lib/finance/access";
import { financeErrorMessage } from "@/lib/finance/errors";
import {
  campaignErrors,
  ruleErrors,
  slugifyFeeKey,
  type CampaignMode,
  type NetworkFeeKind,
} from "@/lib/finance/network-fees";
import { logAudit } from "@/lib/audit";

type Result = { ok: boolean; error?: string; count?: number };

const DENIED =
  "Só a Franqueadora configura as taxas da rede — é ela quem cobra.";

/** Mensagens dos códigos que só existem aqui. */
const LOCAL_ERRORS: Record<string, string> = {
  FEE_IS_SYSTEM:
    "Esta é uma das taxas originais da rede: dá para inativar, não para excluir.",
  FEE_IN_USE:
    "Esta taxa já foi cobrada de alguma unidade. Inative em vez de excluir — apagar levaria junto a explicação de dinheiro que já saiu.",
  FEE_IN_CAMPAIGN:
    "Existe campanha usando esta taxa. Tire-a da campanha primeiro: se ela saísse sozinha, a campanha ficaria sem taxa nenhuma — e campanha sem taxa vale para todas.",
  KIND_LOCKED:
    "A taxa já tem cobrança: não dá para trocar percentual por valor fixo, senão o histórico deixaria de explicar o que foi cobrado.",
  UNIT_ACCOUNT_INVALID:
    "A conta da unidade precisa existir no plano e receber lançamento.",
  FRANCHISOR_ACCOUNT_INVALID:
    "A conta da franqueadora precisa existir no plano e receber lançamento.",
  LABEL_REQUIRED: "Dê um nome à taxa.",
  INVALID_KIND: "Escolha se a taxa é percentual ou valor fixo.",
};

function explain(raw: string): string | null {
  for (const [code, message] of Object.entries(LOCAL_ERRORS)) {
    if (raw.includes(code)) return message;
  }
  return financeErrorMessage(raw);
}

async function requireNetworkAdmin() {
  const session = await getSessionContext();
  return canConfigureFinanceNetwork(session) ? session : null;
}

// ---------------------------------------------------------------------------
// O CATÁLOGO
// ---------------------------------------------------------------------------

/** Cadastrar ou editar uma taxa do catálogo. */
export async function saveFeeType(input: {
  key: string | null;
  label: string;
  kind: NetworkFeeKind;
  unitAccount: string;
  franchisorAccount: string;
  active: boolean;
  sortOrder: number;
  note: string;
}): Promise<Result> {
  const session = await requireNetworkAdmin();
  if (!session) return { ok: false, error: DENIED };

  // Taxa nova ganha a chave a partir do nome; taxa existente mantém a dela —
  // trocar a chave desligaria o histórico do cadastro.
  const key = input.key ?? slugifyFeeKey(input.label);
  if (!key) return { ok: false, error: "Dê um nome à taxa." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_network_fee_type", {
    p_key: key,
    p_label: input.label,
    p_kind: input.kind,
    p_unit_account: input.unitAccount,
    p_franchisor_account: input.franchisorAccount,
    p_active: input.active,
    p_sort_order: input.sortOrder,
    p_note: input.note,
  });
  if (error) {
    console.error("save_network_fee_type failed:", error.message);
    return { ok: false, error: explain(error.message) ?? "Não foi possível salvar a taxa." };
  }

  await logAudit({
    action: input.key ? "update" : "create",
    entityType: "network_fee_type",
    entityId: key,
  });
  revalidatePath("/financeiro/taxas-da-rede");
  return { ok: true };
}

/** Excluir uma taxa do catálogo — só se nunca cobrou. */
export async function deleteFeeType(input: { key: string }): Promise<Result> {
  const session = await requireNetworkAdmin();
  if (!session) return { ok: false, error: DENIED };

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_network_fee_type", {
    p_key: input.key,
  });
  if (error) {
    console.error("delete_network_fee_type failed:", error.message);
    return { ok: false, error: explain(error.message) ?? "Não foi possível excluir." };
  }

  await logAudit({
    action: "update",
    entityType: "network_fee_type_delete",
    entityId: input.key,
  });
  revalidatePath("/financeiro/taxas-da-rede");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// AS REGRAS (padrão da rede e acordo por unidade)
// ---------------------------------------------------------------------------

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
  const session = await requireNetworkAdmin();
  if (!session) return { ok: false, error: DENIED };

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
    return { ok: false, error: explain(error.message) ?? "Não foi possível salvar." };
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
  const session = await requireNetworkAdmin();
  if (!session) return { ok: false, error: DENIED };

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

// ---------------------------------------------------------------------------
// AS CAMPANHAS
// ---------------------------------------------------------------------------

export async function saveCampaign(input: {
  id: string | null;
  name: string;
  clinicId: string | null;
  /** Taxas alcançadas. Vazio = todas. */
  fees: string[];
  startsOn: string;
  endsOn: string;
  mode: CampaignMode;
  percent: number | null;
  amountCents: number | null;
  discountPercent: number | null;
  note: string;
  active: boolean;
}): Promise<Result> {
  const session = await requireNetworkAdmin();
  if (!session) return { ok: false, error: DENIED };

  const errors = campaignErrors(input);
  if (errors.length > 0) return { ok: false, error: errors[0] };

  const supabase = await createClient();
  const row = {
    name: input.name.trim(),
    clinic_id: input.clinicId,
    // Nenhuma escolhida = todas. Guardar lista vazia daria no mesmo para o
    // banco, mas nulo diz a intenção sem depender de interpretar o vazio.
    fees: input.fees.length > 0 ? input.fees : null,
    starts_on: input.startsOn,
    ends_on: input.endsOn,
    mode: input.mode,
    percent: input.mode === "valor" ? input.percent : null,
    amount_cents: input.mode === "valor" ? input.amountCents : null,
    discount_percent: input.mode === "desconto" ? input.discountPercent : null,
    note: input.note.trim() || null,
    active: input.active,
  };

  const { error } = input.id
    ? await supabase
        .from("network_fee_campaigns")
        .update(row)
        .eq("id", input.id)
    : await supabase
        .from("network_fee_campaigns")
        .insert({ ...row, created_by: session.userId });

  if (error) {
    console.error("saveCampaign failed:", error.message);
    return { ok: false, error: explain(error.message) ?? "Não foi possível salvar a campanha." };
  }

  await logAudit({
    action: input.id ? "update" : "create",
    entityType: "network_fee_campaign",
    entityId: input.id ?? input.name,
    clinicId: input.clinicId ?? undefined,
  });
  revalidatePath("/financeiro/taxas-da-rede");
  return { ok: true };
}

/**
 * Campanha se APAGA, não se desfaz.
 *
 * Apagar não mexe no que já foi cobrado: o percentual fica congelado em cada
 * baixa. Some daqui para frente, e é isso que se espera de uma campanha
 * cancelada no meio.
 */
export async function deleteCampaign(input: { id: string }): Promise<Result> {
  const session = await requireNetworkAdmin();
  if (!session) return { ok: false, error: DENIED };

  const supabase = await createClient();
  const { error } = await supabase
    .from("network_fee_campaigns")
    .delete()
    .eq("id", input.id);
  if (error) {
    console.error("deleteCampaign failed:", error.message);
    return { ok: false, error: "Não foi possível excluir a campanha." };
  }

  await logAudit({
    action: "update",
    entityType: "network_fee_campaign_delete",
    entityId: input.id,
  });
  revalidatePath("/financeiro/taxas-da-rede");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// AS TAXAS FIXAS DO MÊS
// ---------------------------------------------------------------------------

export async function chargeFixedFeesNow(input: {
  year: number;
  month: number;
}): Promise<Result> {
  const session = await requireNetworkAdmin();
  if (!session) return { ok: false, error: DENIED };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("charge_fixed_network_fees", {
    p_year: input.year,
    p_month: input.month,
  });
  if (error) {
    console.error("charge_fixed_network_fees failed:", error.message);
    return {
      ok: false,
      error: explain(error.message) ?? "Não foi possível gerar as taxas fixas.",
    };
  }

  revalidatePath("/financeiro/taxas-da-rede");
  return { ok: true, count: Number(data ?? 0) };
}
