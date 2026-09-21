import { describe, expect, it } from "vitest";
import {
  linkDeEmail,
  linkDoWhatsApp,
  mensagemDeAcesso,
  type DadosDaMensagem,
} from "../mensagem-de-acesso";

const base: DadosDaMensagem = {
  nome: "Maria Aparecida Souza",
  email: "maria@risarte.com.br",
  senha: "Risarte7k",
  unidades: [{ unidade: "Risarte Cambé", funcao: "Recepcionista" }],
  enderecoDoSistema: "https://risarte.vercel.app",
  enderecoDoTreino: "https://risarte-treino.vercel.app",
  sistemaLiberado: true,
};

describe("mensagemDeAcesso", () => {
  it("chama a pessoa pelo primeiro nome", () => {
    expect(mensagemDeAcesso(base)).toContain("Oi, Maria!");
  });

  it("traz endereço, login e senha provisória", () => {
    const m = mensagemDeAcesso(base);
    expect(m).toContain("https://risarte.vercel.app");
    expect(m).toContain("maria@risarte.com.br");
    expect(m).toContain("Risarte7k");
  });

  it("lista TODAS as unidades, com a função de cada uma", () => {
    const m = mensagemDeAcesso({
      ...base,
      unidades: [
        { unidade: "Risarte Cambé", funcao: "Recepcionista" },
        { unidade: "Risarte Londrina", funcao: "Gerente de Unidade" },
      ],
    });
    expect(m).toContain("• Risarte Cambé — Recepcionista");
    expect(m).toContain("• Risarte Londrina — Gerente de Unidade");
    expect(m).toContain("mais de uma unidade");
  });

  it("sem senha nova, não inventa uma — diz o que fazer", () => {
    const m = mensagemDeAcesso({ ...base, senha: null });
    expect(m).not.toContain("Senha provisória");
    expect(m).toContain("a que você já usa");
  });

  it("quem ainda não tem o sistema real é mandado para o treino", () => {
    const m = mensagemDeAcesso({ ...base, sistemaLiberado: false });
    expect(m).toContain("COMECE PELO TREINO");
    expect(m).toContain("https://risarte-treino.vercel.app");
    // E o endereço do sistema real NÃO entra: ele ainda não abre para ela.
    expect(m).not.toContain("https://risarte.vercel.app\n");
  });

  it("quem já tem o sistema recebe o treino como convite, não como caminho", () => {
    const m = mensagemDeAcesso(base);
    expect(m).toContain("Perfil → Minha senha");
    expect(m).toContain("Para treinar sem mexer em dado de verdade");
  });

  it("sem endereço configurado, a mensagem não fica com um link vazio", () => {
    const m = mensagemDeAcesso({
      ...base,
      enderecoDoSistema: null,
      enderecoDoTreino: null,
    });
    expect(m).not.toContain("Endereço:");
    expect(m).toContain("Login: maria@risarte.com.br");
  });

  it("assina quando quem envia se identifica", () => {
    expect(mensagemDeAcesso({ ...base, assinatura: "Jeferson · Risarte" })).toContain(
      "Jeferson · Risarte"
    );
  });
});

describe("linkDoWhatsApp", () => {
  it("monta o link com o país na frente", () => {
    const l = linkDoWhatsApp("(43) 99999-1234", "oi");
    expect(l).toContain("https://wa.me/5543999991234");
    expect(l).toContain("text=oi");
  });
  it("número que já tem o 55 não ganha outro", () => {
    expect(linkDoWhatsApp("5543999991234", "oi")).toContain("wa.me/5543999991234");
  });
  it("sem número, não há link (em vez de um link quebrado)", () => {
    expect(linkDoWhatsApp("", "oi")).toBeNull();
    expect(linkDoWhatsApp("123", "oi")).toBeNull();
  });
});

describe("linkDeEmail", () => {
  it("monta o link com assunto e corpo", () => {
    const l = linkDeEmail("maria@risarte.com.br", "oi");
    expect(l).toContain("mailto:maria@risarte.com.br");
    expect(l).toContain("subject=");
    expect(l).toContain("body=oi");
  });
  it("sem e-mail válido, não há link", () => {
    expect(linkDeEmail("sem-arroba", "oi")).toBeNull();
  });
});
