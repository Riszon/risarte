// Pedido do dono (16/11/2026): "todos os itens da permissão devem ter uma
// explicação que qualquer um possa entender, e como impacta se tiver liberado
// e se não tiver". Esta régua reprova permissão nova sem os três textos — a
// regra não depende de alguém lembrar.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAPACIDADES } from "@/lib/permissions";
import { EXPLICACOES } from "@/lib/permissoes-explicacoes";

describe("toda permissão explicada", () => {
  it("cada permissão do catálogo tem o que é, se liberado e se bloqueado", () => {
    const faltando = CAPACIDADES.filter((c) => {
      const e = EXPLICACOES[c.id];
      return !e || !e.descricao.trim() || !e.seLigado.trim() || !e.seDesligado.trim();
    }).map((c) => c.id);
    expect(faltando).toEqual([]);
    // Régua que não acha nada grita: o catálogo TEM permissões.
    expect(CAPACIDADES.length).toBeGreaterThan(60);
  });

  it("nenhuma explicação sobra para permissão que não existe", () => {
    const ids = new Set(CAPACIDADES.map((c) => c.id));
    expect(Object.keys(EXPLICACOES).filter((k) => !ids.has(k))).toEqual([]);
  });

  it("os textos são curtos o bastante para a tela", () => {
    for (const [id, e] of Object.entries(EXPLICACOES)) {
      for (const t of [e.descricao, e.seLigado, e.seDesligado]) {
        expect(t.length, id).toBeLessThan(420);
      }
    }
  });

  it("a tela mostra os dois lados", () => {
    const tela = readFileSync("src/app/(app)/admin/permissoes/permissions-matrix.tsx", "utf8");
    expect(tela).toContain("Se liberado: ");
    expect(tela).toContain("Se bloqueado: ");
    expect(tela).toContain("<ExplicacaoDaPermissao cap={cap} compacta />");
    expect(tela).toContain("<ExplicacaoDaPermissao cap={cap} />");
  });
});
