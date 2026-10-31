import { MESSAGE_FIELDS } from "@/lib/signatures/settings";

/**
 * A MENSAGEM QUE VAI COM O LINK (plano ZS0 §5.4). O texto mora em
 * `signature_settings.default_message` e aceita os campos de
 * `MESSAGE_FIELDS` — `{{nome}}`, `{{unidade}}`, `{{link}}`, `{{prazo}}`.
 * Regra pura, testada em `assinaturas-canais.test.ts`.
 */

export type MessageValues = Record<(typeof MESSAGE_FIELDS)[number], string>;

export function montarMensagem(template: string, values: MessageValues): string {
  const texto = (template ?? "").replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_, chave: string) => {
    const v = (values as Record<string, string | undefined>)[chave];
    return v ?? "";
  });
  // Se o modelo esqueceu o link, ele vai no fim — sem link a mensagem não serve.
  return texto.includes(values.link) ? texto : `${texto.trim()}\n\n${values.link}`;
}

/** O primeiro nome, para a saudação. */
export function primeiroNome(fullName: string): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? "";
}
