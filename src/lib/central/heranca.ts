// A HERANÇA CAMPO A CAMPO da Central — puro, SEM nada de servidor, porque
// os formulários das abas (que rodam no navegador) usam. Não importar
// `@/lib/auth` (nem `central.ts`) daqui: levaria código de servidor ao navegador
// e a montagem quebra.

export type OrigemDoValor = "herdado" | "personalizado" | "sem_valor";

/**
 * A regra de toda aba com dois níveis (o padrão já usado em `finance_settings`):
 * campo VAZIO na unidade herda o da rede. `null` e `undefined` são vazio; zero
 * e texto vazio digitado NÃO são (zero é um valor: "sem multa" é uma decisão).
 */
export function valorEfetivo<T>(
  daUnidade: T | null | undefined,
  daRede: T | null | undefined
): { valor: T | null; origem: OrigemDoValor } {
  if (daUnidade !== null && daUnidade !== undefined) return { valor: daUnidade, origem: "personalizado" };
  if (daRede !== null && daRede !== undefined) return { valor: daRede, origem: "herdado" };
  return { valor: null, origem: "sem_valor" };
}

export const ORIGEM_DO_VALOR: Record<OrigemDoValor, string> = {
  herdado: "herdado da rede",
  personalizado: "personalizado",
  sem_valor: "sem valor na rede",
};
