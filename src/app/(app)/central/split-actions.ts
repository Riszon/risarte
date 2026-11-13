"use server";

// As ações da aba Taxas da franquia (ASA3, entrega 1; 4008). O BANCO decide de
// verdade: a porta `gateway_split_save` confere quem pode (Admin Master e
// Financeiro da Franqueadora) e que o destino é uma carteira de repasse.

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { podeEditarRegua } from "@/lib/central/central";

export type ResultadoDoSplit = { ok: boolean; error?: string };

export type ConfiguracaoDoSplit = {
  toleranciaCentavos: number;
  multaPercent: number | null;
  jurosPercent: number | null;
  destinos: { fee: string; accountId: string | null }[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function percentOuBranco(v: number | null): number | null | "erro" {
  if (v == null) return null;
  if (!Number.isFinite(v) || v < 0 || v > 100) return "erro";
  return Math.round(v * 1e4) / 1e4;
}

export async function salvarConfiguracaoDoSplit(cfg: ConfiguracaoDoSplit): Promise<ResultadoDoSplit> {
  const session = await getSessionContext();
  if (!podeEditarRegua(session)) return { ok: false, error: "Só o Admin Master e o Financeiro da Franqueadora mexem aqui." };
  const tol = Math.round(Number(cfg.toleranciaCentavos));
  if (!Number.isFinite(tol) || tol < 0 || tol > 1000) return { ok: false, error: "A tolerância vai de R$ 0,00 a R$ 10,00." };
  const multa = percentOuBranco(cfg.multaPercent);
  const juros = percentOuBranco(cfg.jurosPercent);
  if (multa === "erro" || juros === "erro") return { ok: false, error: "Multa e juros vão de 0 a 100%, ou em branco." };
  const destinos = (cfg.destinos ?? []).map((d) => ({
    fee: String(d.fee).slice(0, 40),
    accountId: d.accountId && UUID.test(d.accountId) ? d.accountId : null,
  }));
  const supabase = await createClient();
  const { error } = await supabase.rpc("gateway_split_save", {
    p_tolerance_cents: tol,
    p_fine_percent: multa,
    p_interest_percent: juros,
    p_destinos: destinos,
  });
  if (error) {
    if (/DESTINATION_INVALID/.test(error.message)) return { ok: false, error: "O destino precisa ser a conta raiz ou uma carteira de repasse ativa." };
    if (/NOT_ALLOWED/.test(error.message)) return { ok: false, error: "Só o Admin Master e o Financeiro da Franqueadora mexem aqui." };
    console.error("gateway split save failed:", error.message);
    return { ok: false, error: "Não foi possível gravar. Tente de novo." };
  }
  revalidatePath("/central", "layout");
  return { ok: true };
}

// ---- ASA3, entrega 2 (4009) -------------------------------------------------------

const UUID_UNIDADE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResultadoDoAtualizar = ResultadoDoSplit & { conferidas?: number; alteradas?: number; falharam?: number };

/**
 * U8 — "Atualizar agora": confere a unidade (põe na fila o que mudou) e roda a
 * fila dela na hora. Admin Master e Financeiro da Franqueadora. Cada uso vai
 * para a auditoria (ajuste 6).
 */
export async function atualizarSplitAgora(clinicId: string): Promise<ResultadoDoAtualizar> {
  const session = await getSessionContext();
  if (!podeEditarRegua(session)) return { ok: false, error: "Só o Admin Master e o Financeiro da Franqueadora atualizam a fila." };
  if (!UUID_UNIDADE.test(clinicId)) return { ok: false, error: "Unidade não encontrada." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("gateway_split_run_check", { p_clinic_id: clinicId });
  if (error) return { ok: false, error: /NOT_ALLOWED/.test(error.message) ? "Sem permissão." : "Não foi possível conferir a unidade." };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { rodarFilaDoSplit } = await import("@/lib/asaas/split-servidor");
  const admin = createAdminClient();
  await admin.rpc("_gateway_split_enqueue", { p_clinic_id: clinicId, p_reason: "manual" });
  const r = await rodarFilaDoSplit({ clinicId, actorId: session.userId });
  await admin.rpc("_gateway_split_log_run", {
    p_actor: session.userId,
    p_clinic_id: clinicId,
    p_changed: r.alteradas,
    p_checked: r.conferidas,
  });
  revalidatePath("/central", "layout");
  return { ok: true, conferidas: r.conferidas, alteradas: r.alteradas, falharam: r.falharam };
}

/** U4 — todas as taxas em zero: o Financeiro ou o Admin confirma tirar o split. */
export async function confirmarSplitEmZero(clinicId: string, motivo: string): Promise<ResultadoDoSplit> {
  const session = await getSessionContext();
  if (!podeEditarRegua(session)) return { ok: false, error: "Só o Admin Master e o Financeiro da Franqueadora confirmam." };
  if (!UUID_UNIDADE.test(clinicId)) return { ok: false, error: "Unidade não encontrada." };
  if (String(motivo ?? "").trim().length < 5) return { ok: false, error: "Escreva o motivo (a isenção ou a campanha registrada)." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("gateway_split_zero_confirm", { p_clinic_id: clinicId, p_reason: String(motivo).slice(0, 300) });
  if (error) return { ok: false, error: "Não foi possível confirmar." };
  revalidatePath("/central", "layout");
  return { ok: true };
}

/** 18.7.4 — o saldo mínimo da franqueadora (em branco = sem aviso). */
export async function salvarSaldoMinimo(centavos: number | null): Promise<ResultadoDoSplit> {
  const session = await getSessionContext();
  if (!podeEditarRegua(session)) return { ok: false, error: "Só o Admin Master e o Financeiro da Franqueadora mexem aqui." };
  const v = centavos == null ? null : Math.round(Number(centavos));
  if (v != null && (!Number.isFinite(v) || v < 0)) return { ok: false, error: "O saldo mínimo não pode ser negativo." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("gateway_split_min_balance_set", { p_min_cents: v });
  if (error) return { ok: false, error: "Não foi possível gravar." };
  revalidatePath("/central", "layout");
  return { ok: true };
}

/** 18.7.1 — quem tem o acesso de autorização do Asaas na unidade (só o Admin Master). */
export async function salvarQuemPedeEstorno(clinicId: string, gerenteTambem: boolean): Promise<ResultadoDoSplit> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: "Só o Admin Master muda quem pede estorno." };
  if (!UUID_UNIDADE.test(clinicId)) return { ok: false, error: "Unidade não encontrada." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("gateway_refund_roles_set", {
    p_clinic_id: clinicId,
    p_roles: gerenteTambem ? ["franchisee", "unit_manager"] : ["franchisee"],
  });
  if (error) return { ok: false, error: "Não foi possível gravar." };
  revalidatePath("/central", "layout");
  return { ok: true };
}
