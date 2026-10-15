import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// AP44 (14/10/2026): a Jornada lia no máximo 1.000 clientes (`.limit(1000)`) e,
// na visão da rede, escondia os demais sem aviso — a contagem do topo dizia
// 1.000. A API também corta cada resposta em 1.000 (AP35), então "tirar o
// limite" não basta: a leitura tem de ser em páginas.

const pagina = readFileSync(
  join(__dirname, "..", "..", "app", "(app)", "jornada", "page.tsx"),
  "utf8"
);

describe("a Jornada lê TODOS os clientes", () => {
  it("em páginas, e não com um limite fixo", () => {
    expect(pagina).toMatch(/lerTodasAsPaginas<ClientRow>\(\(de, ate\) =>/);
    const leitura = pagina.slice(pagina.indexOf("const montarConsulta"), pagina.indexOf("leituraDosClientes.ok ?"));
    expect(leitura.length).toBeGreaterThan(0);
    expect(leitura).not.toMatch(/\.limit\(/);
  });

  it("na ordem estável (fase e id) — sem o id, a mesma linha cairia em duas páginas ou em nenhuma", () => {
    expect(pagina).toMatch(/\.order\("phase_entered_at"\)\s*\.order\("id"\)\s*\.range\(de, ate\)/);
  });

  it("leitura que falha não vira Jornada vazia: a tela diz", () => {
    expect(pagina).toMatch(/const clients = leituraDosClientes\.ok \? leituraDosClientes\.linhas : null;/);
    expect(pagina).toContain("Não foi possível ler os clientes agora");
  });
});
