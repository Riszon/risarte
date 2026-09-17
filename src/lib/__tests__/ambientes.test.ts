import { describe, expect, it } from "vitest";
import {
  AMBIENTES,
  ambientePermitido,
  cartoesDoInicio,
  enderecoValido,
} from "@/lib/ambientes";

describe("quem entra em cada ambiente (espelho do banco)", () => {
  it("sem decisão registrada: treino e Academy abertos, sistema fechado", () => {
    expect(ambientePermitido({}, "treino")).toBe(true);
    expect(ambientePermitido({}, "academy")).toBe(true);
    expect(ambientePermitido({}, "sistema")).toBe(false);
  });

  it("a decisão registrada manda, inclusive para retirar o treino", () => {
    expect(ambientePermitido({ treino: false }, "treino")).toBe(false);
    expect(ambientePermitido({ academy: false }, "academy")).toBe(false);
    expect(ambientePermitido({ sistema: true }, "sistema")).toBe(true);
  });

  it("⚠️ Admin Master nunca se tranca para fora", () => {
    for (const a of AMBIENTES) {
      expect(ambientePermitido({ sistema: false, treino: false }, a, true)).toBe(
        true
      );
    }
  });
});

describe("os atalhos da tela de Início", () => {
  const urls = {
    sistema: "https://risarte.vercel.app",
    treino: "https://risarte-treino.vercel.app",
    academy: "https://academy.risarte.com.br",
  };

  it("no sistema real, mostra treino e Academy — nunca ele mesmo", () => {
    const cartoes = cartoesDoInicio({ permissoes: {}, urls, atual: "sistema" });
    expect(cartoes.map((c) => c.ambiente)).toEqual(["treino", "academy"]);
  });

  it("no treino, o atalho de volta é o sistema real", () => {
    const cartoes = cartoesDoInicio({
      permissoes: { sistema: true },
      urls,
      atual: "treino",
    });
    expect(cartoes.map((c) => c.ambiente)).toEqual(["sistema", "academy"]);
  });

  it("ambiente retirado da pessoa não vira atalho", () => {
    const cartoes = cartoesDoInicio({
      permissoes: { treino: false },
      urls,
      atual: "sistema",
    });
    expect(cartoes.map((c) => c.ambiente)).toEqual(["academy"]);
  });

  it("⚠️ sem endereço não há atalho — o Academy ainda não foi publicado", () => {
    const cartoes = cartoesDoInicio({
      permissoes: {},
      urls: { ...urls, academy: null },
      atual: "sistema",
    });
    expect(cartoes.map((c) => c.ambiente)).toEqual(["treino"]);
    expect(
      cartoesDoInicio({ permissoes: {}, urls: { academy: "   " }, atual: "sistema" })
    ).toEqual([]);
  });

  it("o cartão carrega rótulo e explicação, não só o link", () => {
    const [treino] = cartoesDoInicio({ permissoes: {}, urls, atual: "sistema" });
    expect(treino.rotulo).toBe("riSZon Treino");
    expect(treino.descricao).toContain("dados de mentira");
    expect(treino.url).toBe(urls.treino);
  });
});

describe("endereço digitado por gente", () => {
  it("aceita http e https", () => {
    expect(enderecoValido("https://academy.risarte.com.br")).toBe(
      "https://academy.risarte.com.br/"
    );
    expect(enderecoValido(" http://localhost:3100 ")).toBe("http://localhost:3100/");
  });

  it("⚠️ recusa o que não é endereço de site", () => {
    for (const v of ["", "   ", null, undefined, "academy.risarte.com.br", "javascript:alert(1)"]) {
      expect(enderecoValido(v)).toBeNull();
    }
  });
});
