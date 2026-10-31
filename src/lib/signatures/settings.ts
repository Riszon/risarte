import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A CONFIGURAÇÃO DA REDE para a assinatura digital (`signature_settings`, 0340)
 * — a leitura e as regras puras de formulário (testadas em
 * `assinaturas-configuracoes.test.ts`). A gravação é a porta do banco
 * `signature_save_settings`, chamada pela Server Action.
 */

export type SignatureSettings = {
  strong_auth_threshold_cents: number;
  patient_expiry_days: number;
  company_expiry_days: number;
  reminder_days: number[];
  waiting_buckets_days: number[];
  default_message: string;
  zapsign_emails_enabled: boolean;
  zapsign_plan_name: string | null;
  zapsign_monthly_limit: number | null;
  zapsign_alert_percent: number;
  monthly_report_recipients: ReportRecipient[];
  reconcile_after_hours: number;
  updated_by: string | null;
  updated_at: string;
};

export type ReportRecipient = { name: string; email: string };

export const SETTINGS_COLUMNS =
  "strong_auth_threshold_cents, patient_expiry_days, company_expiry_days, reminder_days, waiting_buckets_days, default_message, zapsign_emails_enabled, zapsign_plan_name, zapsign_monthly_limit, zapsign_alert_percent, monthly_report_recipients, reconcile_after_hours, updated_by, updated_at";

/** Os campos que a mensagem padrão aceita (`src/lib/notify/templates.ts`, ZS2). */
export const MESSAGE_FIELDS = ["nome", "unidade", "link", "prazo"] as const;

/**
 * Lê a linha única. `null` = o banco ainda não tem a 0340 (ou a leitura
 * falhou): a tela avisa e desabilita o salvar, em vez de fingir que gravou.
 */
export async function loadSignatureSettings(
  supabase: SupabaseClient
): Promise<SignatureSettings | null> {
  const { data, error } = await supabase
    .from("signature_settings")
    .select(SETTINGS_COLUMNS)
    .eq("id", true)
    .maybeSingle<Omit<SignatureSettings, "monthly_report_recipients"> & { monthly_report_recipients: unknown }>();
  if (error) {
    console.error("signature_settings:", error.message);
    return null;
  }
  if (!data) return null;
  return { ...data, monthly_report_recipients: normalizeRecipients(data.monthly_report_recipients) };
}

/** O JSON gravado vira uma lista limpa; o que não é {name, email} é ignorado. */
export function normalizeRecipients(raw: unknown): ReportRecipient[] {
  if (!Array.isArray(raw)) return [];
  const out: ReportRecipient[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const email = typeof o.email === "string" ? o.email.trim().toLowerCase() : "";
    if (!isValidEmail(email)) continue;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    out.push({ name, email });
  }
  return out;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/**
 * Os destinatários como a tela digita: uma linha por pessoa, "Nome <email>" ou
 * só o e-mail. Devolve a lista e as linhas que não deu para entender.
 */
export function parseRecipients(text: string): { recipients: ReportRecipient[]; invalid: string[] } {
  const recipients: ReportRecipient[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of (text ?? "").split(/\r?\n|;/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^(.*?)\s*<\s*([^<>\s]+)\s*>$/);
    const name = m ? m[1].trim().replace(/^"|"$/g, "") : "";
    const email = (m ? m[2] : line).trim().toLowerCase();
    if (!isValidEmail(email)) {
      invalid.push(line);
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    recipients.push({ name, email });
  }
  return { recipients, invalid };
}

export function formatRecipients(list: ReportRecipient[]): string {
  return list.map((r) => (r.name ? `${r.name} <${r.email}>` : r.email)).join("\n");
}

/** "2, 5" → [2, 5] (inteiros positivos, sem repetição, em ordem). Vazio → nulo. */
export function parseDayList(text: string): number[] | null {
  const nums = (text ?? "")
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map((s) => Number.parseInt(s, 10));
  if (nums.length === 0) return null;
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 365)) return null;
  return [...new Set(nums)].sort((a, b) => a - b);
}

/** O que a mensagem padrão usa e não existe — para a tela avisar antes de salvar. */
export function unknownMessageFields(message: string): string[] {
  const found = [...(message ?? "").matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)].map((m) => m[1]);
  return [...new Set(found.filter((f) => !(MESSAGE_FIELDS as readonly string[]).includes(f)))];
}

/** A mensagem pt-BR de um erro da porta `signature_save_settings`. */
export function mensagemDaConfiguracao(error: { message?: string } | null | undefined): string {
  const msg = error?.message ?? "";
  if (msg.includes("NOT_ALLOWED")) return "Só o Admin Master (ou quem tem a permissão de configurar) altera isto.";
  if (msg.includes("MESSAGE_REQUIRED")) return "A mensagem padrão não pode ficar vazia.";
  if (msg.includes("RECIPIENTS_INVALID")) return "A lista de destinatários não foi entendida.";
  if (/check constraint|violates check/i.test(msg)) return "Algum valor está fora do permitido (dias de 1 a 90, alerta de 1% a 100%, conferência de 1 a 168 horas).";
  if (/function .* does not exist|Could not find the function/i.test(msg)) {
    return "A assinatura digital ainda não está instalada neste banco (falta a migração 0340).";
  }
  return "Não foi possível salvar. Tente de novo em instantes.";
}
