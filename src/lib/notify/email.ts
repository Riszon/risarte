import "server-only";

/**
 * E-MAIL PELA RESEND (plano ZS0 §4.4), atrás da mesma forma dos outros canais.
 *
 * Variáveis (nomes; os valores ficam na Vercel): `RESEND_API_KEY` (Secret) e
 * `EMAIL_FROM` ("Risarte Odontologia <assinaturas@dominio>"). Sem as duas o
 * sistema DIZ que o e-mail não está configurado e não promete envio — regra
 * do projeto: leitura ou serviço que falta nunca vira silêncio.
 */

export type EmailInput = {
  to: string;
  toName?: string | null;
  subject: string;
  text: string;
  attachments?: { filename: string; bytes: Uint8Array }[];
};

export type EmailResult = { ok: true; id: string | null } | { ok: false; error: string; configured: boolean };

export function isEmailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY ?? "").trim() && !!(process.env.EMAIL_FROM ?? "").trim();
}

export async function sendEmail(
  input: EmailInput,
  deps: { fetchImpl?: typeof fetch; apiKey?: string; from?: string; timeoutMs?: number } = {}
): Promise<EmailResult> {
  const apiKey = (deps.apiKey ?? process.env.RESEND_API_KEY ?? "").trim();
  const from = (deps.from ?? process.env.EMAIL_FROM ?? "").trim();
  if (!apiKey || !from) return { ok: false, error: "E-mail não configurado (RESEND_API_KEY e EMAIL_FROM).", configured: false };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 20_000);
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [input.toName ? `${input.toName} <${input.to}>` : input.to],
        subject: input.subject,
        text: input.text,
        attachments: (input.attachments ?? []).map((a) => ({ filename: a.filename, content: Buffer.from(a.bytes).toString("base64") })),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Sem o corpo no log: pode trazer o e-mail da pessoa.
      console.error("resend: HTTP", res.status);
      return { ok: false, error: `O serviço de e-mail respondeu ${res.status}.`, configured: true };
    }
    const data = (await res.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: data?.id ?? null };
  } catch (e) {
    console.error("resend:", e instanceof Error ? e.name : "error");
    return { ok: false, error: "Não foi possível falar com o serviço de e-mail.", configured: true };
  } finally {
    clearTimeout(timer);
  }
}
