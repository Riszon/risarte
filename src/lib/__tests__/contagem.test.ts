import { describe, expect, it } from "vitest";
import { contagemConfirmada, naoConseguiConferir } from "@/lib/contagem";

describe("contagemConfirmada (AP11)", () => {
  it("devolve o número quando a contagem veio", () => {
    expect(contagemConfirmada({ count: 3, error: null })).toBe(3);
    // Zero de verdade continua sendo zero: "não há nenhum" é uma resposta.
    expect(contagemConfirmada({ count: 0, error: null })).toBe(0);
  });

  it("⚠️ contagem que FALHOU não é zero", () => {
    // O caso que o `count ?? 0` escondia: erro de rede, tempo-limite,
    // permissão. Numa trava, zero libera; o que se quer é "não sei".
    expect(contagemConfirmada({ count: null, error: { message: "timeout" } })).toBeNull();
  });

  it("⚠️ tabela que não existe também não é zero", () => {
    // Medido contra o banco de treino em 26/09/2026: pedindo só a contagem,
    // tabela inexistente volta com error: null E count: null — sem erro
    // nenhum. É por isso que a função olha o `count`, não só o `error`.
    expect(contagemConfirmada({ count: null, error: null })).toBeNull();
  });

  it("erro vence o número: se veio erro, o número não é confiável", () => {
    expect(contagemConfirmada({ count: 5, error: { code: "57014" } })).toBeNull();
  });

  it("a frase diz o que não deu para conferir e que NADA foi feito", () => {
    const f = naoConseguiConferir("quantas salas a unidade já tem");
    expect(f).toContain("quantas salas a unidade já tem");
    expect(f).toMatch(/nada foi alterado/i);
  });
});
