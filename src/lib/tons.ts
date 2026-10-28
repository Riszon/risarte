/**
 * OS TONS DE SITUAÇÃO — um lugar só, com o modo escuro já resolvido.
 *
 * Antes cada selo escrevia `bg-amber-50 text-amber-800` por conta própria, e
 * no modo escuro o fundo claro sumia sobre o fundo claro do tema invertido
 * (o dono viu o PPR+ "não dá pra ver no modo escuro", 28/10/2026). Quem
 * precisa de uma cor de situação pega daqui; a variante `dark:` vem junto.
 */
export const TOM = {
  ambar:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200",
  verde:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200",
  azul:
    "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200",
  vermelho:
    "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200",
  laranja:
    "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-200",
  neutro: "border-border bg-muted text-muted-foreground",
} as const;

export type Tom = keyof typeof TOM;
