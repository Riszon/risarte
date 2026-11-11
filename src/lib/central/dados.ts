import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInBrazil } from "@/lib/dates";
import type { ItemDeProntidao } from "./central";

/**
 * AS LEITURAS DA CENTRAL — sempre COMO a pessoa logada (a regra de linha do
 * banco decide o que volta). Nenhuma coluna de segredo é pedida: da chave e do
 * token só sai "existe ou não" (`temChave`, `temWebhook`).
 *
 * ⚠️ O CÓDIGO PODE IR AO AR ANTES DA MIGRAÇÃO (CLAUDE.md §0b): toda leitura
 * aqui devolve `semMigracao: true` quando a tabela ou a função não existe, e a
 * tela avisa em vez de quebrar.
 */

export type ContaDaCentral = {
  id: string;
  ownerType: "franchisor" | "unit" | "recipient";
  clinicId: string | null;
  label: string;
  cnpj: string | null;
  environment: "sandbox" | "production";
  status: "awaiting_key" | "active" | "error" | "disabled";
  walletId: string | null;
  accountName: string | null;
  accountStatus: Record<string, unknown> | null;
  commercialInfoExpiresOn: string | null;
  validatedAt: string | null;
  temChave: boolean;
  apiKeySavedAt: string | null;
  apiKeyLastUsedAt: string | null;
  temWebhook: boolean;
  webhookCreatedAt: string | null;
  webhookLastEventAt: string | null;
  termSignedOn: string | null;
  termSignedByName: string | null;
  termNote: string | null;
  termRegisteredAt: string | null;
  splitDeclaredAt: string | null;
  splitConfirmedAt: string | null;
  pixKeyActive: boolean | null;
  anticipationAutoEnabled: boolean | null;
  feesSyncedAt: string | null;
  lastCheckAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckError: string | null;
};

const COLUNAS =
  "id, owner_type, clinic_id, label, cnpj, environment, status, wallet_id, account_name, account_status, " +
  "commercial_info_expires_on, validated_at, api_key_secret_id, api_key_saved_at, api_key_last_used_at, " +
  "webhook_id, webhook_token_secret_id, webhook_created_at, webhook_last_event_at, term_signed_on, " +
  "term_signed_by_name, term_note, term_registered_at, split_enabled_declared_at, split_enabled_confirmed_at, " +
  "pix_key_active, anticipation_auto_enabled, fees_synced_at, last_check_at, last_check_ok, last_check_error";

type Linha = Record<string, unknown>;

function paraConta(l: Linha): ContaDaCentral {
  const s = (k: string) => (typeof l[k] === "string" ? (l[k] as string) : null);
  const b = (k: string) => (typeof l[k] === "boolean" ? (l[k] as boolean) : null);
  return {
    id: String(l.id),
    ownerType: l.owner_type as ContaDaCentral["ownerType"],
    clinicId: s("clinic_id"),
    label: String(l.label ?? ""),
    cnpj: s("cnpj"),
    environment: l.environment as ContaDaCentral["environment"],
    status: l.status as ContaDaCentral["status"],
    walletId: s("wallet_id"),
    accountName: s("account_name"),
    accountStatus: (l.account_status as Record<string, unknown> | null) ?? null,
    commercialInfoExpiresOn: s("commercial_info_expires_on"),
    validatedAt: s("validated_at"),
    // Do segredo só sai "existe": o identificador do Vault não vai para a tela.
    temChave: l.api_key_secret_id != null,
    apiKeySavedAt: s("api_key_saved_at"),
    apiKeyLastUsedAt: s("api_key_last_used_at"),
    temWebhook: l.webhook_id != null && l.webhook_token_secret_id != null,
    webhookCreatedAt: s("webhook_created_at"),
    webhookLastEventAt: s("webhook_last_event_at"),
    termSignedOn: s("term_signed_on"),
    termSignedByName: s("term_signed_by_name"),
    termNote: s("term_note"),
    termRegisteredAt: s("term_registered_at"),
    splitDeclaredAt: s("split_enabled_declared_at"),
    splitConfirmedAt: s("split_enabled_confirmed_at"),
    pixKeyActive: b("pix_key_active"),
    anticipationAutoEnabled: b("anticipation_auto_enabled"),
    feesSyncedAt: s("fees_synced_at"),
    lastCheckAt: s("last_check_at"),
    lastCheckOk: b("last_check_ok"),
    lastCheckError: s("last_check_error"),
  };
}

