import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gerarCpfDeTeste } from "@/lib/cpf-de-teste";
import { isValidCpf } from "@/lib/masks";

// Pedido do dono (02/11/2026): no treino, gerar CPF que a assinatura aceita.

const ler = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

describe("CPF de teste", () => {
  it("todo CPF gerado passa na mesma conferência do envio da assinatura", () => {
    for (let i = 0; i < 2000; i++) expect(isValidCpf(gerarCpfDeTeste())).toBe(true);
  });

  it("sai com a máscara do cadastro", () => {
    expect(gerarCpfDeTeste()).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
  });

  it("nunca devolve a sequência repetida, que a Receita recusa", () => {
    let n = 0;
    // Os primeiros 9 sorteios dão "000000000"; depois, um número de verdade.
    const sorteio = () => (n++ < 9 ? 0 : (n % 7) / 7);
    const cpf = gerarCpfDeTeste(sorteio);
    expect(cpf.replace(/\D/g, "")).not.toMatch(/^(\d)\1{10}$/);
    expect(isValidCpf(cpf)).toBe(true);
  });

  it("o botão só aparece no treino", () => {
    const botao = ler("src", "components", "cpf-de-teste.tsx");
    expect(botao).toMatch(/if \(!isTreino\(\)\) return null;/);
  });

  it("está no cadastro do cliente e do responsável", () => {
    const cliente = ler("src", "app", "(app)", "prontuarios", "client-form.tsx");
    expect(cliente.match(/<BotaoCpfDeTeste/g)?.length).toBe(2);
  });

  it("não está no Risartano: no treino a equipe é cópia da produção e não se edita", () => {
    const risartano = ler("src", "app", "(app)", "risartanos", "formulario.tsx");
    expect(risartano).not.toContain("BotaoCpfDeTeste");
  });

  it("a regra do envio da assinatura não mudou: CPF inválido segue barrado", () => {
    const valida = ler("src", "lib", "signatures", "validate.ts");
    expect(valida).toContain("!isValidCpf(s.cpf)");
    expect(valida).not.toContain("isTreino");
  });
});
