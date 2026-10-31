import type { ZapsignRubrica } from "@/lib/zapsign/types";
import type { SignatureBox } from "./render-template";
import { A4 } from "./text";

/**
 * AS MARCAS QUE A ZAPSIGN DESENHA (plano ZS0 §5.2): a assinatura de cada
 * signatário na caixa que o modelo reservou, e a rubrica ("visto") de todos
 * no rodapé direito de todas as páginas — menos a capa, que não se assina.
 * Coordenadas em percentual da página, origem no canto inferior esquerdo,
 * como a API pede. Regra pura, testada em `assinaturas-pdf.test.ts`.
 */

export type DocumentPlacement = {
  /** A primeira página do documento no pacote (1 = a primeira do PDF mesclado). */
  firstPage: number;
  boxes: SignatureBox[];
};

export const RUBRICA = { width: 6.5, height: 2.6, bottom: 1.2, gapRight: 2.5 } as const;

export function montarRubricas(input: {
  pageCount: number;
  /** Páginas que não levam rubrica (a capa): índices 0-based. */
  skipPages: number[];
  documents: DocumentPlacement[];
  /** key do signatário → token da ZapSign; a ordem decide a posição das rubricas. */
  signerTokens: { key: string; token: string }[];
}): ZapsignRubrica[] {
  const rubricas: ZapsignRubrica[] = [];
  const tokenOf = new Map(input.signerTokens.map((s) => [s.key, s.token]));

  for (const doc of input.documents) {
    for (const box of doc.boxes) {
      const token = tokenOf.get(box.signerKey);
      if (!token) continue;
      rubricas.push({
        page: doc.firstPage - 1 + box.page,
        relative_position_left: round(((box.left + 8) / A4.width) * 100),
        relative_position_bottom: round(((box.bottom + 6) / A4.height) * 100),
        relative_size_x: round(((box.width - 16) / A4.width) * 100),
        relative_size_y: round(((box.height - 12) / A4.height) * 100),
        type: "signature",
        signer_token: token,
      });
    }
  }

  const skip = new Set(input.skipPages);
  for (let page = 0; page < input.pageCount; page++) {
    if (skip.has(page)) continue;
    input.signerTokens.forEach((s, i) => {
      const left = 100 - RUBRICA.gapRight - (i + 1) * (RUBRICA.width + 0.8);
      if (left < 0) return; // mais de 13 signatários não cabem na linha — sem rubrica a mais
      rubricas.push({
        page,
        relative_position_left: round(left),
        relative_position_bottom: RUBRICA.bottom,
        relative_size_x: RUBRICA.width,
        relative_size_y: RUBRICA.height,
        type: "visto",
        signer_token: s.token,
      });
    });
  }
  return rubricas;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
