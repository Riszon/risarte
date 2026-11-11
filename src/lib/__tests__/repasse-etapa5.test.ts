import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  farolRepasse,
  fimDoMes,
  historyFromDb,
  liquido,
  mesesDoPeriodo,
  percentualDoRepasse,
  periodoDoEndereco,
  porAtencaoRepasse,
  porDentista,
  porMes,
  relatorioDaRede,
  relatorioDoHistorico,
  somar,
  textoDoPercentual,
  totaisDaRede,
  type HistoryRow,
  type NetworkPayoutRow,
} from "@/lib/finance/payout-visoes";
import { destinoNaUnidade, parseNetworkTab } from "@/lib/finance/network-areas";

/**
 * REPASSE DOS DENTISTAS, ETAPA 5 (0401) — as visões.
 *
 * A prova de comportamento é `scripts/repasse-ensaio-0401.mjs --confirmar`
 * (transação desfeita no treino, 17 conferências). Aqui: as regras da conta,
 * presas no texto da migração, e a conta pura das telas.
 */
const ler = (arq: string) =>
  readFileSync(join(process.cwd(), arq), "utf8").replace(/\r\n/g, "\n");
const sql = ler("supabase/migrations/0401_repasse_visoes.sql")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");
const corpo = (nome: string) => {
  const ini = sql.search(new RegExp(`create (?:or replace )?function public\\.${nome}\\s*\\(`));
  if (ini < 0) throw new Error(`NÃO MEDI: não achei public.${nome} na 0401`);
  return sql.slice(ini, sql.indexOf("revoke execute on function", ini));
};

describe("0401 — a conta de cada linha", () => {
  const l = corpo("_payout_lines");

  it("fica de fora o que não vai ser pago: sem repasse, não pagar e o anulado não pago", () => {
    expect(l).toContain("when b.no_payout or b.withheld or b.amount_cents <= 0 then 'nao_pagar'");
    expect(l).toContain("when b.failure_voided_at is not null and b.falha = 'nao_pagar' then 'nao_pagar'");
  });

  it("produção = preço do plano × desconto da negociação aceita; venda direta = valor final", () => {
    expect(l).toMatch(/n\.final_cents::numeric \/ nullif\(n\.subtotal_cents, 0\)[\s\S]*?n\.status = 'aceita'/);
    expect(l).toContain("di.final_cents::numeric / greatest(di.quantity, 1)");
  });

  it("Ortodontia, desconto e o anulado por falha não têm produção", () => {
    expect(l).toContain("when c.tipo <> 'repasse' or c.failure_voided_at is not null then null");
  });

  it("pago = fechamento antigo, conta paga ou compensada", () => {
    expect(l).toContain("when c.closing_id is not null then 'pago'");
    expect(l).toContain("when pp.id is not null and pp.payable_id is null then 'pago'");
    expect(l).toContain("when pa.status = 'paga' then 'pago'");
  });

  it("a conta das linhas não responde a ninguém", () => {
    expect(sql).toContain("revoke execute on function public._payout_lines(uuid[], date, date, uuid) from public, anon, authenticated;");
    expect(sql).not.toMatch(/grant execute on function public\._payout_lines/);
  });
});

describe("0401 — quem vê", () => {
  it("a unidade: quem lê o financeiro dela", () => {
    expect(corpo("payout_history")).toContain("not (p_clinic_id in (select public.finance_visible_clinic_ids()))");
  });

  it("a rede: só a Franqueadora", () => {
    expect(corpo("payout_network_summary")).toContain(
      "if not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'"
    );
  });

  it("o dentista: só o próprio repasse, sem a produção", () => {
    const m = corpo("my_payout_evolution");
    expect(m).toContain("public._payout_lines(v_ids, p_from, p_to, v_user)");
    const retorno = sql.slice(sql.indexOf("create function public.my_payout_evolution"), sql.indexOf("language plpgsql", sql.indexOf("create function public.my_payout_evolution")));
    expect(retorno).not.toContain("produced");
  });

  it("período limitado a 36 meses", () => {
    expect(corpo("_payout_period_ok")).toContain("interval '36 months'");
  });
});

const linha = (o: Partial<HistoryRow>): HistoryRow => ({
  month: "2026-10-01",
  providerId: "a",
  providerName: "Ana",
  levelName: "Júnior",
  procedures: 1,
  producedCents: 100000,
  producedMissing: 0,
  orthoCount: 0,
  payoutCents: 30000,
  discountCents: 0,
  paidCents: 0,
  scheduledCents: 0,
  waitingCents: 30000,
  ...o,
});

