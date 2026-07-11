import "server-only";

/**
 * Cliente ASAAS (Fase 4) — PONTO DE PLUGAR A CHAVE.
 * Defina no ambiente (Vercel / .env.local, fora do git):
 *   ASAAS_API_KEY   — chave da conta (sandbox ou produção)
 *   ASAAS_BASE_URL  — opcional; padrão sandbox. Produção: https://api.asaas.com/v3
 *
 * Enquanto a chave não estiver configurada, `isAsaasConfigured()` devolve false
 * e as telas seguem funcionando (cobrança local + baixa manual para testes).
 */
export function isAsaasConfigured(): boolean {
  return Boolean(process.env.ASAAS_API_KEY);
}

function baseUrl(): string {
  return process.env.ASAAS_BASE_URL || "https://sandbox.asaas.com/api/v3";
}

type AsaasResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; notConfigured?: boolean };

async function asaasFetch<T>(
  path: string,
  init: RequestInit
): Promise<AsaasResult<T>> {
  const key = process.env.ASAAS_API_KEY;
  if (!key) return { ok: false, error: "ASAAS não configurado.", notConfigured: true };
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        access_token: key,
        ...(init.headers ?? {}),
      },
    });
    const body = (await res.json()) as T;
    if (!res.ok) {
      return { ok: false, error: `ASAAS respondeu ${res.status}.` };
    }
    return { ok: true, data: body };
  } catch (e) {
    console.error("asaasFetch failed:", e);
    return { ok: false, error: "Falha ao falar com o ASAAS." };
  }
}

export type AsaasChargeInput = {
  /** id do cliente ASAAS (customer). Criado/mapeado à parte. */
  customer: string;
  billingType: "BOLETO" | "PIX" | "CREDIT_CARD";
  value: number; // em REAIS (ASAAS usa decimal)
  dueDate: string; // yyyy-mm-dd
  description?: string;
  installmentCount?: number;
  externalReference?: string; // id da adhesion_billing
};

export type AsaasCharge = { id: string; invoiceUrl?: string; status?: string };

/** Cria uma cobrança no ASAAS. Só é chamada quando a chave existe. */
export async function createAsaasCharge(
  input: AsaasChargeInput
): Promise<AsaasResult<AsaasCharge>> {
  return asaasFetch<AsaasCharge>("/payments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
