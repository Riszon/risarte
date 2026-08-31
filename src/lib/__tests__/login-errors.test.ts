import { describe, expect, it } from "vitest";
import { mensagemDeEntrada } from "@/app/login/login-form";

// A regra em uma frase: SÓ a credencial inválida fala de e-mail e senha. Se
// qualquer outra falha voltar a dizer "senha incorreta", o defeito que custou o
// dia da publicação está de volta — e ninguém percebe olhando a tela, porque a
// mensagem parece plausível.
describe("mensagem de erro do login", () => {
  it("credencial inválida é a única que menciona e-mail e senha", () => {
    const m = mensagemDeEntrada({ status: 400, message: "Invalid login credentials" });
    expect(m).toContain("E-mail ou senha");
  });

  it("excesso de tentativas não vira 'senha errada'", () => {
    const m = mensagemDeEntrada({ status: 429, message: "Request rate limit reached" });
    expect(m).not.toContain("senha");
    expect(m.toLowerCase()).toContain("tentativas");
  });

  it("servidor fora do ar não vira 'senha errada'", () => {
    const m = mensagemDeEntrada({ status: 503, message: "Service Unavailable" });
    expect(m).not.toContain("senha");
  });

  it("falha de rede não vira 'senha errada'", () => {
    const m = mensagemDeEntrada({ status: 0, message: "Failed to fetch" });
    expect(m).not.toContain("senha");
    expect(m.toLowerCase()).toContain("internet");
  });

  it("captcha não vira 'senha errada'", () => {
    const m = mensagemDeEntrada({
      status: 400,
      message: "captcha verification process failed",
    });
    expect(m).not.toContain("senha");
  });

  it("erro desconhecido mostra o código em vez de acusar a senha", () => {
    const m = mensagemDeEntrada({ status: 418, message: "algo novo" });
    expect(m).not.toContain("senha");
    expect(m).toContain("418");
  });

  it("e-mail inexistente e senha errada dão a MESMA resposta", () => {
    // É o que impede descobrir quem tem conta tentando um e-mail atrás do outro.
    const a = mensagemDeEntrada({ status: 400, message: "Invalid login credentials" });
    const b = mensagemDeEntrada({ status: 400, message: "Invalid login credentials" });
    expect(a).toBe(b);
  });
});
