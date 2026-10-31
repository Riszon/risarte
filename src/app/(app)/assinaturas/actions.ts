"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { parseBRLToCents } from "@/lib/pricing";
import { canConfigureSignatures } from "@/lib/signatures/access";
import type { RisarteSignerMode, TemplateAuthLevel } from "@/lib/signatures/types";
import { camposDesconhecidos, camposDoModelo, corpoValido } from "@/lib/signatures/variables";
import { USER_ROLES, type UserRole } from "@/lib/roles";
import {
  mensagemDaConfiguracao,
  parseDayList,
  parseRecipients,
  unknownMessageFields,
} from "@/lib/signatures/settings";

/**
 * As ações do módulo de Assinaturas digitais (ZS1: só a configuração).
 * Padrão do projeto: guarda → normaliza → porta do banco → `logAudit` (só ids)
 * → `revalidatePath` → `{ ok, error? }` em pt-BR.
 */

export type ResultadoDaAssinatura = { ok: true } | { ok: false; error: string };

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const int = (fd: FormData, k: string): number | null => {
  const v = str(fd, k);
  if (v === "") return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

export async function saveSignatureSettings(formData: FormData): Promise<ResultadoDaAssinatura> {
  const session = await getSessionContext();
  if (!canConfigureSignatures(session)) {
    return { ok: false, error: "Só o Admin Master (ou quem tem a permissão de configurar) altera isto." };
  }

  const message = str(formData, "default_message");
  if (!message) return { ok: false, error: "A mensagem padrão não pode ficar vazia." };
  const desconhecidos = unknownMessageFields(message);
  if (desconhecidos.length > 0) {
    return { ok: false, error: `A mensagem usa campo que não existe: ${desconhecidos.map((f) => `{{${f}}}`).join(", ")}.` };
  }

  const reminder = parseDayList(str(formData, "reminder_days"));
  if (!reminder) return { ok: false, error: "Os dias de lembrete precisam ser números (ex.: 2, 5)." };
  const buckets = parseDayList(str(formData, "waiting_buckets_days"));
  if (!buckets || buckets.length !== 3) return { ok: false, error: "As faixas de espera são três números em ordem (ex.: 2, 5, 7)." }

  const { recipients, invalid } = parseRecipients(str(formData, "monthly_report_recipients"));
  if (invalid.length > 0) {
    return { ok: false, error: `Destinatário não entendido: ${invalid[0]}. Use "Nome <email>" ou só o e-mail, um por linha.` };
  }

  const thresholdText = str(formData, "strong_auth_threshold");
  const threshold = thresholdText === "" ? null : parseBRLToCents(thresholdText);
  if (thresholdText !== "" && threshold === null) {
    return { ok: false, error: "O valor de corte precisa ser um valor em reais (ex.: 5.000,00)." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("signature_save_settings", {
    p_strong_auth_threshold_cents: threshold,
    p_patient_expiry_days: int(formData, "patient_expiry_days"),
    p_company_expiry_days: int(formData, "company_expiry_days"),
    p_reminder_days: reminder,
    p_waiting_buckets_days: buckets,
    p_default_message: message,
    p_zapsign_emails_enabled: str(formData, "zapsign_emails_enabled") === "on",
    p_zapsign_plan_name: str(formData, "zapsign_plan_name") || null,
    p_zapsign_monthly_limit: int(formData, "zapsign_monthly_limit"),
    p_zapsign_alert_percent: int(formData, "zapsign_alert_percent"),
    p_monthly_report_recipients: recipients,
    p_reconcile_after_hours: int(formData, "reconcile_after_hours"),
  });
  if (error) return { ok: false, error: mensagemDaConfiguracao(error) };

  await logAudit({ action: "update", entityType: "signature_settings", entityId: "rede" });
  revalidatePath("/assinaturas/configuracoes");
  return { ok: true };
}

/**
 * ZS2: salva o texto e as regras de um modelo (porta `signature_save_template`).
 * Campo `{{…}}` que o sistema não conhece é recusado aqui — sairia impresso
 * cru num documento que vai para assinatura.
 */
export async function saveSignatureTemplate(formData: FormData): Promise<ResultadoDaAssinatura> {
  const session = await getSessionContext();
  if (!canConfigureSignatures(session)) {
    return { ok: false, error: "Só o Admin Master (ou quem tem a permissão de configurar) altera isto." };
  }
  const id = str(formData, "id");
  const name = str(formData, "name");
  if (!id) return { ok: false, error: "Modelo não identificado." };
  if (!name) return { ok: false, error: "O nome do documento não pode ficar vazio." };

  const supabase = await createClient();
  const { data: atual } = await supabase.from("signature_templates").select("id, audience, source").eq("id", id).maybeSingle();
  if (!atual) return { ok: false, error: "Modelo não encontrado." };

  let body: unknown = null;
  let variables: string[] = [];
  if (!atual.source) {
    try {
      body = JSON.parse(str(formData, "body") || "null");
    } catch {
      return { ok: false, error: "O texto do modelo não foi entendido." };
    }
    if (!corpoValido(body)) return { ok: false, error: "O texto do modelo está incompleto (preâmbulo, cláusulas e fecho)." };
    const desconhecidos = camposDesconhecidos(body, atual.audience as "patient" | "company");
    if (desconhecidos.length > 0) {
      return { ok: false, error: `Campo que o sistema não conhece: ${desconhecidos.map((c) => `{{${c}}}`).join(", ")}.` };
    }
    variables = camposDoModelo(body);
  }

  const authLevel = str(formData, "auth_level") as TemplateAuthLevel;
  if (!["simple", "strong", "by_amount"].includes(authLevel)) return { ok: false, error: "Autenticação inválida." };
  const witnessCount = int(formData, "witness_count") ?? 0;
  if (witnessCount < 0 || witnessCount > 2) return { ok: false, error: "Testemunhas: 0, 1 ou 2." };
  const mode = str(formData, "risarte_signer_mode") as RisarteSignerMode;
  if (!["role", "sender", "user", "none"].includes(mode)) return { ok: false, error: "Quem assina pela Risarte: opção inválida." };
  const roleRaw = str(formData, "risarte_signer_role");
  const role = roleRaw && (USER_ROLES as readonly string[]).includes(roleRaw) ? (roleRaw as UserRole) : null;
  if (roleRaw && !role) return { ok: false, error: "Papel inválido." };
  const userId = str(formData, "risarte_signer_user_id") || null;
  if (mode === "user" && !userId) return { ok: false, error: "Escolha a pessoa que assina pela Risarte." };

  const { error } = await supabase.rpc("signature_save_template", {
    p_id: id,
    p_name: name,
    p_body: body,
    p_variables: variables,
    p_auth_level: authLevel,
    p_witness_count: witnessCount,
    p_witness_mode: "choose_at_send",
    p_risarte_signer_mode: mode,
    p_risarte_signer_role: mode === "role" ? role : null,
    p_risarte_signer_user_id: mode === "user" ? userId : null,
    p_is_active: str(formData, "is_active") === "true",
    p_is_provisional_text: str(formData, "is_provisional_text") === "true",
  });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("NOT_ALLOWED")) return { ok: false, error: "Só o Admin Master (ou quem tem a permissão de configurar) altera isto." };
    if (m.includes("BODY_INVALID")) return { ok: false, error: "O texto do modelo está incompleto." };
    if (/does not exist|Could not find the function/i.test(m)) return { ok: false, error: "Falta a migração 0342 neste banco." };
    return { ok: false, error: "Não foi possível salvar o modelo. Tente de novo em instantes." };
  }
  await logAudit({ action: "update", entityType: "signature_template", entityId: id });
  revalidatePath("/assinaturas/configuracoes/modelos");
  revalidatePath(`/assinaturas/configuracoes/modelos/${id}`);
  return { ok: true };
}
