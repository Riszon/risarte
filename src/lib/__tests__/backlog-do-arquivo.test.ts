import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { itensDoArquivo, ABERTOS, SEM_CODIGO, PRIMEIRO_CODIGO_NOVO } from "../../../scripts/backlog-do-arquivo.mjs";

// A importação do docs/BACKLOG.md para o banco (BK1, 0366). Ela roda uma vez
// em cada banco; esta régua prende o que foi conferido à mão em 04/11/2026,
// para a leitura não mudar calada se o arquivo for editado antes de rodar.

type Item = {
  code: string;
  title: string;
  detail: string;
  category: string;
  priority: string;
  status: string;
  module: string | null;
  foundOn: string | null;
  resolvedOn: string | null;
  resolvedVersion: string | null;
  resolution: string | null;
};

const arquivo = readFileSync("docs/BACKLOG.md", "utf8");
const itens: Item[] = itensDoArquivo(arquivo);
const por = (code: string) => itens.find((i) => i.code === code)!;
const fechado = (i: Item) => i.status === "resolvido" || i.status === "descartado";

describe("importação do BACKLOG.md", () => {
  it("lê os 111 itens AP e os sem código, sem repetir", () => {
    const codigos = itens.map((i) => i.code);
    expect(new Set(codigos).size).toBe(codigos.length);
    for (let n = 1; n <= 111; n++) expect(codigos).toContain(`AP${n}`);
    expect(itens.length).toBe(111 + SEM_CODIGO.length);
    expect(por(`AP${PRIMEIRO_CODIGO_NOVO}`).title).toMatch(/Riso Coins/);
  });

  it("todo item aberto tem categoria, prioridade e situação válidas", () => {
    const prioridades = ["urgente", "alta", "media", "baixa"];
    for (const i of itens.filter((x) => !fechado(x))) {
      expect(i.category, i.code).toBeTruthy();
      expect(prioridades, i.code).toContain(i.priority);
      expect(["aberto", "aguardando_dono", "em_andamento"], i.code).toContain(i.status);
      expect(i.resolvedOn, i.code).toBeNull();
    }
  });

  it("os cinco que o índice esqueceu entram ABERTOS", () => {
    for (const c of ["AP69", "AP70", "AP71", "AP74", "AP75"]) expect(fechado(por(c)), c).toBe(false);
  });

  it("os que o índice dava abertos mas já estavam resolvidos entram RESOLVIDOS", () => {
    for (const c of ["AP87", "AP100", "AP101"]) {
      expect(por(c).status, c).toBe("resolvido");
      expect(por(c).resolution, c).toBeTruthy();
    }
  });

  it("situações conferidas à mão", () => {
    expect(por("AP24").status).toBe("resolvido");
    expect(por("AP24").resolvedVersion).toBe("0.395.0");
    expect(por("AP7").status).toBe("resolvido"); // ENCERRADO no corpo
    expect(por("AP56").status).toBe("aberto");
    expect(por("AP61").status).toBe("aguardando_dono");
    expect(por("AP109").priority).toBe("alta");
    expect(itens.filter((i) => !fechado(i)).length).toBe(52);
    expect(itens.filter(fechado).length).toBe(73);
  });

  it("o detalhe é o texto da seção, e o título não carrega a marca de resolvido", () => {
    expect(por("AP56").detail).toMatch(/parseAppointmentForm/);
    for (const i of itens) {
      expect(i.title, i.code).not.toMatch(/^(✅|RESOLVIDO)/);
      expect(i.title.length, i.code).toBeLessThanOrEqual(300);
    }
  });

  it("item aberto sem classificação derruba a importação (nada entra por palpite)", () => {
    const quebrado = arquivo.replace("- [ ] **AP56**", "- [ ] **AP9056**");
    const comSecao = quebrado.replace("### AP56.", "### AP9056.");
    expect(() => itensDoArquivo(comSecao)).toThrow(/AP9056 está aberto/);
  });

  it("a tabela ABERTOS não aponta item resolvido nem inexistente", () => {
    for (const n of Object.keys(ABERTOS)) expect(fechado(por(`AP${n}`)), `AP${n}`).toBe(false);
  });

  it("sem o índice, falha alto em vez de importar vazio", () => {
    expect(() => itensDoArquivo(arquivo.replace("## ☑️ CHECKLIST", "## CHECKLIST"))).toThrow(/NÃO MEDI/);
  });
});
