import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  divisaoDoPremio,
  presenteDoIndicadoCents,
  situacaoDoPresente,
} from "@/lib/indica/presente";
import { numerosDoOrcamento } from "@/lib/orcamento";

// AP24 (decisões do dono, 04/11/2026; I1–I4 em
// docs/indica-mais-risos/AP24-PLANO.md): o presente de boas-vindas do indicado
// (botão, por fora da regra comercial, validade do comparecimento, uma vez) e o
// prêmio individual da equipe em Riso Coins. Provado no treino (ensaio da
// 0363 + 2011, transação desfeita, 22/22; sem elas, 8 reprovam).

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const corpo = (sql: string, assinatura: string) => {
  const i = sql.indexOf(assinatura);
  expect(i, assinatura).toBeGreaterThan(-1);
  return sql.slice(i, sql.indexOf("$$;", sql.indexOf("$$", i) + 2));
};

describe("AP24 — as contas", () => {
  it("I2: o presente é % do que o cliente pagaria", () => {
    expect(presenteDoIndicadoCents(300000, 10)).toBe(30000);
    expect(presenteDoIndicadoCents(12345, 10)).toBe(1235);
    expect(presenteDoIndicadoCents(300000, null)).toBe(0);
    expect(presenteDoIndicadoCents(-5, 10)).toBe(0);
  });

  it("I3: a situação segue a ordem do banco", () => {
    const agora = new Date("2026-11-04T12:00:00Z");
    const base = { presenteUsadoEm: null, vendaId: null, compareceuEm: "2026-10-01T12:00:00Z", validoAte: "2026-11-30T12:00:00Z", agora };
    expect(situacaoDoPresente(base)).toBe("disponivel");
    expect(situacaoDoPresente({ ...base, validoAte: "2026-11-01T12:00:00Z" })).toBe("vencido");
    expect(situacaoDoPresente({ ...base, compareceuEm: null, validoAte: null })).toBe("aguarda_avaliacao");
    expect(situacaoDoPresente({ ...base, vendaId: "v" })).toBe("encerrado");
    expect(situacaoDoPresente({ ...base, presenteUsadoEm: "x", vendaId: "v" })).toBe("usado");
  });

  it("I4: a divisão dos Riso Coins entre quem pediu e quem fechou", () => {
    expect(divisaoDoPremio({ totalRisoCoins: 100, percentualOrigem: 50, origemId: "a", fechamentoId: "b" }))
      .toEqual([{ usuarioId: "a", papel: "origem", risoCoins: 50 }, { usuarioId: "b", papel: "fechamento", risoCoins: 50 }]);
    expect(divisaoDoPremio({ totalRisoCoins: 100, percentualOrigem: 50, origemId: "a", fechamentoId: "a" }))
      .toEqual([{ usuarioId: "a", papel: "origem_e_fechamento", risoCoins: 100 }]);
    expect(divisaoDoPremio({ totalRisoCoins: 100, percentualOrigem: 30, origemId: null, fechamentoId: "b" }))
      .toEqual([{ usuarioId: "b", papel: "fechamento", risoCoins: 70 }]);
    expect(divisaoDoPremio({ totalRisoCoins: 0, percentualOrigem: 50, origemId: "a", fechamentoId: "b" })).toEqual([]);
  });

  it("o orçamento impresso fecha com o presente", () => {
    const it_ = { id: "a", description: "x", quantity: 1, unitPriceCents: 300000, programDiscountCents: 0, plannedSessions: null, included: true };
    const n = numerosDoOrcamento([it_], { adjustmentCents: 0, finalCents: 270000, presenteCents: 30000 });
    expect(n.bate).toBe(true);
    expect(n.presenteCents).toBe(30000);
    expect(numerosDoOrcamento([it_], { adjustmentCents: 0, finalCents: 270000 }).bate).toBe(false);
  });
});

