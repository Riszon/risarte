import "server-only";
import { createDocumentFromPdf, isZapsignConfigured, mensagemDaZapsign, ZapsignError } from "@/lib/zapsign";

/**
 * ⚠️ ESTE ARQUIVO VIROU UM REEXPORT (ZS1, 31/10/2026 — plano ZS0 §4.5).
 *
 * O cliente da ZapSign mora em `src/lib/zapsign/` (um caminho só para o core e
 * o Empresarial). O esboço antigo daqui nunca enviou nada (a aba Contratos
 * chamava `sendContract` sem PDF); as duas funções que as telas do Empresarial
 * ainda importam continuam respondendo com a MESMA forma de resultado, agora
 * pelo cliente novo (token, ambiente sandbox/produção e erros tipados).
 *
 * Na ZS5 a aba Contratos passa a usar o módulo de assinaturas e este arquivo sai.
 */
export { isZapsignConfigured };

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
export async function createZapDocument(input: ZapDocInput): Promise<ZapResult<ZapDoc>> {
  if (!isZapsignConfigured()) {
    return { ok: false, error: "ZapSign não configurado.", notConfigured: true };
  }
  try {
    const doc = await createDocumentFromPdf({
      name: input.name,
      url_pdf: input.url_pdf,
      signers: [{ name: input.signer_name, email: input.signer_email }],
    });
    return {
      ok: true,
      data: {
        token: doc.token,
        sign_url: doc.signers?.[0]?.sign_url,
        status: doc.status,
      },
    };
  } catch (e) {
    if (e instanceof ZapsignError && e.code === "not_configured") {
      return { ok: false, error: e.messagePt, notConfigured: true };
    }
    return { ok: false, error: mensagemDaZapsign(e) };
  }
}
