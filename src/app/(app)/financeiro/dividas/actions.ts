"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import {
  debtToPayload,
  faltaNoCadastro,
  type DebtForm,
  type ManualStage,
} from "@/lib/finance/dividas";

// LEVANTAMENTO DE DÍVIDAS (0404) — as ações. Toda gravação passa por uma
// porta do banco (`debt_*`), que confere quem pode; aqui só se traduz a
// resposta. A auditoria campo a campo é do banco (`audit_changes`); o
// `logAudit` registra só o ato, com ids (LGPD).

type Result = { ok: boolean; error?: string; id?: string };

function refresh(id?: string) {
  revalidatePath("/financeiro/dividas");
  if (id) revalidatePath(`/financeiro/dividas/${id}`);
}

/** As recusas das portas já vêm em português; o resto vira genérico. */
function mensagem(error: { code?: string; message?: string }, padrao: string): string {
  return error.code === "P0001" && error.message ? error.message : padrao;
}

export async function salvarDivida(form: DebtForm, sugerida: "A" | "B" | null): Promise<Result> {
  await getSessionContext();
  const falta = faltaNoCadastro(form, sugerida);
  if (falta) return { ok: false, error: falta };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("debt_save", { p: debtToPayload(form) });
  if (error) {
    console.error("salvarDivida failed:", error.message);
    return { ok: false, error: mensagem(error, "Não foi possível salvar a dívida.") };
  }
  const id = String(data);
  await logAudit({ action: form.id ? "update" : "create", entityType: "debt", entityId: id });
  refresh(id);
  return { ok: true, id };
}

export async function excluirDivida(id: string, motivo: string): Promise<Result> {
  await getSessionContext();
  if (motivo.trim().length < 5) return { ok: false, error: "Escreva o motivo da exclusão." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("debt_delete", { p_id: id, p_reason: motivo });
  if (error) {
    console.error("excluirDivida failed:", error.message);
    return { ok: false, error: mensagem(error, "Não foi possível excluir a dívida.") };
  }
  // Exclusão LÓGICA: para a trilha é uma alteração da dívida.
  await logAudit({ action: "update", entityType: "debt_delete", entityId: id });
  refresh(id);
  return { ok: true };
}

export async function mudarEtapa(id: string, etapa: ManualStage | null, motivo: string): Promise<Result> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("debt_set_stage", { p_id: id, p_stage: etapa ?? "", p_reason: motivo });
  if (error) {
    console.error("mudarEtapa failed:", error.message);
    return { ok: false, error: mensagem(error, "Não foi possível mudar a situação.") };
  }
  await logAudit({ action: "update", entityType: "debt_stage", entityId: id });
  refresh(id);
  return { ok: true };
}

export async function criarEtiqueta(nome: string): Promise<Result> {
  await getSessionContext();
  if (!nome.trim()) return { ok: false, error: "Dê um nome à etiqueta." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("debt_save_tag", { p: { name: nome } });
  if (error) return { ok: false, error: mensagem(error, "Não foi possível criar a etiqueta.") };
  refresh();
  return { ok: true, id: String(data) };
}

export async function salvarEtiqueta(input: { id: string; name: string; color: string | null; active: boolean }): Promise<Result> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("debt_save_tag", { p: input });
  if (error) return { ok: false, error: mensagem(error, "Não foi possível salvar a etiqueta.") };
  refresh();
  return { ok: true };
}

export async function salvarGrupo(input: {
  id: string | null;
  clinic_id: string;
  supplier_id: string;
  label: string;
  contract_number: string;
  notes: string;
}): Promise<Result> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("debt_save_group", { p: input });
  if (error) return { ok: false, error: mensagem(error, "Não foi possível salvar o grupo.") };
  refresh();
  return { ok: true, id: String(data) };
}