describe("AP24 — o banco (0363 + 2011) e a tela", () => {
  const core = ler("supabase/migrations/0363_presente_de_boas_vindas_na_negociacao.sql");
  const indica = ler("supabase/migrations/2011_indica_presente_e_premio_individual.sql");

  it("a regra comercial tira o presente do total, por fora do % do desconto", () => {
    const ev = corpo(core, "create or replace function public.evaluate_negotiation_rules(");
    expect(ev).toContain("v_final := greatest(0, v_subtotal - v_program + v_neg.adjustment_cents - v_presente);");
    expect(ev).toContain("greatest(0, v_subtotal - v_program)::numeric");
    expect(ev).toContain("indica_presente_cents = v_presente,");
    // I2: o % do desconto continua medido só pelo ajuste.
    expect(ev).toContain("(-v_neg.adjustment_cents)::numeric * 100 / v_discountable");
  });

  it("as colunas do presente só mudam pela porta", () => {
    expect(core).toContain("create trigger plan_negotiations_presente_guard");
    expect(corpo(indica, "create or replace function indica.aplicar_presente(")).toContain("set_config('risarte.presente_indica', 'sim', true)");
  });

  it("a porta confere quem, a validade, o uso e o primeiro tratamento", () => {
    const ap = corpo(indica, "create or replace function indica.aplicar_presente(");
    // Cada recusa presa à PERGUNTA que a dispara (a palavra sozinha não basta).
    expect(ap).toMatch(/if v_uid is null or not \(\s*public\.is_admin_master\(\)[\s\S]*?raise exception 'INDICA_SEM_PERMISSAO/);
    expect(ap).toMatch(/if v_p\.situacao = 'usado' and v_p\.negociacao_id is distinct from p_negociacao_id then\s+raise exception 'INDICA_PRESENTE_USADO/);
    expect(ap).toMatch(/elsif v_p\.situacao = 'encerrado' then\s+raise exception 'INDICA_PRESENTE_SO_NO_PRIMEIRO/);
    expect(ap).toMatch(/elsif v_p\.situacao = 'aguarda_avaliacao' then\s+raise exception 'INDICA_PRESENTE_SEM_AVALIACAO/);
    expect(ap).toMatch(/elsif v_p\.situacao = 'vencido' then\s+raise exception 'INDICA_PRESENTE_VENCIDO/);
    expect(ap).toMatch(/tp\.complement_of_plan_id is not null\)\s+or exists[\s\S]*?n\.status in \('aceita', 'cancelada'\)\) then\s+raise exception 'INDICA_PRESENTE_SO_NO_PRIMEIRO/);
    const leitura = corpo(indica, "create or replace function indica._presente_do_cliente(");
    expect(leitura).toContain("v.compareceu_em + make_interval(days => v_dias::integer)");
  });

  it("o aceite marca o uso e o prêmio nasce na conversão, blindados", () => {
    const aceite = corpo(indica, "create or replace function indica.automacao_presente_no_aceite(");
    expect(aceite).toContain("new.status = 'aceita' and old.status is distinct from 'aceita'");
    expect(aceite).toContain("exception when others then");
    const premio = corpo(indica, "create or replace function indica.automacao_premio_equipe(");
    expect(premio).toContain("new.status = 'convertida'");
    expect(premio).toContain("exception when others then");
    expect(corpo(indica, "create or replace function indica._premiar_equipe(")).toContain("'premio_individual_riso_coins'");
  });

  it("a tela soma o presente no total e oferece o botão", () => {
    const painel = ler("src/app/(app)/apresentacao/[clientId]/negotiation-panel.tsx");
    expect(painel).toContain("const finalCents = Math.max(0, payableCents + effectiveAdjustmentCents - presenteCents);");
    expect(painel).toContain("onClick={() => mudarPresente(true)}");
    expect(ler("src/app/(app)/apresentacao/[clientId]/negotiation-loader.ts")).toContain(
      "presente: complementoId ? null : await carregarPresente("
    );
    for (const pg of ["src/app/(app)/apresentacao/[clientId]/page.tsx", "src/app/(app)/comercial/[clientId]/page.tsx"]) {
      expect(ler(pg), pg).toContain("presente={negotiationBlock.presente}");
    }
  });
});
