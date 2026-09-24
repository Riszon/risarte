import { describe, expect, it } from "vitest";
import {
  PASSOS_DA_PROPOSTA,
  PASSO_ROTULO,
  resumoDosPassos,
  type DadosDosPassos,
} from "@/lib/empresarial/passos-da-proposta";

const base: DadosDosPassos = {
  titulares: 0,
  mensalidadePorTitularCents: null,
  valorFixo: false,
  temQuemPaga: false,
  faixas: 0,
  minAdhesions: null,
  maxAdhesions: null,
  temRegraDeExcedente: false,
  beneficios: 0,
  unidades: 0,
  validadeDias: null,
  validadePadraoDaRede: 15,
  carenciaEmpresaDias: null,
  carenciaTitularDias: null,
  textoPersonalizado: false,
  faltaContrato: [],
};

describe("os passos da aba Proposta", () => {
  it("tem rótulo para todos, e a ordem é a do trabalho", () => {
    for (const p of PASSOS_DA_PROPOSTA) {
      expect(PASSO_ROTULO[p]).toBeTruthy();
    }
    // O preço vem antes do que está incluso, e os dados cadastrais por último:
    // eles não mudam nada na negociação e estavam no MEIO da precificação.
    expect(PASSOS_DA_PROPOSTA[0]).toBe("precos");
    expect(PASSOS_DA_PROPOSTA.at(-1)).toBe("contrato");
    expect(PASSOS_DA_PROPOSTA.indexOf("condicoes")).toBeLessThan(
      PASSOS_DA_PROPOSTA.indexOf("prazos")
    );
  });

  it("proposta em branco: o preço é o único passo que ACUSA falta", () => {
    const r = resumoDosPassos(base);
    expect(r.precos.estado).toBe("falta");
    expect(r.precos.resumo).toBe("não começou");
    // ⚠️ Zero faixa e zero benefício são decisões legítimas — pintar isso de
    // amarelo ensina a equipe a ignorar aviso.
    expect(r.condicoes.estado).toBe("pronto");
    expect(r.beneficios.estado).toBe("pronto");
    expect(r.prazos.estado).toBe("pronto");
    expect(r.texto.estado).toBe("pronto");
  });

  it("resume o preço com o valor e a quantidade", () => {
    const r = resumoDosPassos({
      ...base,
      temQuemPaga: true,
      mensalidadePorTitularCents: 3990,
      titulares: 90,
    });
    expect(r.precos.estado).toBe("feito");
    expect(r.precos.resumo).toContain("39,90");
    expect(r.precos.resumo).toContain("90 titulares");
  });

  it("um titular só não vira 'titulares'", () => {
    const r = resumoDosPassos({
      ...base,
      temQuemPaga: true,
      mensalidadePorTitularCents: 3990,
      titulares: 1,
    });
    expect(r.precos.resumo).toContain("1 titular");
    expect(r.precos.resumo).not.toContain("titulares");
  });

  it("escolheu quem paga mas não pôs valor: falta o valor", () => {
    const r = resumoDosPassos({ ...base, temQuemPaga: true });
    expect(r.precos.estado).toBe("falta");
    expect(r.precos.resumo).toBe("falta o valor");
  });

  it("valor fixo mensal não exige preço por titular", () => {
    const r = resumoDosPassos({ ...base, temQuemPaga: true, valorFixo: true });
    expect(r.precos.estado).toBe("feito");
    expect(r.precos.resumo).toContain("valor fixo");
  });

  it("sem faixa nenhuma, diz 'preço único' em vez de mentir que falta algo", () => {
    expect(resumoDosPassos(base).condicoes.resumo).toBe("preço único");
  });

  it("resume faixas, mínimo e máximo", () => {
    const r = resumoDosPassos({
      ...base,
      faixas: 3,
      minAdhesions: 50,
      maxAdhesions: 200,
      temRegraDeExcedente: true,
    });
    expect(r.condicoes.estado).toBe("feito");
    expect(r.condicoes.resumo).toContain("3 faixas");
    expect(r.condicoes.resumo).toContain("mín. 50");
    expect(r.condicoes.resumo).toContain("máx. 200");
  });

  it("⚠️ máximo SEM regra de excedente é avisado — é o termo de inclusão nascendo sem valor", () => {
    const r = resumoDosPassos({ ...base, maxAdhesions: 100 });
    expect(r.condicoes.estado).toBe("falta");
    expect(r.condicoes.resumo).toContain("sem regra de excedente");
  });

  it("máximo COM regra de excedente não avisa nada", () => {
    const r = resumoDosPassos({
      ...base,
      maxAdhesions: 100,
      temRegraDeExcedente: true,
    });
    expect(r.condicoes.estado).toBe("feito");
    expect(r.condicoes.resumo).toContain("excedente combinado");
    expect(r.condicoes.resumo).not.toContain("sem regra");
  });

  it("conta benefícios e unidades", () => {
    const r = resumoDosPassos({ ...base, beneficios: 5, unidades: 2 });
    expect(r.beneficios.estado).toBe("feito");
    expect(r.beneficios.resumo).toBe("5 benefícios · 2 unidades");
  });

  it("uma unidade e um benefício ficam no singular", () => {
    const r = resumoDosPassos({ ...base, beneficios: 1, unidades: 1 });
    expect(r.beneficios.resumo).toBe("1 benefício · 1 unidade");
  });

  it("validade em branco mostra o padrão da rede, marcado como padrão", () => {
    const r = resumoDosPassos({ ...base, validadePadraoDaRede: 20 });
    expect(r.prazos.resumo).toBe("20 dias (padrão)");
    expect(r.prazos.estado).toBe("pronto");
  });

  it("validade própria e carências aparecem juntas", () => {
    const r = resumoDosPassos({
      ...base,
      validadeDias: 7,
      carenciaEmpresaDias: 30,
      carenciaTitularDias: 15,
    });
    expect(r.prazos.estado).toBe("feito");
    expect(r.prazos.resumo).toContain("7 dias");
    expect(r.prazos.resumo).toContain("empresa 30d");
    expect(r.prazos.resumo).toContain("titular 15d");
  });

  it("carência ZERO não some do resumo — zero é uma decisão, não ausência", () => {
    const r = resumoDosPassos({ ...base, carenciaEmpresaDias: 0 });
    expect(r.prazos.resumo).toContain("empresa 0d");
  });

  it("o texto diz de quem é", () => {
    expect(resumoDosPassos(base).texto.resumo).toBe("modelo da rede");
    expect(
      resumoDosPassos({ ...base, textoPersonalizado: true }).texto.resumo
    ).toBe("texto próprio");
  });

  it("o contrato usa a régua de verdade, e diz QUAL campo quando é um só", () => {
    expect(resumoDosPassos(base).contrato.estado).toBe("feito");
    const um = resumoDosPassos({ ...base, faltaContrato: ["quem assina"] });
    expect(um.contrato.estado).toBe("falta");
    expect(um.contrato.resumo).toBe("falta quem assina");
    const varios = resumoDosPassos({
      ...base,
      faltaContrato: ["quem assina", "CPF", "razão social"],
    });
    expect(varios.contrato.resumo).toBe("faltam 3 campos");
  });
});
