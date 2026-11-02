import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PDFDocument, PDFFont } from "pdf-lib";

/**
 * AS FONTES E O LOGOTIPO DA MARCA, lidos do disco (`assets/`, copiados de
 * `docs/marca/extraido`, que não está no git). O `next.config.ts` inclui a
 * pasta no pacote publicado (`outputFileTracingIncludes`) — sem isso a Vercel
 * montaria o PDF sem fonte e cairia aqui com "arquivo não encontrado".
 */

const ASSETS = path.join(process.cwd(), "src", "lib", "signatures", "pdf", "assets");

const cache = new Map<string, Uint8Array>();

function asset(name: string): Uint8Array {
  let bytes = cache.get(name);
  if (!bytes) {
    bytes = new Uint8Array(readFileSync(path.join(ASSETS, name)));
    cache.set(name, bytes);
  }
  return bytes;
}

export type Fonts = { regular: PDFFont; bold: PDFFont };

/**
 * A FONTE VAI INTEIRA, NUNCA EM SUBCONJUNTO (AP89, 02/11/2026). O subconjunto
 * que o fontkit grava a partir da Inter (OTF/CFF) sai com a tabela CFF
 * estragada: o navegador recusa ("OTS parsing error: CFF : Bad offSize") e o
 * pdf.js com as fontes do arquivo mostra QUADRADINHOS no lugar das letras.
 * Inteira, ela abre limpa. Custa cerca de 280 KB por parte do pacote (a capa e
 * cada documento levam a sua cópia). A régua assinaturas-pdf.test.ts reprova
 * a volta do subconjunto.
 *
 * E AS TROCAS DE LETRA FICAM DESLIGADAS ("liga" e "calt"). Com a fonte
 * inteira, a largura de uma letra TROCADA pela Inter sai errada no PDF:
 *   * "liga" trocava o "r" antes de m, i, t… pela variante "r.1" — buraco em
 *     "platafor ma", "Risar te" (visto na 0.376.1, corrigido lá);
 *   * "calt" troca hífen, dois-pontos, parênteses… vizinhos de número ou
 *     maiúscula pela variante ".case" — "0003- 28", "86180- 000em" no CPF e no
 *     CEP (visto na ZS5; a 0.376.1 só desligou a "liga").
 * Com as duas desligadas a fonte não troca NENHUM caractere do nosso texto
 * (a régua de assinaturas-pdf.test.ts confere todos os pares). Se trocar a
 * fonte, a régua diz se outra troca precisa sair.
 */
export const FEATURES = { liga: false, calt: false };
export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(asset("Inter-Regular.otf"), { subset: false, features: FEATURES });
  const bold = await doc.embedFont(asset("Inter-Bold.otf"), { subset: false, features: FEATURES });
  return { regular, bold };
}

export function logoPng(): Uint8Array {
  return asset("logo-odontologia.png");
}

/** Tira o que a fonte não tem (emoji, controles) — sem isto o pdf-lib recusa o texto. */
export function sanitize(text: string): string {
  return (text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "");
}
