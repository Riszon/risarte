"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { canConfigureFinanceNetwork } from "@/lib/finance/access";
import {
  rateErrors,
  type AcquirerScope,
  type CardModality,
  type FeeChargeMoment,
} from "@/lib/finance/acquirers";

export type AcquirerResult = { ok: boolean; error?: string };

function refresh() {
  revalidatePath("/financeiro/adquirentes");
  revalidatePath("/financeiro/conciliacao");
}

export async function saveAcquirer(input: {
  id: string | null;
  clinicId: string;
  scope: AcquirerScope;
  /** Unidades atendidas quando o escopo é "unidades". */
  clinicIds: string[];
  name: string;
  isDefault: boolean;
  notes: string;
  active: boolean;
}): Promise<AcquirerResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  if (!input.name.trim()) return { ok: false, error: "Informe o nome." };

  // Cadastro que vale para outras unidades é ato da FRANQUEADORA. A RLS já
  // barra, mas aqui a mensagem é legível.
  if (input.scope !== "unidade" && !canConfigureFinanceNetwork(session)) {
    return {
      ok: false,
      error: "Só a Franqueadora cadastra adquirente para a rede.",
    };
  }
  if (input.scope === "unidades" && input.clinicIds.length === 0) {
    return { ok: false, error: "Escolha ao menos uma unidade." };
  }

  const ownerClinic = input.scope === "unidade" ? input.clinicId : null;

  // Só uma padrão por unidade — e uma da rede (índices únicos no banco).
  if (input.isDefault) {
    let q = supabase
      .from("card_acquirers")
      .update({ is_default: false })
      .eq("is_default", true);
    q = ownerClinic
      ? q.eq("clinic_id", ownerClinic)
      : q.is("clinic_id", null);
    if (input.id) q = q.neq("id", input.id);
    await q;
  }

  const row = {
    clinic_id: ownerClinic,
    scope: input.scope,
    name: input.name.trim(),
    is_default: input.isDefault,
    notes: input.notes || null,
    active: input.active,
    updated_at: new Date().toISOString(),
    updated_by: session.userId,
  };

  let acquirerId = input.id;
  if (input.id) {
    const { error } = await supabase
      .from("card_acquirers")
      .update(row)
      .eq("id", input.id);
    if (error) {
      console.error("saveAcquirer failed:", error.message);
      return { ok: false, error: "Não foi possível salvar a adquirente." };
    }
  } else {
    const { data, error } = await supabase
      .from("card_acquirers")
      .insert({ ...row, created_by: session.userId })
      .select("id")
      .single();
    if (error || !data) {
      console.error("saveAcquirer failed:", error?.message);
      return { ok: false, error: "Não foi possível salvar a adquirente." };
    }
    acquirerId = data.id as string;
  }

  // A lista de unidades atendidas é reescrita por inteiro: é a forma simples de
  // refletir exatamente o que ficou marcado na tela.
  if (acquirerId) {
    await supabase
      .from("card_acquirer_clinics")
      .delete()
      .eq("acquirer_id", acquirerId);
    if (input.scope === "unidades" && input.clinicIds.length > 0) {
      const { error } = await supabase.from("card_acquirer_clinics").insert(
        input.clinicIds.map((clinicId) => ({
          acquirer_id: acquirerId,
          clinic_id: clinicId,
        }))
      );
      if (error) {
        console.error("saveAcquirerClinics failed:", error.message);
        return {
          ok: false,
          error: "A adquirente foi salva, mas as unidades não.",
        };
      }
    }
  }

  await logAudit({
    action: input.id ? "update" : "create",
    entityType: "card_acquirer",
    entityId: acquirerId ?? input.clinicId,
  });
  refresh();
  return { ok: true };
}

/**
 * FIN4b — faixa de taxa com VIGÊNCIA. Renegociar a taxa não reescreve o que já
 * foi recebido: cria-se uma linha nova valendo a partir da data acordada.
 *
 * A edição existe para CONSERTAR ERRO DE DIGITAÇÃO (0199). Quando a taxa mudou
 * de verdade, o caminho é encerrar a vigência desta e cadastrar outra — a tela
 * avisa quando a faixa já precificou recebimentos.
 */
export async function saveRate(input: {
  id: string | null;
  acquirerId: string;
  modality: CardModality;
  minInstallments: number;
  maxInstallments: number;
  feePercent: number;
  fixedFeeCents: number;
  settlementDays: number;
  settlementBusinessDays: boolean;
  freeMonthlyCount: number | null;
  feeChargedOn: FeeChargeMoment;
  validFrom: string;
  validTo: string | null;
}): Promise<AcquirerResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  const errors = rateErrors(input);
  if (errors.length > 0) return { ok: false, error: errors[0] };

  const row = {
    acquirer_id: input.acquirerId,
    modality: input.modality,
    min_installments: input.minInstallments,
    max_installments: input.maxInstallments,
    fee_percent: input.feePercent,
    fixed_fee_cents: Math.round(input.fixedFeeCents),
    settlement_days: input.settlementDays,
    settlement_business_days: input.settlementBusinessDays,
    free_monthly_count: input.freeMonthlyCount,
    fee_charged_on: input.feeChargedOn,
    valid_from: input.validFrom,
    valid_to: input.validTo,
  };

  const { error } = input.id
    ? await supabase.from("acquirer_rates").update(row).eq("id", input.id)
    : await supabase
        .from("acquirer_rates")
        .insert({ ...row, created_by: session.userId });
  if (error) {
    console.error("saveRate failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a taxa." };
  }

  await logAudit({
    action: input.id ? "update" : "create",
    entityType: "acquirer_rate",
    entityId: input.id ?? input.acquirerId,
  });
  refresh();
  return { ok: true };
}

/** Encerra a vigência — o caminho certo quando a taxa mudou de verdade. */
export async function closeRate(input: {
  id: string;
  validTo: string;
}): Promise<AcquirerResult> {
  await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase
    .from("acquirer_rates")
    .update({ valid_to: input.validTo })
    .eq("id", input.id);
  if (error) {
    console.error("closeRate failed:", error.message);
    return { ok: false, error: "Não foi possível encerrar a vigência." };
  }

  await logAudit({
    action: "update",
    entityType: "acquirer_rate_close",
    entityId: input.id,
  });
  refresh();
  return { ok: true };
}

export async function deleteRate(input: {
  id: string;
}): Promise<AcquirerResult> {
  await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase
    .from("acquirer_rates")
    .delete()
    .eq("id", input.id);
  if (error) {
    console.error("deleteRate failed:", error.message);
    // Gatilho do banco (0199): faixa que já precificou recebimentos não é
    // apagada — apagá-la deixaria sem explicação números que já foram ao razão.
    if (error.message.includes("RATE_IN_USE")) {
      return {
        ok: false,
        error:
          "Esta faixa já precificou recebimentos e não pode ser apagada. Encerre a vigência dela.",
      };
    }
    return { ok: false, error: "Não foi possível remover a taxa." };
  }

  await logAudit({
    action: "update",
    entityType: "acquirer_rate_delete",
    entityId: input.id,
  });
  refresh();
  return { ok: true };
}
