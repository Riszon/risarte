import "server-only";

import type { ZapsignCreateDocInput, ZapsignDocument, ZapsignRubrica } from "./types";

/**
 * A ZAPSIGN DE MENTIRA (`ZAPSIGN_ENV=fake`, ver `isZapsignFake` em `env.ts`).
 *
 * Responde o que a API responderia — token do documento, um token e um link
 * por signatário — sem rede e sem crédito. Serve ao servidor local de teste,
 * ao E2E e a quem ainda não tem o token do sandbox. Os links apontam para uma
 * página que não existe de propósito (`fake.zapsign.invalid`): ninguém assina
 * nada aqui; o retorno (webhook) é simulado por script na ZS3/ZS8.
 */

function fakeToken(prefix: string): string {
  const rnd = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return `${prefix}-fake-${rnd}`;
}

export async function createDocumentFromPdfFake(input: ZapsignCreateDocInput): Promise<ZapsignDocument> {
  if (!input.signers?.length) throw new Error("fake: at least one signer is required");
  const token = fakeToken("doc");
  return {
    token,
    open_id: Math.floor(Math.random() * 1_000_000),
    external_id: input.external_id ?? null,
    name: input.name,
    status: "pending",
    sandbox: true,
    created_at: new Date().toISOString(),
    last_update_at: new Date().toISOString(),
    date_limit_to_sign: input.date_limit_to_sign ?? null,
    signature_order_active: input.signature_order_active ?? true,
    signers: input.signers.map((s) => {
      const t = fakeToken("signer");
      return {
        token: t,
        name: s.name,
        email: s.email,
        phone_country: s.phone_country,
        phone_number: s.phone_number,
        status: "new",
        sign_url: `https://fake.zapsign.invalid/verificar/${t}`,
        auth_mode: s.auth_mode,
        order_group: s.order_group ?? 1,
        qualification: s.qualification,
        external_id: s.external_id ?? null,
      };
    }),
  };
}

export async function placeSignaturesFake(docToken: string, rubricas: ZapsignRubrica[]): Promise<ZapsignDocument> {
  if (!docToken) throw new Error("fake: document token is required");
  if (rubricas.some((r) => r.relative_position_left < 0 || r.relative_position_left > 100)) {
    throw new Error("fake: rubrica out of range");
  }
  return { token: docToken, status: "pending", sandbox: true };
}

export async function refuseDocumentFake(): Promise<void> {
  return;
}
