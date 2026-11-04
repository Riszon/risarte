import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * COMPARAÇÃO DE SEGREDO EM TEMPO CONSTANTE (AP99, 03/11/2026).
 *
 * `got !== secret` para no primeiro byte diferente, e o tempo de resposta
 * entrega, aos poucos, quantos bytes do segredo quem chama já acertou. Para
 * um webhook público (`/api/webhooks/*`, fora do `proxy.ts`), isso é o que
 * separa "tem o segredo" de "descobre o segredo".
 *
 * Os dois lados passam por SHA-256 antes: `timingSafeEqual` exige o mesmo
 * tamanho, e o resumo tem sempre 32 bytes — então nem o tamanho do segredo
 * vaza. Segredo vazio nunca confere, mesmo que o cabeçalho venha vazio.
 */
export function segredoConfere(recebido: string | null | undefined, esperado: string | null | undefined): boolean {
  const e = (esperado ?? "").trim();
  if (!e) return false;
  const a = createHash("sha256").update(recebido ?? "").digest();
  const b = createHash("sha256").update(e).digest();
  return timingSafeEqual(a, b);
}
