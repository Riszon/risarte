"use server";

// As ações da Central de Configuração — aba Conta e tarifas (ASA0).
//
// O BANCO decide de verdade: abrir o cadastro, registrar o termo, declarar o
// split, marcar como pronta e desativar são funções guardadas da 4000 e da
// 4002, chamadas COMO a pessoa logada. Gravar a chave é a única que passa pelo
// servidor com a chave de serviço — porque precisa validar a chave no Asaas
// antes de guardá-la no Vault — e o banco confere a permissão de novo.
//
// ⚠️ A CHAVE DE API NUNCA SAI DAQUI: não vai para o registro, para a auditoria
// (`logAudit` só leva o id da conta) nem para a resposta. Depois de gravada,
// nenhuma ação a devolve.

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { isAdminClientConfigured } from "@/lib/supabase/admin";
import {
  criarWebhookDaConta,
  mensagemDoBancoDoGateway,
  removerWebhookDaConta,
  verificarConta,
  vincularConta,
} from "@/lib/asaas/link";
import {
  abaValida,
  podeVerAba,
  podeVerContaDaRede,
  podeVerContaDaUnidade,
  podeVincularContaPelaTela,
} from "@/lib/central/central";

export type Resultado = { ok: boolean; error?: string; aviso?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SO_ADMIN = "Só o Admin Master faz isto.";
const SEM_SERVIDOR = "Este servidor não está configurado para falar com o Asaas (falta a chave de serviço).";

const MENSAGENS: Record<string, string> = {
  NOT_ALLOWED: SO_ADMIN,
  ACCOUNT_ALREADY_EXISTS: "Esta unidade já tem uma conta Asaas cadastrada neste ambiente.",
  OWNER_TYPE_MISMATCH: "O tipo da conta não combina com a unidade.",
  CLINIC_NOT_FOUND: "Unidade não encontrada.",
  ACCOUNT_NOT_FOUND: "Conta não encontrada (ou já desativada).",
  TERM_DATE_INVALID: "A data do termo não pode ser futura.",
  TERM_SIGNER_REQUIRED: "Informe o nome de quem assinou o termo.",
  REASON_REQUIRED: "Diga em poucas palavras por que está desativando.",
  NOT_READY: "Ainda falta item na lista: a unidade não pode ser marcada como pronta.",
  GATEWAY_PRODUCTION_LOCKED: "As contas de produção do Asaas ainda não estão liberadas no riSZon.",
};

function mensagem(error: { message?: string } | null | undefined): string {
  const m = error?.message ?? "";
  for (const [codigo, texto] of Object.entries(MENSAGENS)) if (m.includes(codigo)) return texto;
  return mensagemDoBancoDoGateway(error);
}

/** A conta, lida COMO a pessoa (a regra de linha decide se ela enxerga). */
async function contaVisivel(accountId: string) {
  if (!UUID.test(accountId)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("gateway_accounts")
    .select("id, clinic_id, owner_type, status")
    .eq("id", accountId)
    .maybeSingle<{ id: string; clinic_id: string | null; owner_type: string; status: string }>();
  return data ?? null;
}

const atualizar = () => revalidatePath("/central", "layout");

/** Abre o cadastro da conta Asaas de uma unidade (ou da franqueadora). Sempre de TESTE até a ASA7. */
export async function abrirCadastroDaConta(clinicId: string): Promise<Resultado> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: SO_ADMIN };
  if (!UUID.test(clinicId)) return { ok: false, error: "Unidade inválida." };
  const clinica = session.clinics.find((c) => c.id === clinicId);
  if (!clinica) return { ok: false, error: MENSAGENS.CLINIC_NOT_FOUND };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gateway_create_account", {
    p_clinic_id: clinicId,
    p_owner_type: clinica.type === "franchisor" ? "franchisor" : "unit",
    p_label: clinica.name,
    p_cnpj: null,
    p_environment: "sandbox",
  });
  if (error) return { ok: false, error: mensagem(error) };
  await logAudit({ action: "create", entityType: "gateway_account", entityId: String(data), clinicId });
  atualizar();
  return { ok: true };
}

