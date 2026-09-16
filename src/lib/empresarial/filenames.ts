import { todayInBrazil } from "@/lib/dates";
import { slugify as slugGenerico } from "@/lib/print";

/**
 * Nome dos arquivos gerados pelo módulo (Excel e PDF).
 *
 * Padrão: `risarte-empresarial_<tipo>_<empresa>_<data>`, ex.:
 *   risarte-empresarial_beneficios_padaria-do-ze_2026-08-21.xlsx
 *
 * Assim o arquivo se explica sozinho na pasta de Downloads: dá para achar por
 * empresa, por tipo de relatório ou por data, sem abrir.
 *
 * ⚠️ `slugify` e `printAs` MUDARAM DE ENDEREÇO (15/09/2026, OC-00009), não de
 * comportamento: quando o Financeiro passou a exportar também, manter as duas
 * cópias faria elas divergirem no dia em que alguém mexesse só numa. Agora
 * moram em `src/lib/print.ts`, que não pertence a módulo nenhum.
 */

export { printAs } from "@/lib/print";

/**
 * O `slugify` do módulo mantém o padrão `"empresa"` para nome que vira vazio —
 * o genérico usa `"relatorio"`. A diferença parece cosmética e não é: é o nome
 * do arquivo que a pessoa vai procurar na pasta de Downloads.
 */
export function slugify(text: string): string {
  return slugGenerico(text, "empresa");
}

/** Monta o nome (sem extensão). `extra` entra antes da data — ex.: o filtro. */
export function reportFileName(
  kind: string,
  companyName: string,
  extra?: string | null
): string {
  const parts = [
    "risarte-empresarial",
    slugify(kind),
    slugify(companyName),
    extra ? slugify(extra) : null,
    // Data civil brasileira (regra do projeto: nunca toISOString para "hoje").
    todayInBrazil(),
  ].filter(Boolean);
  return parts.join("_");
}