describe("a conta das telas", () => {
  it("os meses do período, inclusive virando o ano", () => {
    expect(mesesDoPeriodo("2025-11", "2026-02")).toEqual(["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
    expect(fimDoMes("2026-02")).toBe("2026-02-28");
    expect(fimDoMes("2028-02")).toBe("2028-02-29");
  });

  it("o período do endereço: padrão 12 meses, nunca futuro, nunca mais de 36", () => {
    expect(periodoDoEndereco(undefined, undefined, "2026-11-11")).toEqual({ de: "2025-12", ate: "2026-11" });
    expect(periodoDoEndereco("2026-01", "2027-05", "2026-11-11")).toEqual({ de: "2026-01", ate: "2026-11" });
    expect(periodoDoEndereco("2020-01", "2026-11", "2026-11-11")).toEqual({ de: "2023-12", ate: "2026-11" });
    expect(periodoDoEndereco("2026-12", "2026-11", "2026-11-11").de).toBe("2025-12");
    expect(periodoDoEndereco("lixo", "13-2026", "2026-11-11")).toEqual({ de: "2025-12", ate: "2026-11" });
  });

  it("mês sem nada aparece zerado; somas e líquido", () => {
    const rows = [linha({}), linha({ providerId: "b", providerName: "Bruno", discountCents: -5000 })];
    const m = porMes(rows, ["2026-09-01", "2026-10-01"]);
    expect(m[0].t.payoutCents).toBe(0);
    expect(m[1].t.payoutCents).toBe(60000);
    expect(liquido(m[1].t)).toBe(55000);
    expect(somar(rows).producedCents).toBe(200000);
  });

  it("dentistas lado a lado em ordem de NOME (sem ranking)", () => {
    const rows = [
      linha({ providerId: "z", providerName: "Zélia", payoutCents: 999999 }),
      linha({ providerId: "a", providerName: "Ana", payoutCents: 1 }),
      linha({ providerId: "a", providerName: "Ana", month: "2026-11-01", payoutCents: 2 }),
    ];
    const d = porDentista(rows);
    expect(d.map((x) => x.providerName)).toEqual(["Ana", "Zélia"]);
    expect(d[0].t.payoutCents).toBe(3);
  });

  it("% do repasse sobre a produção; sem produção = traço", () => {
    expect(percentualDoRepasse({ producedCents: 100000, payoutCents: 30000 })).toBe(30);
    expect(percentualDoRepasse({ producedCents: 0, payoutCents: 30000 })).toBeNull();
    expect(textoDoPercentual(null)).toBe("—");
    expect(textoDoPercentual(32.5)).toBe("32,5%");
  });

  it("o banco devolve texto e data com hora; a tela trabalha com número e AAAA-MM-01", () => {
    const r = historyFromDb({
      month: "2026-10-01T00:00:00.000Z", provider_id: "a", provider_name: null, level_name: null,
      procedures: 2, produced_cents: "123", produced_missing: null, ortho_count: null,
      payout_cents: "45", discount_cents: "-5", paid_cents: null, scheduled_cents: null, waiting_cents: null,
    });
    expect(r.month).toBe("2026-10-01");
    expect(r.producedCents).toBe(123);
    expect(r.discountCents).toBe(-5);
    expect(r.providerName).toBe("—");
  });
});

const unidade = (o: Partial<NetworkPayoutRow>): NetworkPayoutRow => ({
  clinicId: "c", nome: "Unidade", ownership: "franchised", dentists: 1, procedures: 1,
  producedCents: 0, payoutCents: 10000, discountCents: 0, paidCents: 0, scheduledCents: 0,
  waitingCents: 10000, overdueCents: 0, openFailures: 0, reportsInReview: 0, ...o,
});

describe("a aba Repasses do Painel da rede", () => {
  it("a aba existe e leva ao histórico da unidade no mesmo mês", () => {
    expect(parseNetworkTab("repasses")).toBe("repasses");
    expect(destinoNaUnidade("repasses", "2026-10-01", "2026-10-31")).toBe(
      "/financeiro/repasses/historico?de=2026-10&ate=2026-10"
    );
  });

  it("vencido sem pagar = vermelho; aprovação ou ocorrência parada = amarelo; sem repasse = sem dado", () => {
    expect(farolRepasse(unidade({ overdueCents: 100 })).farol).toBe("vermelho");
    expect(farolRepasse(unidade({ openFailures: 1 })).farol).toBe("amarelo");
    expect(farolRepasse(unidade({ reportsInReview: 2 })).motivo).toContain("2 relatórios em aprovação");
    expect(farolRepasse(unidade({})).farol).toBe("verde");
    expect(farolRepasse(unidade({ payoutCents: 0 })).farol).toBe("sem_dado");
  });

  it("ordem de atenção e total da rede", () => {
    const us = [unidade({ nome: "B" }), unidade({ nome: "A", overdueCents: 1 })];
    expect([...us].sort(porAtencaoRepasse)[0].nome).toBe("A");
    expect(totaisDaRede(us).payoutCents).toBe(20000);
  });

  it("as planilhas dizem o período e os limites", () => {
    const h = relatorioDoHistorico({ unidade: "U", de: "2026-01", ate: "2026-02", rows: [linha({})], geradoPor: "X", geradoEm: "agora" });
    expect(h.linhas).toHaveLength(1);
    expect(h.notas.join(" ")).toContain("finalizado");
    const r = relatorioDaRede({ de: "2026-01", ate: "2026-01", unidades: [unidade({})], geradoPor: "X", geradoEm: "agora" });
    expect(r.colunas.some((c) => c.chave === "vencido")).toBe(true);
  });
});