/** Registra o termo de autorização do franqueado (data, quem assinou, observação). */
export async function registrarTermo(formData: FormData): Promise<Resultado> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: SO_ADMIN };
  const accountId = String(formData.get("account_id") ?? "");
  const conta = await contaVisivel(accountId);
  if (!conta) return { ok: false, error: MENSAGENS.ACCOUNT_NOT_FOUND };
  const assinadoEm = String(formData.get("signed_on") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(assinadoEm)) return { ok: false, error: "Informe a data em que o termo foi assinado." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("gateway_register_term", {
    p_account_id: accountId,
    p_signed_on: assinadoEm,
    p_signed_by_name: String(formData.get("signed_by_name") ?? "").trim().slice(0, 120),
    p_note: String(formData.get("note") ?? "").trim().slice(0, 500) || null,
  });
  if (error) return { ok: false, error: mensagem(error) };
  await logAudit({ action: "update", entityType: "gateway_account_term", entityId: accountId, clinicId: conta.clinic_id ?? undefined });
  atualizar();
  return { ok: true };
}

/** O Admin Master declara que o split está habilitado no painel do Asaas desta conta. */
export async function declararSplit(accountId: string, habilitado: boolean): Promise<Resultado> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: SO_ADMIN };
  const conta = await contaVisivel(accountId);
  if (!conta) return { ok: false, error: MENSAGENS.ACCOUNT_NOT_FOUND };

  const supabase = await createClient();
  const { error } = await supabase.rpc("gateway_declare_split_enabled", { p_account_id: accountId, p_enabled: habilitado });
  if (error) return { ok: false, error: mensagem(error) };
  atualizar();
  return { ok: true };
}

/**
 * GRAVA A CHAVE: valida no Asaas, guarda no Vault, cria o webhook e busca as
 * tarifas. A chave vem do formulário e não é devolvida em lugar nenhum.
 */
export async function gravarChave(formData: FormData): Promise<Resultado> {
  const session = await getSessionContext();
  const accountId = String(formData.get("account_id") ?? "");
  const apiKey = String(formData.get("api_key") ?? "").trim();
  const conta = await contaVisivel(accountId);
  if (!conta) return { ok: false, error: MENSAGENS.ACCOUNT_NOT_FOUND };
  if (!podeVincularContaPelaTela(session, conta.clinic_id)) {
    return { ok: false, error: "Você não tem permissão para gravar a chave desta conta." };
  }
  if (!apiKey) return { ok: false, error: "Cole a chave de API do Asaas." };
  if (!isAdminClientConfigured()) return { ok: false, error: SEM_SERVIDOR };

  const r = await vincularConta({ accountId, apiKey, actorId: session.userId, notifyEmail: session.email });
  if (!r.ok) return { ok: false, error: r.error };

  await logAudit({ action: "update", entityType: "gateway_account_key", entityId: accountId, clinicId: conta.clinic_id ?? undefined });
  atualizar();

  const avisos: string[] = [];
  if (r.webhook === "no_public_url") {
    avisos.push("O webhook NÃO foi criado: este servidor não tem endereço público (acontece no computador local).");
  } else if (r.webhook === "failed") {
    avisos.push("A chave foi gravada, mas o Asaas recusou a criação do webhook. Use Criar o webhook para tentar de novo.");
  }
  if (r.verificacao.status !== "ok") {
    avisos.push("A chave foi gravada, mas a conferência de tarifas e chave Pix não terminou. Use Verificar agora.");
  }
  return { ok: true, aviso: avisos.join(" ") || undefined };
}

/** Cria (ou recria) o webhook da conta com a chave já gravada. */
export async function criarWebhook(accountId: string): Promise<Resultado> {
  const session = await getSessionContext();
  const conta = await contaVisivel(accountId);
  if (!conta) return { ok: false, error: MENSAGENS.ACCOUNT_NOT_FOUND };
  if (!podeVincularContaPelaTela(session, conta.clinic_id)) {
    return { ok: false, error: "Você não tem permissão para mexer no webhook desta conta." };
  }
  if (!isAdminClientConfigured()) return { ok: false, error: SEM_SERVIDOR };

  const r = await criarWebhookDaConta({ accountId, actorId: session.userId, notifyEmail: session.email });
  atualizar();
  if (r === "created") return { ok: true };
  if (r === "no_public_url") {
    return { ok: false, error: "Este servidor não tem endereço público para receber o webhook (acontece no computador local)." };
  }
  return { ok: false, error: "O Asaas recusou a criação do webhook. Confira a chave e tente de novo." };
}

