import { describe, expect, it } from "vitest";
import {
  buildDre,
  netMarginPercent,
  previousPeriod,
  variation,
  verticalPercent,
  type DreLine,
} from "../finance/dre";

/** Um mês inteiro, com todos os blocos. Valores já com o sinal da direção. */
const mes: DreLine[] = [
  { accountCode: "1.1.01", accountName: "Serviços", block: "receita_bruta", amountCents: 10_000_00 },
  { accountCode: "1.9.01", accountName: "Impostos", block: "deducoes", amountCents: -600_00 },
  { accountCode: "1.9.02", accountName: "Descontos", block: "deducoes", amountCents: -400_00 },
  { accountCode: "2.1.01", accountName: "Repasse", block: "custos_diretos", amountCents: -2_000_00 },
  { accountCode: "2.2.01", accountName: "Material", block: "custos_diretos", amountCents: -800_00 },
  { accountCode: "3.1.01", accountName: "Salários", block: "despesas_operacionais", amountCents: -3_000_00 },
  { accountCode: "5.2.01", accountName: "Depreciação", block: "depreciacao", amountCents: -250_00 },
  { accountCode: "4.1.01", accountName: "Juros recebidos", block: "resultado_financeiro", amountCents: 50_00 },
];

describe("estrutura da DRE", () => {
  const dre = buildDre(mes);

  it("receita líquida = bruta menos deduções", () => {
    expect(dre.receitaBrutaCents).toBe(10_000_00);
    expect(dre.deducoesCents).toBe(-1_000_00);
    expect(dre.receitaLiquidaCents).toBe(9_000_00);
  });

  it("lucro bruto tira o custo direto, não a despesa", () => {
    // Confundir os dois é o erro clássico: o lucro bruto mede a operação
    // clínica, antes da estrutura administrativa.
    expect(dre.lucroBrutoCents).toBe(6_200_00);
  });

  it("EBITDA vem ANTES da depreciação", () => {
    expect(dre.ebitdaCents).toBe(3_200_00);
    expect(dre.lucroLiquidoCents).toBe(3_000_00);
  });

  it("a soma de tudo bate com o lucro líquido", () => {
    // Como o sinal vem da direção, o total é uma soma simples — e é isso que
    // impede um bloco de entrar somando quando deveria subtrair.
    const soma = mes.reduce((s, l) => s + l.amountCents, 0);
    expect(dre.lucroLiquidoCents).toBe(soma);
  });

  it("linha fora da estrutura é ignorada, não somada", () => {
    // Compra de bem (6.2.01) e distribuição de lucro não são resultado.
    const comLixo = buildDre([
      ...mes,
      { accountCode: "6.2.01", accountName: "Bens", block: "fora", amountCents: -30_000_00 },
    ]);
    expect(comLixo.lucroLiquidoCents).toBe(3_000_00);
  });

  it("mês vazio não quebra", () => {
    const vazio = buildDre([]);
    expect(vazio.lucroLiquidoCents).toBe(0);
    expect(netMarginPercent(vazio)).toBeNull();
  });
});

describe("análise vertical", () => {
  const dre = buildDre(mes);

  it("é sobre a receita LÍQUIDA, não a bruta", () => {
    // Material de R$ 800 sobre líquida de R$ 9.000 = 8,89%. Sobre a bruta daria
    // 8% — e toda unidade pareceria mais eficiente do que é.
    expect(verticalPercent(-800_00, dre.receitaLiquidaCents)).toBe(8.89);
  });

  it("sem receita, não inventa percentual", () => {
    expect(verticalPercent(-500_00, 0)).toBeNull();
  });

  it("margem líquida do mês", () => {
    expect(netMarginPercent(dre)).toBe(33.33);
  });
});

describe("comparação com o período anterior", () => {
  it("o período anterior tem o MESMO tamanho", () => {
    // Comparar janeiro (31 dias) com fevereiro (28) sem isso mostraria uma
    // queda de 10% que é só calendário.
    expect(previousPeriod("2026-03-01", "2026-03-31")).toEqual({
      from: "2026-01-29",
      to: "2026-02-28",
    });
  });

  it("período de uma semana volta uma semana", () => {
    expect(previousPeriod("2026-03-09", "2026-03-15")).toEqual({
      from: "2026-03-02",
      to: "2026-03-08",
    });
  });

  it("variação em valor e percentual", () => {
    expect(variation(1_200_00, 1_000_00)).toEqual({
      deltaCents: 200_00,
      percent: 20,
    });
  });

  it("sem base anterior, não inventa percentual", () => {
    // "Cresceu infinito" não ajuda ninguém a decidir.
    expect(variation(500_00, 0)).toEqual({ deltaCents: 500_00, percent: null });
  });

  it("piora de despesa aparece como aumento, não como queda", () => {
    // Despesa é negativa: de -1.000 para -1.200 é 20% de AUMENTO de despesa.
    const v = variation(-1_200_00, -1_000_00);
    expect(v.deltaCents).toBe(-200_00);
    expect(v.percent).toBe(-20);
  });
});
