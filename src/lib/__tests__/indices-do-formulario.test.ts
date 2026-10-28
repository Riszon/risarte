import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { indicesDoFormulario } from "@/lib/indices-do-formulario";

describe("os índices das linhas de um formulário", () => {
  it("lê todas as linhas, inclusive acima de 200 (relato de 28/10/2026)", () => {
    const fd = new FormData();
    for (let i = 0; i < 307; i += 1) fd.set(`proc_${i}`, `p${i}`);
    const indices = indicesDoFormulario(fd, "proc_");
    expect(indices).toHaveLength(307);
    expect(indices.at(-1)).toBe(306);
  });

  it("em ordem, sem confundir prefixos parecidos e com buracos", () => {
    const fd = new FormData();
    fd.set("proc_10", "a");
    fd.set("proc_2", "b");
    fd.set("proc_x", "c");
    fd.set("proc_2_extra", "d");
    fd.set("vant_det_1", "e");
    fd.set("vant_1", "f");
    expect(indicesDoFormulario(fd, "proc_")).toEqual([2, 10]);
    expect(indicesDoFormulario(fd, "vant_")).toEqual([1]);
  });
});

describe("as listas de benefícios não têm teto fixo", () => {
  // ⚠️ O teto de 200 cortava em silêncio a proposta montada com o padrão da
  // rede (307 benefícios). Este teste reprova a volta do laço com limite.
  const arquivos = [
    "src/app/(app)/empresarial/funil/[leadId]/actions.ts",
    "src/app/(app)/empresarial/configuracoes/actions.ts",
  ];
  for (const arquivo of arquivos) {
    it(arquivo, () => {
      const fonte = readFileSync(arquivo, "utf8");
      expect(fonte).not.toMatch(/for \(let i = 0; i < \d+;[^)]*\)\s*\{\s*const (procedureId|perkId)/);
    });
  }
});
