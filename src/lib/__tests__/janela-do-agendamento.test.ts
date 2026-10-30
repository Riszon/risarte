import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// OC-00008: o nome longo de um procedimento alargava o conteúdo da janela de
// agendamento além da borda, e ela passava a rolar de lado cortando a esquerda.
const fonte = readFileSync(
  join(process.cwd(), "src/app/(app)/agenda/appointment-form-dialog.tsx"),
  "utf8"
);

describe("janela de agendamento (OC-00008)", () => {
  it("o conteúdo não fica mais largo que a janela", () => {
    expect(fonte).toMatch(/<DialogContent className="[^"]*\bgrid-cols-1\b/);
  });

  it.each([
    ["sessão do plano", "onClick={() => toggleSession(s)}"],
    ["outro profissional", "onClick={() => toggleParticipant(p.userId)}"],
  ])("o botão de %s quebra a linha", (_nome, clique) => {
    const antes = fonte.slice(0, fonte.indexOf(clique));
    const classe = antes.slice(antes.lastIndexOf("className="));
    expect(classe).toContain("whitespace-normal");
    expect(classe).toContain("h-auto");
  });

  it("a linha da fase é um texto só, não colunas soltas", () => {
    const inicio = fonte.indexOf("<Info ");
    const trecho = fonte.slice(inicio, fonte.indexOf("</p>", inicio));
    expect(trecho).toMatch(/\/>\s*<span>\s*Fase atual:/);
  });
});
