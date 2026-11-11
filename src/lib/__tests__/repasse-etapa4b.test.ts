import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FAILURE_OUTCOME_LABEL,
  FAILURE_SOURCE_LABEL,
  PAYMENT_STATE_LABEL,
  correctionError,
  discountError,
  eventLabel,
  failureEffectText,
  failureErrorText,
  failureFromDb,
  itemPaymentText,
  reportItemFromDb,
  type ReportPayment,
} from "@/lib/finance/payout-report";

/**
 * REPASSE DOS DENTISTAS, ETAPA 4B (0400) — o desconto por falha do dentista.
 *
 * A prova de comportamento é `scripts/repasse-ensaio-0400.mjs --confirmar`
 * (transação desfeita no treino, 36 conferências). Estas réguas prendem no
 * texto da migração as travas que não podem sumir numa recriação de função,
 * e as frases da tela.
 */
const ler = (arq: string) =>
  readFileSync(join(process.cwd(), arq), "utf8").replace(/\r\n/g, "\n");
const sql = ler("supabase/migrations/0400_repasse_falha_do_dentista.sql")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

const corpo = (nome: string) => {
  const ini = sql.search(new RegExp(`create (?:or replace )?function public\\.${nome}\\s*\\(`));
  if (ini < 0) throw new Error(`NÃO MEDI: não achei public.${nome} na 0400`);
  return sql.slice(ini, sql.indexOf("revoke execute on function", ini));
};

describe("0400 — um procedimento, um desconto", () => {
  it("só uma ocorrência viva por repasse", () => {
    expect(sql).toMatch(
      /create unique index if not exists payout_failures_one_live\s+on public\.payout_failures \(payout_id\) where status in \('aberta', 'falha'\)/
    );
  });

  it("valor negativo só em linha de desconto, e desconto sempre negativo", () => {
    expect(sql).toContain(
      "check ((failure_id is null and amount_cents >= 0) or (failure_id is not null and amount_cents < 0))"
    );
  });

  it("o desconto nunca passa do valor pago", () => {
    expect(corpo("payout_failure_decide")).toContain(
      "if v_amount <= 0 or v_amount > v_base then raise exception 'INVALID_AMOUNT'"
    );
  });

  it("ninguém grava ocorrência direto: só leitura na regra", () => {
    expect(sql).not.toMatch(/create policy[^;]*on public\.payout_failures\s+for (all|insert|update|delete)/);
  });
});

describe("0400 — quem decide", () => {
  it("quem aprova a equipe; sem ninguém, o Financeiro; nunca o próprio dentista", () => {
    const c = corpo("can_decide_payout_failure");
    expect(c).toContain("f.provider_id <> (select auth.uid())");
    expect(c).toMatch(/not exists \(select 1 from public\._payout_failure_deciders\(f\.clinic_id, f\.provider_id\)\)\s+and public\.can_manage_payout_reports\(\)/);
    const d = corpo("_payout_failure_deciders");
    expect(d).toContain("m.user_id <> p_provider_id");
    expect(d).toContain("not exists (select 1 from mgr) and c.user_id <> p_provider_id");
  });

  it("decidir é uma ocorrência por chamada (sem lote)", () => {
    expect(sql).toMatch(/function public\.payout_failure_decide\(\s*p_failure_id uuid, p_is_failure boolean, p_reason text,\s*p_discount_cents bigint default null\s*\)/);
  });

  it("o dentista não lê ocorrências", () => {
    expect(corpo("payout_failure_list")).toContain("and f.provider_id <> (select auth.uid())");
  });
});

describe("0400 — o que 'foi falha' faz", () => {
  const d = corpo("payout_failure_decide");

  it("F1: refação pelo mesmo dentista não desconta", () => {
    expect(d).toMatch(/if v_f\.source = 'qualidade' and v_f\.resolution = 'redo_same' then\s+[^]*?v_outcome := 'refaz_sem_custo'/);
  });

  it("já em relatório, em conta ou pago: desconto; fora de relatório: não paga", () => {
    expect(d).toMatch(/elsif \(v_item\.id is not null or v_p\.closing_id is not null\) and v_base > 0 then\s+[^]*?v_outcome := 'desconto'/);
    expect(d).toContain("v_outcome := 'nao_pagar'");
  });

  it("F2: quem refez recebe só quando outro dentista refez", () => {
    expect(d).toMatch(/and v_f\.resolution = 'redo_other' then\s+perform public\._payout_accrue_block\(v_p\.session_id\)/);
    const b = corpo("_payout_accrue_block");
    expect(b).toMatch(/p\.failure_voided_at is null\s+or not exists \(\s+select 1 from public\.payout_failures f\s+where f\.payout_id = p\.id and f\.status = 'falha'\s+and f\.resolution = 'redo_other'\)/);
  });

  it("a sessão anulada por falha libera um novo repasse da mesma sessão", () => {
    expect(sql).toContain("drop index if exists public.provider_payouts_session_unique;");
    expect(sql).toMatch(/on public\.provider_payouts \(session_id\)\s+where session_id is not null and failure_voided_at is null/);
  });

  it("os gatilhos que abrem a ocorrência nunca derrubam a reprovação nem o cancelamento", () => {
    for (const f of ["plan_quality_reviews_payout_failure", "plan_cancellations_payout_failure"]) {
      expect(corpo(f)).toMatch(/exception when others then\s+raise warning/);
    }
  });
});

