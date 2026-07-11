import "server-only";

/**
 * Cliente ZapSign (Fase 5) — PONTO DE PLUGAR A CHAVE.
 * Ambiente (Vercel / .env.local, fora do git):
 *   ZAPSIGN_API_TOKEN   — token da conta
 *   ZAPSIGN_BASE_URL    — opcional; padrão produção https://api.zapsign.com.br/api/v1
 *
 * Sem o token, `isZapsignConfigured()` devolve false e as telas seguem
 * funcionando (contrato local + marcação manual de assinado para testes).
 */
export function isZapsignConfigured(): boolean {
  return Boolean(process.env.ZAPSIGN_API_TOKEN);
}

function baseUrl(): string {
  return process.env.ZAPSIGN_BASE_URL || "https://api.zapsign.com.br/api/v1";
}

type ZapResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; notConfigured?: boolean };

export type ZapDocInput = {
  name: string;
  /** URL de um PDF já hospedado (ex.: proposta exportada). */
  url_pdf: string;
  signer_name: string;
  signer_email: string;
};

export type ZapDoc = { token: string; sign_url?: string; status?: string };

/** Cria o documento para assinatura na ZapSign. Só chamada quando há token. */
export async function createZapDocument(
  input: ZapDocInput
): Promise<ZapResult<ZapDoc>> {
  const token = process.env.ZAPSIGN_API_TOKEN;
  if (!token) {
    return { ok: false, error: "ZapSign não configurado.", notConfigured: true };
  }
  try {
    const res = await fetch(`${baseUrl()}/docs/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: input.name,
        url_pdf: input.url_pdf,
        signers: [{ name: input.signer_name, email: input.signer_email }],
      }),
    });
    const body = (await res.json()) as {
      token?: string;
      signers?: { sign_url?: string }[];
      status?: string;
    };
    if (!res.ok || !body.token) {
      return { ok: false, error: `ZapSign respondeu ${res.status}.` };
    }
    return {
      ok: true,
      data: {
        token: body.token,
        sign_url: body.signers?.[0]?.sign_url,
        status: body.status,
      },
    };
  } catch (e) {
    console.error("createZapDocument failed:", e);
    return { ok: false, error: "Falha ao falar com a ZapSign." };
  }
}