export async function salvarContato(input: {
  id: string | null;
  supplier_id: string;
  kind: string;
  organization: string;
  person_name: string;
  phone: string;
  whatsapp: string;
  email: string;
  notes: string;
  active: boolean;
}): Promise<Result> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("debt_save_creditor_contact", { p: input });
  if (error) return { ok: false, error: mensagem(error, "Não foi possível salvar o contato.") };
  refresh();
  return { ok: true, id: String(data) };
}

export async function salvarCategoria(input: {
  id: string | null;
  parent_id: string | null;
  name: string;
  nature_code: string | null;
  opening_account_code: string | null;
  expense_account_code: string | null;
  sort_order: number;
  active: boolean;
}): Promise<Result> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("debt_save_category", { p: input });
  if (error) return { ok: false, error: mensagem(error, "Não foi possível salvar a categoria.") };
  await logAudit({ action: input.id ? "update" : "create", entityType: "debt_category", entityId: String(data) });
  refresh();
  return { ok: true, id: String(data) };
}

export async function salvarNatureza(input: { code: string | null; label: string; sort_order: number; active: boolean }): Promise<Result> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("debt_save_nature", { p: input });
  if (error) return { ok: false, error: mensagem(error, "Não foi possível salvar a natureza.") };
  refresh();
  return { ok: true };
}

export async function salvarRegra(clinicId: string | null, regra: Record<string, unknown>): Promise<Result> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("debt_save_settings", { p_clinic_id: clinicId, p: regra });
  if (error) return { ok: false, error: mensagem(error, "Não foi possível salvar a regra.") };
  refresh();
  return { ok: true };
}

export async function voltarARegraDaRede(clinicId: string): Promise<Result> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("debt_reset_settings", { p_clinic_id: clinicId });
  if (error) return { ok: false, error: mensagem(error, "Não foi possível voltar à regra da rede.") };
  refresh();
  return { ok: true };
}

export async function salvarPrazoPorTipo(tipo: string, dias: number | null): Promise<Result> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("debt_save_default_rule", { p_supplier_kind: tipo, p_days: dias });
  if (error) return { ok: false, error: mensagem(error, "Não foi possível salvar o prazo.") };
  refresh();
  return { ok: true };
}

export async function salvarImplantacao(clinicId: string, data: string | null): Promise<Result> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("debt_set_go_live", { p_clinic_id: clinicId, p_date: data });
  if (error) return { ok: false, error: mensagem(error, "Não foi possível salvar a data de implantação.") };
  refresh();
  return { ok: true };
}

export type LinhaDoHistorico = {
  source: "trilha" | "evento";
  occurredAt: string;
  userName: string | null;
  actor: string;
  tableName: string | null;
  op: "I" | "U" | "D" | null;
  changes: Record<string, unknown> | null;
  eventKind: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
};

export async function carregarHistorico(id: string): Promise<{ ok: boolean; linhas: LinhaDoHistorico[]; error?: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("debt_history", { p_debt_id: id });
  if (error) {
    console.error("carregarHistorico failed:", error.message);
    return { ok: false, linhas: [], error: "Não foi possível ler o histórico." };
  }
  return {
    ok: true,
    linhas: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      source: r.source === "evento" ? "evento" : "trilha",
      occurredAt: String(r.occurred_at),
      userName: (r.user_name as string | null) ?? null,
      actor: String(r.actor ?? "usuario"),
      tableName: (r.table_name as string | null) ?? null,
      op: (r.op as "I" | "U" | "D" | null) ?? null,
      changes: (r.changes as Record<string, unknown> | null) ?? null,
      eventKind: (r.event_kind as string | null) ?? null,
      fromStatus: (r.from_status as string | null) ?? null,
      toStatus: (r.to_status as string | null) ?? null,
      note: (r.note as string | null) ?? null,
    })),
  };
}

// ------------------------------------------------------------- fase 2 (0405)

async function porta(fn: string, args: Record<string, unknown>, padrao: string, refazer?: string): Promise<Result> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.error(`${fn} failed:`, error.message);
    return { ok: false, error: mensagem(error, padrao) };
  }
  refresh(refazer);
  return { ok: true, id: data === null || data === undefined ? undefined : String(data) };
}