describe("0400 — a conta a pagar abate o desconto (F4)", () => {
  const b = corpo("payout_report_bill");

  it("só gera com repasse positivo liberado", () => {
    expect(b).toContain("if v_pos <= 0 then raise exception 'NOTHING_TO_BILL'");
  });

  it("o desconto que não cabe é partido; o saldo vira outra linha de desconto", () => {
    expect(b).toContain("n.amount_cents + v_room, p.failure_id");
    expect(b).toContain("exclusion_kind = 'adiar'");
  });

  it("desconto que consome tudo: pagamento compensado, sem conta a pagar", () => {
    expect(b).toMatch(/if v_total > 0 then\s+select full_name/);
    expect(sql).toContain("check (\n    amount_cents >= 0 and ((payable_id is null) = (amount_cents = 0))\n  )");
  });

  it("relatório só de desconto não nasce", () => {
    expect(corpo("payout_report_generate")).toMatch(/select distinct p\.provider_id[^]*?and p\.amount_cents > 0/);
  });

  it("corrigir um desconto é descontar menos", () => {
    expect(corpo("payout_report_finance_decide")).toContain(
      "(v_i.amount_cents < 0 and (p_new_amount_cents >= 0 or p_new_amount_cents < v_i.amount_cents))"
    );
  });
});

describe("as frases da 4B", () => {
  it("o efeito de 'foi falha' é dito antes do clique, pela mesma regra do banco", () => {
    expect(failureEffectText({ source: "qualidade", resolution: "redo_same", paidState: "pago" })).toContain("Nada a descontar");
    expect(failureEffectText({ source: "manual", resolution: null, paidState: "fora_de_relatorio" })).toContain("deixa de ser pago");
    const outro = failureEffectText({ source: "qualidade", resolution: "redo_other", paidState: "pago" });
    expect(outro).toContain("Desconto no próximo relatório");
    expect(outro).toContain("Quem refizer recebe");
  });

  it("o desconto pedido: vazio vale o pago; zero, negativo ou acima do pago é recusado", () => {
    expect(discountError(null, 10000)).toBeNull();
    expect(discountError(5000, 10000)).toBeNull();
    expect(discountError(0, 10000)).not.toBeNull();
    expect(discountError(-1, 10000)).not.toBeNull();
    expect(discountError(10001, 10000)).not.toBeNull();
  });

  it("corrigir: repasse não vira desconto; desconto só diminui", () => {
    expect(correctionError(8000, 10000)).toBeNull();
    expect(correctionError(-100, 10000)).not.toBeNull();
    expect(correctionError(-8000, -10000)).toBeNull();
    expect(correctionError(-12000, -10000)).not.toBeNull();
    expect(correctionError(500, -10000)).not.toBeNull();
  });

  it("a linha de desconto chega com o motivo", () => {
    const i = reportItemFromDb({
      item_id: "i", payout_id: "p", finished_on: "2026-11-11", procedure_name: "Desconto por falha — X",
      client_id: null, client_name: null, session_id: null, origin: "desconto", amount_cents: "-10000",
      status: "incluido", exclusion_kind: null, exclusion_reason: null, excluded_by_name: null,
      excluded_at: null, failure_reason: "restauração refeita", has_failure: false,
    });
    expect(i.origin).toBe("desconto");
    expect(i.amountCents).toBe(-10000);
    expect(i.failureReason).toBe("restauração refeita");
  });

  it("pagamento compensado tem nome e frase", () => {
    const p = { state: "compensado", itemIds: [] } as unknown as ReportPayment;
    expect(PAYMENT_STATE_LABEL.compensado.length).toBeGreaterThan(5);
    expect(itemPaymentText(true, p)).toBe("Compensado pelo desconto");
  });

  it("ocorrência do banco vira dado da tela, com padrões seguros", () => {
    const f = failureFromDb({
      id: "f", clinic_id: "c", clinic_name: "Unidade", provider_id: "d", provider_name: null,
      payout_id: "p", procedure_name: null, finished_on: "2026-11-01", client_id: null, client_name: null,
      payout_cents: "10000", source: "inventada", source_note: null, resolution: null, status: "x",
      outcome: null, base_cents: null, discount_cents: null, decision_reason: null, decided_by_name: null,
      decided_at: null, created_by_name: null, created_at: "2026-11-11T10:00:00Z", can_decide: null,
      paid_state: "?",
    });
    expect(f.source).toBe("manual");
    expect(f.status).toBe("aberta");
    expect(f.canDecide).toBe(false);
    expect(f.paidState).toBe("fora_de_relatorio");
  });

  it("cada origem, desfecho, erro e evento tem frase", () => {
    for (const s of ["qualidade", "cancelamento", "manual"] as const) expect(FAILURE_SOURCE_LABEL[s]).toBeTruthy();
    for (const o of ["desconto", "nao_pagar", "refaz_sem_custo"] as const) expect(FAILURE_OUTCOME_LABEL[o]).toBeTruthy();
    for (const c of ["ALREADY_OPEN", "INVALID_ITEM", "INVALID_AMOUNT", "WRONG_STAGE", "NOT_ALLOWED"]) {
      expect(failureErrorText(c)).not.toContain(c);
    }
    for (const a of ["compensado", "desconto_partido"]) expect(eventLabel(a)).not.toBe(a);
  });
});
