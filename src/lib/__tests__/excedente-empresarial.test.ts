import { describe, expect, it } from "vitest";
import {
  contaDoExcedente,
  recusaDoCadastro,
  vagasDisponiveis,
  type RegraDoExcedente,
} from "@/lib/empresarial/excedente";

const POR_ADESAO: RegraDoExcedente = {
  modo: "PER_ADHESION",
  fixoCents: null,
  titularCents: 3490,
  dependenteCents: 2490,
  mensalidadeAtualCents: 349_000,
  implantacaoPorAdesaoCents: 1990,
};

const FIXO: RegraDoExcedente = {
  modo: "NEW_FIXED",
  fixoCents: 600_000,
  titularCents: null,
  dependenteCents: null,
  mensalidadeAtualCents: 500_000,
  implantacaoPorAdesaoCents: 0,
};

describe("quantas vagas ainda existem", () => {
  it("LIMITE NULO É SEM TRAVA, não limite zero", () => {
    // Toda empresa cadastrada antes desta regra tem limite nulo. Tratá-las
    // como "zero" pararia a operação inteira por causa de um campo novo.
    const v = vagasDisponiveis(null, 500);
    expect(v.semTrava).toBe(true);
    expect(v.excedente).toBe(0);
  });

  it("conta as vagas que sobram", () => {
    expect(vagasDisponiveis(100, 80).vagas).toBe(20);
    expect(vagasDisponiveis(100, 100).vagas).toBe(0);
  });

  it("acima do contratado, diz QUANTOS passaram", () => {
    const v = vagasDisponiveis(100, 120);
    expect(v.vagas).toBe(0);
    expect(v.excedente).toBe(20);
  });

  it("a recusa diz os DOIS números e o caminho", () => {
    // "Não pode" sozinho faria a pessoa tentar de novo achando que foi engano.
    const t = recusaDoCadastro(100, 100);
    expect(t).toContain("100");
    expect(t).toContain("termo de inclusão");
  });
});

describe("quanto custa incluir os excedentes", () => {
  it("por adesão: preço × quantidade, titular e dependente", () => {
    const c = contaDoExcedente(POR_ADESAO, 20, 5);
    expect(c.mensalDeltaCents).toBe(20 * 3490 + 5 * 2490);
    expect(c.faltaCombinar).toEqual([]);
  });

  it("por adesão: a implantação é só dos TITULARES", () => {
    // Dependente não paga implantação em lugar nenhum do sistema.
    const c = contaDoExcedente(POR_ADESAO, 20, 5);
    expect(c.implantacaoCents).toBe(20 * 1990);
  });

  it("VALOR FIXO cobra a DIFERENÇA, não o pacote inteiro de novo", () => {
    // A empresa já paga a mensalidade atual; cobrar o pacote cheio seria
    // cobrar duas vezes o que ela nunca deixou de pagar.
    const c = contaDoExcedente(FIXO, 30, 0);
    expect(c.mensalDeltaCents).toBe(100_000);
    expect(c.fixoCents).toBe(600_000);
  });

  it("no fixo, a quantidade NÃO multiplica nada", () => {
    // É a definição de valor fixo: o pacote novo vale o que vale.
    expect(contaDoExcedente(FIXO, 5, 0).mensalDeltaCents).toBe(100_000);
    expect(contaDoExcedente(FIXO, 50, 0).mensalDeltaCents).toBe(100_000);
  });

  it("pacote novo MAIS BARATO não vira desconto negativo", () => {
    const c = contaDoExcedente({ ...FIXO, fixoCents: 400_000 }, 10, 0);
    expect(c.mensalDeltaCents).toBe(0);
  });

  it("SEM REGRA COMBINADA, não inventa preço — diz o que falta", () => {
    // Termo com valor chutado é pior que termo nenhum: a empresa assinaria um
    // número que a Risarte não combinou.
    const c = contaDoExcedente({ ...POR_ADESAO, modo: null }, 10, 0);
    expect(c.mensalDeltaCents).toBe(0);
    expect(c.faltaCombinar[0]).toMatch(/não foi combinada/);
  });

  it("por adesão SEM o preço do titular avisa, e só quando há titular", () => {
    const comTitular = contaDoExcedente({ ...POR_ADESAO, titularCents: null }, 10, 0);
    expect(comTitular.faltaCombinar).toContain("o preço do titular excedente");

    const semTitular = contaDoExcedente({ ...POR_ADESAO, titularCents: null }, 0, 5);
    expect(semTitular.faltaCombinar).toEqual([]);
  });

  it("fixo SEM o valor novo avisa", () => {
    const c = contaDoExcedente({ ...FIXO, fixoCents: null }, 10, 0);
    expect(c.faltaCombinar).toContain("o novo valor fixo do pacote");
    expect(c.mensalDeltaCents).toBe(0);
  });

  it("quantidade quebrada ou negativa não vira número estranho", () => {
    expect(contaDoExcedente(POR_ADESAO, -5, 0).mensalDeltaCents).toBe(0);
    expect(contaDoExcedente(POR_ADESAO, 2.9, 0).mensalDeltaCents).toBe(2 * 3490);
  });
});
