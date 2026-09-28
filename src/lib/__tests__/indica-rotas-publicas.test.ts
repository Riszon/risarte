import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// As páginas públicas do Indica (/i/, /c/, /e/) abrem sem login. O porteiro
// (src/proxy.ts) libera por PREFIXO: "/i" sem a barra liberaria também
// "/indica-mais-risos" — o módulo interno inteiro sem login. Esta régua lê a
// lista de verdade e reprova.
function caminhosPublicos(): string[] {
  const fonte = readFileSync("src/proxy.ts", "utf8");
  const m = fonte.match(/const PUBLIC_PATHS = \[([^\]]*)\]/);
  if (!m) throw new Error("PUBLIC_PATHS não encontrado em src/proxy.ts");
  const lista = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  if (lista.length === 0) throw new Error("PUBLIC_PATHS vazio — a régua não mediu nada");
  return lista;
}

const liberado = (caminho: string) => caminhosPublicos().some((p) => caminho.startsWith(p));

describe("rotas públicas do Indica +Risos", () => {
  it("as três páginas públicas abrem sem login", () => {
    expect(liberado("/i/JOANA27")).toBe(true);
    expect(liberado("/c/" + "a".repeat(64))).toBe(true);
    expect(liberado("/e/" + "b".repeat(64))).toBe(true);
  });

  it("o módulo interno e as demais telas continuam exigindo login", () => {
    for (const rota of [
      "/indica-mais-risos",
      "/indica-mais-risos/indicacoes",
      "/empresarial",
      "/comercial",
      "/estoque",
      "/configuracoes",
      "/e",
      "/i",
    ]) {
      expect(liberado(rota), rota).toBe(false);
    }
  });
});
