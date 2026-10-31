"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { parseBRLToCents } from "@/lib/pricing";
import { canConfigureSignatures } from "@/lib/signatures/access";
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