export async function salvarNegativacao(debtId: string, p: Record<string, unknown>): Promise<Result> {
  return porta("debt_save_negativation", { p }, "Não foi possível salvar a negativação.", debtId);
}

export async function salvarProtesto(debtId: string, p: Record<string, unknown>): Promise<Result> {
  return porta("debt_save_protest", { p }, "Não foi possível salvar o protesto.", debtId);
}

export async function salvarAcaoJudicial(debtId: string, p: Record<string, unknown>): Promise<Result> {
  return porta("debt_save_lawsuit", { p }, "Não foi possível salvar a ação judicial.", debtId);
}

export async function salvarNotificacao(debtId: string, p: Record<string, unknown>): Promise<Result> {
  return porta("debt_save_notice", { p }, "Não foi possível salvar a notificação.", debtId);
}

export async function salvarCartorio(p: Record<string, unknown>): Promise<Result> {
  return porta("debt_save_notary_office", { p }, "Não foi possível salvar o cartório.");
}

export async function removerRegistro(
  debtId: string,
  tipo: "negativacao" | "protesto" | "acao_judicial" | "notificacao" | "anexo",
  id: string,
  motivo: string
): Promise<Result> {
  if (motivo.trim().length < 5) return { ok: false, error: "Escreva o motivo da remoção." };
  return porta("debt_remove_record", { p_kind: tipo, p_id: id, p_reason: motivo }, "Não foi possível remover.", debtId);
}

export async function registrarProposta(debtId: string, p: Record<string, unknown>): Promise<Result> {
  const r = await porta("debt_save_proposal", { p }, "Não foi possível registrar a proposta.", debtId);
  if (r.ok && r.id) await logAudit({ action: "create", entityType: "debt_proposal", entityId: r.id });
  return r;
}

export async function mudarSituacaoDaProposta(
  debtId: string,
  id: string,
  situacao: "recusada" | "expirada",
  motivo: string
): Promise<Result> {
  return porta("debt_set_proposal_status", { p_id: id, p_status: situacao, p_reason: motivo }, "Não foi possível mudar a proposta.", debtId);
}

export async function registrarContato(debtId: string, p: Record<string, unknown>): Promise<Result> {
  return porta("debt_log_contact", { p }, "Não foi possível registrar o contato.", debtId);
}

export async function marcarConferida(debtId: string, data: string | null): Promise<Result> {
  return porta("debt_mark_checked", { p_debt_id: debtId, p_date: data }, "Não foi possível marcar a conferência.", debtId);
}

/** Registra o arquivo que o navegador já enviou para a pasta `dividas`. */
export async function registrarAnexo(debtId: string, p: Record<string, unknown>): Promise<Result> {
  const r = await porta("debt_attach", { p: { ...p, debt_id: debtId } }, "Não foi possível registrar o anexo.", debtId);
  if (r.ok && r.id) await logAudit({ action: "create", entityType: "debt_attachment", entityId: r.id });
  return r;
}

/**
 * Link de uso curto (10 min) para abrir um anexo. Gerado com a sessão da
 * pessoa: a regra da pasta só entrega o arquivo de dívida que ela vê.
 */
export async function linkDoAnexo(anexoId: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data: a, error } = await supabase.from("debt_attachments").select("path, debt_id").eq("id", anexoId).maybeSingle();
  if (error || !a) return { ok: false, error: "Anexo não encontrado." };
  const { data, error: e2 } = await supabase.storage.from("dividas").createSignedUrl(a.path as string, 600);
  if (e2 || !data) {
    console.error("linkDoAnexo failed:", e2?.message);
    return { ok: false, error: "Não foi possível abrir o anexo." };
  }
  await logAudit({ action: "view", entityType: "debt_attachment", entityId: anexoId });
  return { ok: true, url: data.signedUrl };
}
