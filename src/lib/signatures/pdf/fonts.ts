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

export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(asset("Inter-Regular.otf"), { subset: true });
  const bold = await doc.embedFont(asset("Inter-Bold.otf"), { subset: true });
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