/** A tabela ou a função ainda não existe neste banco (migração por rodar)? */
export function faltaMigracao(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "PGRST202" ||
    /does not exist|Could not find the (table|function)|schema cache/i.test(error.message ?? "")
  );
}

export type ContasLidas = { contas: ContaDaCentral[]; semMigracao: boolean; erro: boolean };

/** As contas em uso (não desativadas) que a pessoa enxerga. */
export async function carregarContas(supabase: SupabaseClient): Promise<ContasLidas> {
  const { data, error } = await supabase
    .from("gateway_accounts")
    .select(COLUNAS)
    .neq("status", "disabled")
    .order("created_at", { ascending: true });
  if (error) return { contas: [], semMigracao: faltaMigracao(error), erro: !faltaMigracao(error) };
  return { contas: ((data ?? []) as unknown as Linha[]).map(paraConta), semMigracao: false, erro: false };
}

export type ProntidaoLida = {
  itens: ItemDeProntidao[];
  marcada: boolean;
  desmarcadaEm: string | null;
  motivoDaQueda: string | null;
};

/** A lista de prontidão da unidade e a marcação do Admin Master. */
export async function carregarProntidao(supabase: SupabaseClient, clinicId: string): Promise<ProntidaoLida> {
  const [lista, marca] = await Promise.all([
    supabase.rpc("central_readiness", { p_clinic_id: clinicId }),
    supabase
      .from("central_unit_readiness")
      .select("marked_ready_at, unmarked_at, unmarked_reason")
      .eq("clinic_id", clinicId)
      .maybeSingle<{ marked_ready_at: string | null; unmarked_at: string | null; unmarked_reason: string | null }>(),
  ]);
  return {
    itens: lista.error ? [] : ((lista.data ?? []) as ItemDeProntidao[]),
    marcada: !marca.error && marca.data?.marked_ready_at != null,
    desmarcadaEm: marca.data?.unmarked_at ?? null,
    motivoDaQueda: marca.data?.unmarked_reason ?? null,
  };
}

export type TarifaDaCentral = {
  id: string;
  modality: string;
  minInstallments: number;
  maxInstallments: number;
  feePercent: number;
  fixedFeeCents: number;
  minFeeCents: number | null;
  maxFeeCents: number | null;
  settlementDays: number;
  freeMonthlyCount: number | null;
  validFrom: string;
  validTo: string | null;
  source: string;
};

/** As tarifas do adquirente "Asaas" desta conta: as que valem hoje e as que já têm data para começar. */
export async function carregarTarifas(supabase: SupabaseClient, accountId: string): Promise<TarifaDaCentral[]> {
  const adquirente = await supabase
    .from("card_acquirers")
    .select("id")
    .eq("gateway_account_id", accountId)
    .maybeSingle<{ id: string }>();
  if (adquirente.error || !adquirente.data) return [];
  const hoje = todayInBrazil();
  const { data, error } = await supabase
    .from("acquirer_rates")
    .select(
      "id, modality, min_installments, max_installments, fee_percent, fixed_fee_cents, min_fee_cents, max_fee_cents, settlement_days, free_monthly_count, valid_from, valid_to, source"
    )
    .eq("acquirer_id", adquirente.data.id)
    .or(`valid_to.is.null,valid_to.gte.${hoje}`)
    .order("modality")
    .order("min_installments")
    .order("valid_from");
  if (error) return [];
  return ((data ?? []) as Linha[])
    .map((l) => ({
      id: String(l.id),
      modality: String(l.modality),
      minInstallments: Number(l.min_installments),
      maxInstallments: Number(l.max_installments),
      feePercent: Number(l.fee_percent),
      fixedFeeCents: Number(l.fixed_fee_cents),
      minFeeCents: l.min_fee_cents == null ? null : Number(l.min_fee_cents),
      maxFeeCents: l.max_fee_cents == null ? null : Number(l.max_fee_cents),
      settlementDays: Number(l.settlement_days),
      freeMonthlyCount: l.free_monthly_count == null ? null : Number(l.free_monthly_count),
      validFrom: String(l.valid_from),
      validTo: typeof l.valid_to === "string" ? l.valid_to : null,
      source: String(l.source),
    }))
    // Linha encerrada antes de começar (substituída no mesmo dia) não aparece.
    .filter((t) => t.validTo === null || t.validTo >= t.validFrom);
}
