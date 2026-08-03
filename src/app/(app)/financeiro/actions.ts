"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { isValidAccountCode } from "@/lib/finance/accounts";
import { canConfigureFinanceNetwork } from "@/lib/finance/access";

export type FinanceResult = { ok: boolean; error?: string };

/**
 * FIN0 — configuração financeira em cascata (padrão da rede + override por
 * unidade). `clinicId` nulo grava o padrão da REDE.
 *
 * O teto de 2% da multa também é validado no banco (check constraint): é limite
 * do art. 52, §1º do CDC para contrato de consumo parcelado.
 */
export async function saveFinanceSettings(input: {
  clinicId: string | null;
  lateFeePercent: number;
  monthlyInterestPercent: number;
  graceDays: number;
  roundingMode: "half_up" | "half_even";
}): Promise<FinanceResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  if (input.lateFeePercent < 0 || input.lateFeePercent > 2) {
    return {
      ok: false,
      error: "A multa não pode passar de 2% (limite do Código de Defesa do Consumidor).",
    };
  }
  if (input.monthlyInterestPercent < 0 || input.monthlyInterestPercent > 100) {
    return { ok: false, error: "Juros ao mês inválido." };
  }
  if (!Number.isInteger(input.graceDays) || input.graceDays < 0) {
    return { ok: false, error: "A carência precisa ser um número de dias." };
  }

  const { error } = await supabase.from("finance_settings").upsert(
    {
      clinic_id: input.clinicId,
      late_fee_percent: input.lateFeePercent,
      monthly_interest_percent: input.monthlyInterestPercent,
      grace_days: input.graceDays,
      rounding_mode: input.roundingMode,
      updated_at: new Date().toISOString(),
      updated_by: session.userId,
    },
    { onConflict: "clinic_id" }
  );
  if (error) {
    console.error("saveFinanceSettings failed:", error.message);
    if (error.message.includes("row-level security")) {
      return {
        ok: false,
        error: "Apenas Admin Master e Financeiro da Franqueadora configuram isso.",
      };
    }
    return { ok: false, error: "Não foi possível salvar a configuração." };
  }

  await logAudit({
    action: "update",
    entityType: "finance_settings",
    entityId: input.clinicId ?? "network",
    clinicId: input.clinicId ?? undefined,
  });
  revalidatePath("/financeiro/configuracao");
  return { ok: true };
}

/** FIN0: remove o override da unidade — ela volta a seguir o padrão da rede. */
export async function clearFinanceSettings(
  clinicId: string
): Promise<FinanceResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase
    .from("finance_settings")
    .delete()
    .eq("clinic_id", clinicId);
  if (error) {
    console.error("clearFinanceSettings failed:", error.message);
    return { ok: false, error: "Não foi possível voltar ao padrão da rede." };
  }
  await logAudit({
    action: "update",
    entityType: "finance_settings",
    entityId: clinicId,
    clinicId,
  });
  revalidatePath("/financeiro/configuracao");
  return { ok: true };
}

/**
 * FIN0 — cria centro de custo. A unidade só cria como FILHO de um centro da
 * REDE (a trava real está no banco: PARENT_MUST_BE_NETWORK).
 */
