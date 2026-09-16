/**
 * IMPRIMIR E NOMEAR ARQUIVO — utilidades compartilhadas.
 *
 * ⚠️ POR QUE ESTE ARQUIVO EXISTE. `slugify` e `printAs` nasceram dentro do
 * módulo Risarte Empresarial (`src/lib/empresarial/filenames.ts`) porque foi
 * lá que a primeira exportação apareceu. Quando o Financeiro passou a exportar
 * também (OC-00009), havia dois caminhos: importar do outro módulo — acoplando
 * Financeiro a Empresarial, contra a regra do projeto — ou copiar as funções.
 *
 * As duas seriam erradas pelo mesmo motivo de sempre: **duas cópias da mesma
 * regra divergem no dia em que alguém mexe só numa**. A saída é a terceira —
 * subir a utilidade para um lugar que não pertence a nenhum dos dois. O
 * `filenames.ts` do Empresarial continua existindo e reexporta daqui, então
 * nada do que já estava escrito mudou de comportamento.
 */

import { todayInBrazil } from "@/lib/dates";

/**
 * Texto → pedaço de nome de arquivo (sem acento, espaço ou símbolo).
 *
 * ⚠️ O `fallback` É PARÂMETRO PORQUE ELE MUDA POR CONTEXTO — e porque eu errei
 * aqui. Ao subir esta função do módulo Empresarial eu afirmei que a mudança era
 * "de endereço, não de comportamento": o padrão de lá era `"empresa"` e o desta
 * versão nasceu `"relatorio"`, então um nome que vira vazio produziria arquivo
 * com outro nome. **O teste que já existia recusou a troca** — é exatamente o
 * tipo de diferença que passaria despercebida até alguém procurar um arquivo
 * que não está onde deveria.
 */
export function slugify(text: string, fallback = "relatorio"): string {
  return (
    text
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 60) || fallback
  );
}

/**
 * Monta o nome do arquivo (sem extensão), sempre terminando na data civil
 * BRASILEIRA — nunca `toISOString()`, que das 21h à meia-noite já devolve o dia
 * seguinte e faria o relatório de hoje nascer com a data de amanhã.
 */
export function fileName(...partes: (string | null | undefined)[]): string {
  return [...partes.filter(Boolean).map((p) => slugify(String(p))), todayInBrazil()]
    .join("_");
}

/**
 * Imprime com um nome de arquivo sugerido.
 *
 * O navegador usa o TÍTULO da página como nome padrão em "Salvar como PDF" —
 * então trocamos o título, imprimimos e devolvemos o título original.
 */
export function printAs(nomeDoArquivo: string, delayMs = 120): void {
  if (typeof document === "undefined") return;
  const original = document.title;
  document.title = nomeDoArquivo;

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