/** Verifica a conta agora: valida a chave, atualiza a situação, as tarifas, a chave Pix e a antecipação. */
export async function verificarAgora(accountId: string): Promise<Resultado> {
  const session = await getSessionContext();
  const conta = await contaVisivel(accountId);
  if (!conta) return { ok: false, error: MENSAGENS.ACCOUNT_NOT_FOUND };
  const podeVer = conta.clinic_id
    ? podeVerContaDaUnidade(session, conta.clinic_id)
    : podeVerContaDaRede(session);
  if (!podeVer) return { ok: false, error: "Você não tem permissão para esta ação." };
  if (conta.status === "awaiting_key") return { ok: false, error: "Grave a chave de API antes de verificar." };
  if (!isAdminClientConfigured()) return { ok: false, error: SEM_SERVIDOR };

  const r = await verificarConta({ accountId, actorId: session.userId, purpose: "manual_check" });
  atualizar();
  if (r.status === "ok") return { ok: true };
  if (r.status === "failed") return { ok: false, error: `${r.error} A unidade deixou de estar pronta para cobrar.` };
  return { ok: false, error: `${r.error} Nada mudou: tente de novo em instantes.` };
}

/** Desativa a conta: remove o webhook no Asaas e apaga a chave e o token do Vault. */
export async function desativarConta(formData: FormData): Promise<Resultado> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: SO_ADMIN };
  const accountId = String(formData.get("account_id") ?? "");
  const motivo = String(formData.get("reason") ?? "").trim().slice(0, 300);
  const conta = await contaVisivel(accountId);
  if (!conta) return { ok: false, error: MENSAGENS.ACCOUNT_NOT_FOUND };
  if (motivo.length < 5) return { ok: false, error: MENSAGENS.REASON_REQUIRED };

  if (isAdminClientConfigured()) await removerWebhookDaConta(accountId, session.userId);

  const supabase = await createClient();
  const { error } = await supabase.rpc("gateway_disable_account", { p_account_id: accountId, p_reason: motivo });
  if (error) return { ok: false, error: mensagem(error) };
  await logAudit({ action: "update", entityType: "gateway_account_disabled", entityId: accountId, clinicId: conta.clinic_id ?? undefined });
  atualizar();
  return { ok: true };
}

/** O Admin Master marca (ou desmarca) a unidade como pronta para cobrar. */
export async function marcarPronta(clinicId: string, pronta: boolean): Promise<Resultado> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: SO_ADMIN };
  if (!UUID.test(clinicId)) return { ok: false, error: "Unidade inválida." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("central_mark_ready", { p_clinic_id: clinicId, p_ready: pronta });
  if (error) return { ok: false, error: mensagem(error) };
  await logAudit({ action: "update", entityType: "central_unit_readiness", entityId: clinicId, clinicId });
  atualizar();
  return { ok: true };
}

export type LinhaDoHistorico = {
  id: number;
  occurredAt: string;
  userId: string | null;
  userName: string | null;
  actor: string;
  tableName: string;
  op: "I" | "U" | "D";
  changes: Record<string, unknown> | null;
};

/** O histórico de uma aba (a trilha de auditoria, filtrada pelo banco). `clinicId` nulo = nível Rede. */
export async function carregarHistorico(
  aba: string,
  clinicId: string | null
): Promise<{ ok: boolean; error?: string; rows: LinhaDoHistorico[] }> {
  const session = await getSessionContext();
  const nivel = clinicId ? "unidade" : "rede";
  if (!abaValida(nivel, aba)) return { ok: false, error: "Aba desconhecida.", rows: [] };
  if (clinicId !== null && !UUID.test(clinicId)) return { ok: false, error: "Unidade inválida.", rows: [] };
  const podeVer = podeVerAba(session, aba, nivel, clinicId);
  if (!podeVer) return { ok: false, error: "Você não tem permissão para ver este histórico.", rows: [] };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("central_history", { p_tab: aba, p_clinic_id: clinicId });
  if (error) return { ok: false, error: mensagem(error), rows: [] };
  type Bruta = {
    id: number; occurred_at: string; user_id: string | null; user_name: string | null;
    actor: string; table_name: string; op: "I" | "U" | "D"; changes: Record<string, unknown> | null;
  };
  return {
    ok: true,
    rows: ((data ?? []) as Bruta[]).map((l) => ({
      id: l.id,
      occurredAt: l.occurred_at,
      userId: l.user_id,
      userName: l.user_name,
      actor: l.actor,
      tableName: l.table_name,
      op: l.op,
      changes: l.changes,
    })),
  };
}
