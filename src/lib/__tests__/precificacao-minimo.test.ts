import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FILTROS_DA_MARGEM,
  margemDeReferenciaDoMinimo,
  margemMinimaValida,
  margemNoPreco,
  passaNoFiltroDaMargem,
  simulatePrice,
} from "@/lib/finance/pricing-simulator";

// A Precificação no preço normal E no preço mínimo, e o filtro pela margem
// (pedido do dono, 27/10/2026).

const ler = (rel: string) =>
  readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");

// Custo direto R$ 200,00; imposto 6% + taxa 3%; margem desejada 40%.
const base = {
  cost: { minutes: 0, chairCostPerHourCents: 0, materialsCents: 20000, labCents: 0, payoutCents: 0 },
  taxPercent: 6,
  acquirerFeePercent: 3,
  targetMarginPercent: 40,
};

describe("a margem num preço", () => {
  it("é a mesma conta do simulador (custo fixo; imposto e taxa sobre o preço)", () => {
    const m = margemNoPreco(base, 50000)!;
    expect(m.impostoETaxaCents).toBe(4500);
    expect(m.margemCents).toBe(50000 - 20000 - 4500);
    expect(m.margemPercent).toBe(simulatePrice({ ...base, currentPriceCents: 50000 }).currentMarginPercent);
    expect(m.abaixoDaMeta).toBe(false); // 51%
  });

  it("no preço mínimo a margem é menor — pode cair abaixo da meta ou dar prejuízo", () => {
    const minimo = margemNoPreco(base, 30000)!; // 30.000 − 20.000 − 2.700 = 7.300 (24,33%)
    expect(minimo.margemPercent).toBe(24.33);
    expect(minimo.abaixoDaMeta).toBe(true);
    const prejuizo = margemNoPreco(base, 21000)!;
    expect(prejuizo.prejuizo).toBe(true);
    expect(prejuizo.abaixoDaMeta).toBe(true);
  });

  it("sem preço não há margem", () => {
    expect(margemNoPreco(base, null)).toBeNull();
    expect(margemNoPreco(base, 0)).toBeNull();
  });
});

describe("o filtro", () => {
  const acima = margemNoPreco(base, 50000);
  const abaixo = margemNoPreco(base, 30000);

  it("acima e abaixo olham o preço NORMAL; sem preço não é nenhum dos dois", () => {
    expect(passaNoFiltroDaMargem("acima", acima, null)).toBe(true);
    expect(passaNoFiltroDaMargem("abaixo", acima, null)).toBe(false);
    expect(passaNoFiltroDaMargem("abaixo", abaixo, null)).toBe(true);
    expect(passaNoFiltroDaMargem("acima", null, null)).toBe(false);
    expect(passaNoFiltroDaMargem("abaixo", null, null)).toBe(false);
    expect(passaNoFiltroDaMargem("sem_preco", null, null)).toBe(true);
    expect(passaNoFiltroDaMargem("sem_preco", acima, null)).toBe(false);
  });

  it("'abaixo no mínimo' pega quem está bem no preço normal e mal no mínimo", () => {
    expect(passaNoFiltroDaMargem("abaixo_no_minimo", acima, abaixo)).toBe(true);
    expect(passaNoFiltroDaMargem("abaixo_no_minimo", acima, null)).toBe(false); // sem mínimo
    expect(passaNoFiltroDaMargem("abaixo_no_minimo", acima, acima)).toBe(false);
  });

  it("na margem exata conta como 'acima'; todos passa tudo", () => {
    const exata = margemNoPreco({ ...base, targetMarginPercent: 51 }, 50000)!;
    expect(passaNoFiltroDaMargem("acima", exata, null)).toBe(true);
    for (const m of [acima, abaixo, null]) expect(passaNoFiltroDaMargem("todos", m, null)).toBe(true);
    expect(Object.keys(FILTROS_DA_MARGEM)).toEqual(["todos", "acima", "abaixo", "abaixo_no_minimo", "sem_preco"]);
  });
});

