import { todayInBrazil } from "@/lib/dates";

/**
 * Nome dos arquivos gerados pelo módulo (Excel e PDF).
 *
 * Padrão: `risarte-empresarial_<tipo>_<empresa>_<data>`, ex.:
 *   risarte-empresarial_beneficios_padaria-do-ze_2026-08-21.xlsx
 *
 * Assim o arquivo se explica sozinho na pasta de Downloads: dá para achar por
 * empresa, por tipo de relatório ou por data, sem abrir.
 */

/** Texto → pedaço de nome de arquivo (sem acento, espaço ou símbolo). */
export function slugify(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 60) || "empresa"
  );
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

/**
 * Imprime com um nome de arquivo sugerido. O navegador usa o TÍTULO da página
 * como nome padrão em "Salvar como PDF" — então trocamos o título, imprimimos e
 * devolvemos o título original.
 */
export function printAs(fileName: string, delayMs = 120): void {
  if (typeof document === "undefined") return;
  const original = document.title;
  document.title = fileName;

  const restore = () => {
    document.title = original;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);

  window.setTimeout(() => {
    window.print();
    // Rede de segurança: nem todo navegador dispara "afterprint".
    window.setTimeout(restore, 1000);
  }, delayMs);
}
