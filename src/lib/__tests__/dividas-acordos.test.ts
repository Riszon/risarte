import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  acoesDoAcordo,
  acordoParaOBanco,
  faltaNoAcordo,
  faltamNoEncerramento,
  fraseDoImpactoDoAcordo,
  montarParcelas,
  previaDoBanco,
  somaDasParcelas,
  somarDias,
  somarMeses,
} from "@/lib/finance/dividas-acordos";
import { situacaoDaDivida, valorDevido } from "@/lib/finance/dividas";
import { viewPayable, matchesPayableFilter, PAYABLE_STATUSES, type Payable } from "@/lib/finance/payables";

// LEVANTAMENTO DE DÍVIDAS, FASE 5 (0408): o acordo e o encerramento.
const SQL = readFileSync("supabase/migrations/0408_dividas_renegociacao_e_encerramento.sql", "utf8").replace(/\r\n/g, "\n");
const corpo = (fn: string) => {
  const i = SQL.indexOf(`create or replace function public.${fn}(`);
  if (i < 0) throw new Error(`NÃO MEDI: ${fn} não está na 0408`);
  return SQL.slice(i, SQL.indexOf("\n$$;", i));
};

describe("as parcelas do acordo", () => {
  it("soma meses mantendo o dia, sem pular o fim do mês", () => {
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somarMeses("2028-01-31", 1)).toBe("2028-02-29");
    expect(somarMeses("2026-11-15", 2)).toBe("2027-01-15");
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("entrada + N parcelas iguais; a última absorve o resíduo; a soma fecha", () => {
    const p = montarParcelas({ totalCents: 100000, entradaCents: 10000, parcelas: 7, dataDaEntrada: "2026-11-15", primeiroVencimento: "2026-12-10" });
    expect(p).toHaveLength(8);
    expect(p[0]).toEqual({ vencimento: "2026-11-15", valorCents: 10000, entrada: true });
    expect(p.slice(1, 7).every((x) => x.valorCents === 12857)).toBe(true);
    expect(p[7].valorCents).toBe(90000 - 12857 * 6);
    expect(p[7].vencimento).toBe("2027-06-10");
    expect(somaDasParcelas(p)).toBe(100000);
  });

  it("à vista (sem parcelas) vira uma parcela só", () => {
    expect(montarParcelas({ totalCents: 5000, entradaCents: 0, parcelas: 0, dataDaEntrada: "2026-11-15", primeiroVencimento: "2026-11-20" })).toEqual([
      { vencimento: "2026-11-20", valorCents: 5000, entrada: false },
    ]);
  });

  it("o que falta conferir antes do banco", () => {
    const ok = [{ vencimento: "2026-11-20", valorCents: 5000, entrada: false }];
    expect(faltaNoAcordo({ data: "2026-11-15", hoje: "2026-11-15", totalCents: 5000, parcelas: ok })).toBeNull();
    expect(faltaNoAcordo({ data: "2026-11-16", hoje: "2026-11-15", totalCents: 5000, parcelas: ok })).toMatch(/futura/);
    expect(faltaNoAcordo({ data: "2026-11-15", hoje: "2026-11-15", totalCents: 4999, parcelas: ok })).toMatch(/não fecha/);
    expect(faltaNoAcordo({ data: "2026-11-21", hoje: "2026-11-21", totalCents: 5000, parcelas: ok })).toMatch(/a partir da data/);
  });

  it("vai ao banco em ordem de vencimento, com a entrada primeiro no mesmo dia", () => {
    const p = acordoParaOBanco({
      dividas: ["a"], principal: "a", data: "2026-11-15", totalCents: 300,
      parcelas: [
        { vencimento: "2026-12-15", valorCents: 100, entrada: false },
        { vencimento: "2026-11-15", valorCents: 100, entrada: false },
        { vencimento: "2026-11-15", valorCents: 100, entrada: true },
      ],
      propostaId: null, forma: "", canal: "", contatoId: "", toleranciaDiasUteis: null, observacoes: "  ",
    });
    expect(p.schedule.map((x) => [x.due_date, x.entrada])).toEqual([["2026-11-15", true], ["2026-11-15", false], ["2026-12-15", false]]);
    expect(p.method).toBeNull();
    expect(p.notes).toBeNull();
  });
});

describe("o impacto e os botões", () => {
  it("a frase usa a conferência do banco (desconto, aprovação)", () => {
    const p = previaDoBanco({ problem: null, titles: 2, base_cents: 130000, total_cents: 100000, discount_cents: 30000, surcharge_cents: 0,
      discount_recognition: "proporcional", installments: 5, needs_approval: true, threshold_cents: 50000, tolerance_bdays: 3 });
    const linhas = fraseDoImpactoDoAcordo(p, "Risarte Londrina").join(" ");
    expect(linhas).toMatch(/2 títulos/);
    expect(linhas).toMatch(/5\.5\.02/);
    expect(linhas).toMatch(/4\.1\.03.*proporcional/);
    expect(linhas).toMatch(/aprovação do Admin Master/);
    expect(fraseDoImpactoDoAcordo(previaDoBanco({ problem: "Escolha ao menos uma dívida." }), "x")).toEqual(["Escolha ao menos uma dívida."]);
  });

  it("aprovar: só o Admin Master que não registrou; desfazer só sem pagamento", () => {
    const base = { podeRenegociar: true, souAdminMaster: true, registreiEu: false, temPagamento: false };
    expect(acoesDoAcordo({ ...base, situacao: "aguardando_aprovacao" }).aprovar).toBe(true);
    expect(acoesDoAcordo({ ...base, situacao: "aguardando_aprovacao", registreiEu: true }).aprovar).toBe(false);
    expect(acoesDoAcordo({ ...base, situacao: "aguardando_aprovacao", souAdminMaster: false }).aprovar).toBe(false);
    expect(acoesDoAcordo({ ...base, situacao: "em_andamento" }).desfazer).toBe(true);
    expect(acoesDoAcordo({ ...base, situacao: "em_andamento", temPagamento: true }).desfazer).toBe(false);
    expect(acoesDoAcordo({ ...base, situacao: "quebrado", temPagamento: true })).toEqual({ aprovar: false, desfazer: false, restabelecer: true, renegociarDeNovo: true });
    expect(acoesDoAcordo({ ...base, situacao: "cumprido" })).toEqual({ aprovar: false, desfazer: false, restabelecer: false, renegociarDeNovo: false });
  });

  it("o encerramento conta o que falta (o \"não se aplica\" resolve)", () => {
    const i = (aplicavel: boolean, feitoEm: string | null) => ({ id: "x", item: "quitacao" as const, aplicavel, motivoDeNaoAplicar: null, prazo: null, feitoEm, feitoPor: null, anexoId: null, observacao: null });
    expect(faltamNoEncerramento([i(true, null), i(false, null), i(true, "2026-11-15")])).toBe(1);
  });
});

describe("a situação e o saldo (espelho de _debt_compute_status / _debt_positions)", () => {
  const b = { dueDate: "2025-01-10", manualStage: null, today: "2026-11-15", daysToDefault: 30 };
  it("precedência do 4.1", () => {
    expect(situacaoDaDivida({ ...b, acordo: "em_andamento" })).toBe("acordo_em_andamento");
    expect(situacaoDaDivida({ ...b, acordo: "aguardando_aprovacao" })).toBe("acordo_em_andamento");
    expect(situacaoDaDivida({ ...b, acordo: "quebrado" })).toBe("acordo_quebrado");
    expect(situacaoDaDivida({ ...b, acordo: "em_andamento", manualStage: "judicial" })).toBe("judicial");
    expect(situacaoDaDivida({ ...b, acordo: "em_andamento", manualStage: "em_negociacao" })).toBe("acordo_em_andamento");
    expect(situacaoDaDivida({ ...b, quitada: { encerrada: false } })).toBe("quitada_pendencias");
    expect(situacaoDaDivida({ ...b, quitada: { encerrada: true }, manualStage: "contestada" })).toBe("quitada_encerrada");
    expect(situacaoDaDivida({ ...b, manualStage: "baixada", quitada: { encerrada: true } })).toBe("baixada");
    // O restabelecido vence hoje: conta dele, não do vencimento original.
    expect(situacaoDaDivida({ ...b, vencimentoMaisAntigo: "2026-11-15" })).toBe("a_vencer");
  });

  it("com o saldo da regra única, o valor devido é ele (o acordo com desconto não aparece pelo original)", () => {
    expect(valorDevido({ updatedCents: 120000, originalCents: 100000, pagoCents: 20000 })).toBe(100000);
    expect(valorDevido({ updatedCents: 120000, originalCents: 100000, pagoCents: 20000, saldoCents: 76924 })).toBe(76924);
    expect(valorDevido({ updatedCents: 120000, originalCents: 100000, saldoCents: 0 })).toBe(0);
  });
});

describe("o título renegociado no Contas a Pagar", () => {
  const p = { amountCents: 1000, paidAmountCents: 0, paidFeeCents: 0, paidInterestCents: 0, dueDate: "2026-01-01" } as unknown as Payable;
  it("não é conta em aberto nem vencida, e tem filtro próprio", () => {
    expect(PAYABLE_STATUSES).toContain("renegociada");
    const v = viewPayable({ ...p, status: "renegociada" }, "2026-11-15");
    expect(v.isOpen).toBe(false);
    expect(v.isOverdue).toBe(false);
    expect(matchesPayableFilter(v, "renegociadas")).toBe(true);
    expect(matchesPayableFilter(v, "a_vencer")).toBe(false);
  });
});

describe("a 0408 (réguas sobre o SQL)", () => {
  it("o pagamento não mexe na situação \"renegociada\" (refresh_payable_payment)", () => {
    expect(corpo("refresh_payable_payment")).toMatch(/'cancelada', 'recusada', 'aguardando_autorizacao', 'renegociada'\)\s*then v_status/);
  });

  it("título renegociado não recebe pagamento novo; o estorno de um antigo pode", () => {
    const g = corpo("payable_payments_renegotiated_guard");
    expect(g).toMatch(/new\.reversal_of is null/);
    expect(g).toMatch(/PAYABLE_RENEGOTIATED/);
  });

  it("estorno do desconto no restabelecimento é lançamento NOVO com data de hoje (nunca reversal_of)", () => {
    const u = corpo("_debt_agreement_unrecognize");
    expect(u).toMatch(/'debt_agreement_reversal'/);
    expect(u).toMatch(/v_today/);
    expect(u).not.toMatch(/reversal_of/);
    expect(corpo("debt_agreement_reestablish")).toMatch(/_debt_agreement_unrecognize\(a\.id, true/);
  });

  it("aprovar é só do Admin Master e nunca de quem registrou", () => {
    const d = corpo("debt_agreement_decide");
    expect(d).toMatch(/is_admin_master\(\)/);
    expect(d).toMatch(/a\.created_by = v_uid/);
  });

  it("a situação da dívida usa o saldo da regra única", () => {
    expect(corpo("_debt_compute_status")).toMatch(/_debt_positions\(array\[d\.id\]\)/);
    expect(corpo("_debt_snapshot_month")).toMatch(/_debt_positions\(v_ids\)/);
  });

  it("as tabelas novas só têm regra de LEITURA, e nenhuma usa função interna (o logado não executaria)", () => {
    const pol = [...SQL.matchAll(/create policy "([^"]+)" on public\.(\w+) for (\w+) to authenticated\n\s+using \(([^;]+)\);/g)];
    expect(pol.length).toBe(3);
    expect(pol.every((p) => p[3] === "select")).toBe(true);
    expect(pol.some((p) => /_debt_/.test(p[4]))).toBe(false);
  });

  it("toda função que responde a logados tira o anônimo antes", () => {
    const grants = [...SQL.matchAll(/grant execute on function (public\.\w+)\(/g)].map((m) => m[1]);
    expect(grants.length).toBeGreaterThanOrEqual(7);
    for (const f of grants) {
      expect(SQL).toMatch(new RegExp(`revoke execute on function ${f.replace(".", "\\.")}\\([^)]*\\) from public, anon, authenticated`));
    }
  });
});