describe("a margem mínima (pedido do dono, 27/10/2026)", () => {
  it("o preço mínimo se mede pela mínima; sem ela, pela desejada", () => {
    expect(margemDeReferenciaDoMinimo(40, 25)).toBe(25);
    expect(margemDeReferenciaDoMinimo(40, null)).toBe(40);
    expect(margemDeReferenciaDoMinimo(40, 0)).toBe(0); // zero é uma mínima de verdade
  });

  it("com a mínima, o mesmo preço mínimo deixa de estar abaixo", () => {
    // 30.000 dá 24,33%: abaixo da desejada (40), acima de uma mínima de 20.
    const pelaDesejada = margemNoPreco(base, 30000)!;
    const pelaMinima = margemNoPreco({ ...base, targetMarginPercent: margemDeReferenciaDoMinimo(40, 20) }, 30000)!;
    expect(passaNoFiltroDaMargem("abaixo_no_minimo", null, pelaDesejada)).toBe(true);
    expect(passaNoFiltroDaMargem("abaixo_no_minimo", null, pelaMinima)).toBe(false);
  });

  it("a mínima não passa da desejada nem sai de 0 a 100; vazia vale", () => {
    expect(margemMinimaValida(null, 40)).toBeNull();
    expect(margemMinimaValida(30, 40)).toBeNull();
    expect(margemMinimaValida(40, 40)).toBeNull();
    expect(margemMinimaValida(41, 40)).toMatch(/maior que a margem desejada/);
    expect(margemMinimaValida(-1, 40)).toMatch(/0% a 100%/);
  });

  it("é a MESMA do alerta de margem: lida e gravada em commercial_rules.min_margin_percent", () => {
    const page = ler("src/app/(app)/procedimentos/precificacao/page.tsx");
    expect(page).toMatch(/rpc\("min_margin_percent", \{ p_clinic: clinicId \}\)/);
    const acoes = ler("src/app/(app)/procedimentos/precificacao/actions.ts");
    expect(acoes).toMatch(/\.update\(\{ min_margin_percent: minima,/);
    expect(acoes).toMatch(/margemMinimaValida\(input\.minMarginPercent/);
    // a negociação e a venda direta continuam lendo a mesma função
    expect(ler("src/app/(app)/apresentacao/[clientId]/negotiation-loader.ts")).toMatch(/rpc\("min_margin_percent"/);
    expect(ler("src/app/(app)/comercial/venda-direta/page.tsx")).toMatch(/rpc\("min_margin_percent"/);
  });

  it("a tela mede o mínimo pela mínima (filtro, linha, tabela e níveis)", () => {
    const tela = ler("src/app/(app)/procedimentos/precificacao/pricing-simulator-client.tsx");
    expect(tela).toMatch(/const minTarget = margemDeReferenciaDoMinimo\(num\(target\), minMarginValue\)/);
    expect(tela.match(/margemDe\(p, p\.minPriceCents, simLevel, minTarget\)/g)?.length).toBe(3);
    expect(tela).toMatch(/targetPercent: minTarget/);
    expect(tela).toMatch(/m\.currentMarginPercent < minTargetPercent/);
  });
});

describe("a tela", () => {
  const page = ler("src/app/(app)/procedimentos/precificacao/page.tsx");
  const tela = ler("src/app/(app)/procedimentos/precificacao/pricing-simulator-client.tsx");

  it("lê o preço mínimo do cadastro", () => {
    expect(page).toMatch(/default_price_cents, min_price_cents, estimated_minutes/);
    expect(page).toMatch(/minPriceCents: p\.min_price_cents == null \? null : Number\(p\.min_price_cents\)/);
  });

  it("filtra pela margem nos dois preços e mostra a conta lado a lado", () => {
    expect(tela).toMatch(/passaNoFiltroDaMargem\(filtro, margemDe\(p, p\.priceCents\), margemDe\(p, p\.minPriceCents, simLevel, minTarget\)\)/);
    expect(tela).toMatch(/<NormalEMinimo/);
    expect(tela).toMatch(/priceCents: p\.minPriceCents/);
    expect(tela).toMatch(/simulateNoMinimo=\{/);
    expect(tela).not.toMatch(/function margemDeSim/); // uma leitura só: lerMargem
  });

  it("percentual com vírgula: nada de número cru seguido de % (\"93.18%\")", () => {
    expect(tela).not.toMatch(/[Pp]ercent\}%/);
    expect(tela).toMatch(/String\(n\)\.replace\("\.", ","\)/);
  });
});
