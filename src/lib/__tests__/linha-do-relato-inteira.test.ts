import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Relato OC-00104 (16/10/2026): na lista de Problemas, o fundo da linha com
// "Resposta nova" (e o do passar o mouse) parava logo depois do texto, cada
// linha num tamanho. A linha (`<li>`) é flex e o link de dentro não esticava.
// Medido no navegador: sem `flex-1`, sobravam de 9 a 144 px até a borda; com
// ele, 0.

const LISTA = readFileSync(join(__dirname, "..", "..", "app", "(app)", "problemas", "lista.tsx"), "utf8");

describe("a linha do relato ocupa a largura toda", () => {
  it("o link que pinta o fundo estica até a borda da linha", () => {
    const i = LISTA.indexOf("<Link\n        href={enderecoDoRelato(r)}".replace(/\n/g, LISTA.includes("\r\n") ? "\r\n" : "\n"));
    expect(i).toBeGreaterThan(0);
    const trecho = LISTA.slice(i, LISTA.indexOf("novo && \"bg-gold/10\"", i));
    // Só a CLASSE — o comentário ao lado também cita "min-w-0 flex-1".
    const classe = trecho.match(/className=\{cn\(\s*"([^"]+)"/)?.[1] ?? "";
    expect(classe).not.toBe("");
    expect(classe.split(/\s+/)).toEqual(expect.arrayContaining(["min-w-0", "flex-1"]));
  });

  it("a linha continua flex (é por isso que o link precisa esticar)", () => {
    expect(LISTA).toContain('<li className={cn("flex items-start gap-1", escolhido && "bg-primary/5")}>');
  });
});