export async function createCostCenter(input: {
  code: string;
  name: string;
  parentId: string | null;
  scope: "franchisor" | "network" | "unit";
  clinicId: string | null;
}): Promise<FinanceResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  // A árvore é da REDE: só a Franqueadora cria centro (decisão do dono,
  // 31/07/2026). A RLS da 0186 é a barreira real; isto é a mensagem amigável.
  if (!canConfigureFinanceNetwork(session)) {
    return {
      ok: false,
      error:
        "Centros de custo são definidos pela Franqueadora — é o que mantém as unidades comparáveis. Peça a criação a ela.",
    };
  }

  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!code) return { ok: false, error: "Informe o código do centro." };
  if (!name) return { ok: false, error: "Informe o nome do centro." };
  if (input.scope === "unit" && !input.clinicId) {
    return { ok: false, error: "Centro da unidade precisa de uma unidade." };
  }

  const { error } = await supabase.from("cost_centers").insert({
    code,
    name,
    parent_id: input.parentId,
    scope: input.scope,
    clinic_id: input.scope === "unit" ? input.clinicId : null,
    created_by: session.userId,
    updated_by: session.userId,
  });
  if (error) {
    const m = error.message;
    if (m.includes("PARENT_MUST_BE_NETWORK")) {
      return {
        ok: false,
        error:
          "Centro da unidade precisa ficar dentro de um centro padrão da rede — é o que mantém a comparação entre unidades.",
      };
    }
    if (m.includes("PARENT_REQUIRED")) {
      return { ok: false, error: "Escolha o centro da rede que será o pai." };
    }
    if (m.includes("duplicate key")) {
      return { ok: false, error: "Já existe um centro com esse código." };
    }
    console.error("createCostCenter failed:", m);
    return { ok: false, error: "Não foi possível criar o centro de custo." };
  }

  await logAudit({
    action: "create",
    entityType: "cost_center",
    entityId: code,
    clinicId: input.clinicId ?? undefined,
  });
  revalidatePath("/financeiro/centros-de-custo");
  return { ok: true };
}

/**
 * FIN0 — renomeia ou ativa/desativa. O CÓDIGO nunca muda (trava no banco) e
 * centro com lançamento não é excluído: some da lista ao ser desativado.
 */
export async function updateCostCenter(input: {
  id: string;
  name?: string;
  active?: boolean;
}): Promise<FinanceResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  if (!canConfigureFinanceNetwork(session)) {
    return {
      ok: false,
      error: "Centros de custo são definidos pela Franqueadora.",
    };
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: session.userId,
  };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { ok: false, error: "Informe o nome do centro." };
    patch.name = name;
  }
  if (input.active !== undefined) patch.active = input.active;

  const { error } = await supabase
    .from("cost_centers")
    .update(patch)
    .eq("id", input.id);
  if (error) {
    if (error.message.includes("CODE_IMMUTABLE")) {
      return { ok: false, error: "O código do centro não pode ser alterado." };
    }
    console.error("updateCostCenter failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o centro de custo." };
  }

  await logAudit({
    action: "update",
    entityType: "cost_center",
    entityId: input.id,
  });
  revalidatePath("/financeiro/centros-de-custo");
  return { ok: true };
}

/** FIN0 — ajusta as flags gerenciais de uma conta (fixo/variável, de-para). */
export async function updateChartAccount(input: {
  code: string;
  costBehavior?: "fixed" | "variable" | "none";
  /** Onde a conta vale — corrigível na tela (ex.: receita que é da matriz). */
  scope?: "unit" | "franchisor" | "both";
  fiscalAccountCode?: string | null;
  active?: boolean;
}): Promise<FinanceResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  if (!isValidAccountCode(input.code)) {
    return { ok: false, error: "Código de conta inválido." };
  }
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: session.userId,
  };
  if (input.costBehavior !== undefined) patch.cost_behavior = input.costBehavior;
  if (input.scope !== undefined) patch.scope = input.scope;
  if (input.fiscalAccountCode !== undefined) {
    patch.fiscal_account_code = input.fiscalAccountCode?.trim() || null;
  }
  if (input.active !== undefined) patch.active = input.active;

  const { error } = await supabase
    .from("chart_of_accounts")
    .update(patch)
    .eq("code", input.code);
  if (error) {
    console.error("updateChartAccount failed:", error.message);
    if (error.message.includes("row-level security")) {
      return {
        ok: false,
        error: "Apenas Admin Master e Financeiro da Franqueadora editam o plano de contas.",
      };
    }
    return { ok: false, error: "Não foi possível salvar a conta." };
  }

  await logAudit({
    action: "update",
    entityType: "chart_account",
    entityId: input.code,
  });
  revalidatePath("/financeiro/plano-de-contas");
  return { ok: true };
}
