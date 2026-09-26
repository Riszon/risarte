import { describe, expect, it } from "vitest";
import { decidirImplantacao } from "@/lib/empresarial/implantacao-cobranca";

describe("implantação: cada titular paga UMA vez (AP12)", () => {
  it("⚠️ o caso do dono: 80 na primeira etapa, 20 na segunda", () => {
    // "uma empresa com 100 colaboradores fez a adesão de 80 em uma primeira
    // etapa, e uma segunda etapa dos 20 restantes, será cobrado a implantação
    // nas duas vezes, proporcional à quantidade."

    // 1ª etapa: contrato de 80, ninguém pagou ainda → a regra de sempre.
    expect(
      decidirImplantacao({ limite: 80, ativos: 0, anteriores: [] })
    ).toEqual({ tipo: "primeira" });

    // 2ª etapa: termo de inclusão de +20 (limite 100), 80 já cobertos.
    expect(
      decidirImplantacao({
        limite: 100,
        ativos: 100,
        anteriores: [{ holders_covered: 80 }],
      })
    ).toEqual({ tipo: "diferenca", base: 100, jaCobertos: 80, aCobrar: 20 });
  });

  it("antes da correção a 2ª etapa cobrava os 100 — agora cobra só os 20", () => {
    // O defeito: a conta começava do zero e os 80 pagavam de novo.
    const d = decidirImplantacao({
      limite: 100,
      ativos: 100,
      anteriores: [{ holders_covered: 80 }],
    });
    expect(d.tipo === "diferenca" && d.aCobrar).toBe(20);
  });

  it("a 2ª etapa pode ser cobrada ANTES de os 20 se cadastrarem", () => {
    // A implantação não espera os cadastros (decisão de 25/09): o termo de
    // inclusão aceito já é a base.
    expect(
      decidirImplantacao({
        limite: 100,
        ativos: 80,
        anteriores: [{ holders_covered: 80 }],
      })
    ).toEqual({ tipo: "diferenca", base: 100, jaCobertos: 80, aCobrar: 20 });
  });

  it("⚠️ clique duplo: depois de cobrar, não há mais o que cobrar", () => {
    expect(
      decidirImplantacao({
        limite: 80,
        ativos: 2,
        anteriores: [{ holders_covered: 80 }],
      })
    ).toEqual({ tipo: "nada", base: 80, jaCobertos: 80 });
  });

  it("três etapas somam direito", () => {
    expect(
      decidirImplantacao({
        limite: 120,
        ativos: 120,
        anteriores: [{ holders_covered: 80 }, { holders_covered: 20 }],
      })
    ).toEqual({ tipo: "diferenca", base: 120, jaCobertos: 100, aCobrar: 20 });
  });

  it("empresa sem quantidade contratada: a base são os ativos", () => {
    expect(
      decidirImplantacao({
        limite: null,
        ativos: 60,
        anteriores: [{ holders_covered: 50 }],
      })
    ).toEqual({ tipo: "diferenca", base: 60, jaCobertos: 50, aCobrar: 10 });
  });

  it("mais ativos que o contrato (cadastro antigo): quem está ativo também paga", () => {
    // Antes da trava da quantidade (I4) dava para cadastrar além do contrato.
    // Cobrar pelo contrato deixaria esses titulares sem implantação.
    expect(
      decidirImplantacao({
        limite: 80,
        ativos: 90,
        anteriores: [{ holders_covered: 80 }],
      })
    ).toEqual({ tipo: "diferenca", base: 90, jaCobertos: 80, aCobrar: 10 });
  });

  it("⚠️ implantação antiga SEM registro não vale zero — vale 'não sei'", () => {
    // Zero faria cobrar todo mundo de novo (o defeito); "cobriu todos" poderia
    // deixar de cobrar quem entrou depois. Nenhum dos dois é dado.
    expect(
      decidirImplantacao({
        limite: 100,
        ativos: 100,
        anteriores: [{ holders_covered: null }, { holders_covered: 20 }],
      })
    ).toEqual({ tipo: "desconhecido", semRegistro: 1 });
  });

  it("cobertura acima da base (contrato reduzido) não vira cobrança negativa", () => {
    expect(
      decidirImplantacao({
        limite: 50,
        ativos: 40,
        anteriores: [{ holders_covered: 80 }],
      }).tipo
    ).toBe("nada");
  });
});
