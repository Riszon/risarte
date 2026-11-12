import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FALHA_SAIDAS,
  linkDeLigacao,
  mediationError,
  mensagemDaDivergencia,
  roteiro,
  type MediationContact,
} from "@/lib/finance/payout-divergencia";
import { MY_REVIEW_LABEL, REVIEW_LABEL, reportErrorText, reviewFromDb } from "@/lib/finance/payout-report";

/**
 * REPASSE — A DIVERGÊNCIA QUE CHEGA AO FINANCEIRO (0402, pedido do dono de
 * 12/11/2026 depois do RP-000006 da Londrina).
 *
 * A prova de comportamento é `scripts/repasse-ensaio-0402.mjs --confirmar`
 * (transação desfeita no treino, 30 conferências). Aqui: as regras presas no
 * texto da migração e a conta pura da tela.
 */
const ler = (arq: string) =>
  readFileSync(join(process.cwd(), arq), "utf8").replace(/\r\n/g, "\n");
const sql = ler("supabase/migrations/0402_repasse_divergencia.sql")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");
const corpo = (nome: string) => {
  const ini = sql.search(new RegExp(`create (?:or replace )?function public\\.${nome}\\s*\\(`));
  if (ini < 0) throw new Error(`NÃO MEDI: não achei public.${nome} na 0402`);
  return sql.slice(ini, sql.indexOf("revoke execute on function", ini));
};

describe("0402 — o roteiro antes de decidir", () => {
  const d = corpo("payout_report_finance_decide");

  it("sem a conversa com a unidade E com o dentista, a decisão é recusada", () => {
    expect(d).toMatch(
      /not public\._payout_mediation_done\(p_item_id, 'unidade'\)\s+or not public\._payout_mediation_done\(p_item_id, 'dentista'\) then\s+raise exception 'MEDIATION_REQUIRED'/
    );
  });

  it("a orientação é obrigatória", () => {
    expect(d).toContain("raise exception 'GUIDANCE_REQUIRED'");
  });

  it("só conta a conversa registrada depois que a linha chegou ao Financeiro", () => {
    expect(corpo("_payout_mediation_done")).toContain(
      "m.created_at >= coalesce(i.finance_since, '-infinity'::timestamptz)"
    );
    // o relógio real: duas conversas na mesma transação não empatam
    expect(sql).toContain("new.finance_since := clock_timestamp();");
    expect(sql).toContain("alter column created_at set default clock_timestamp()");
  });

  it("a conversa registrada não muda nem se apaga", () => {
    expect(sql).toMatch(/before update or delete on public\.payout_mediation_contacts/);
  });

  it("a conversa e a lista são só do Financeiro, e nunca do dentista do relatório", () => {
    for (const f of ["payout_mediation_record", "payout_mediation_list", "payout_mediation_people"]) {
      expect(corpo(f)).toContain("public.can_manage_payout_reports()");
    }
    expect(corpo("payout_mediation_record")).toContain("if v_r.provider_id = v_user then raise exception 'NOT_ALLOWED'");
  });
});

describe("0402 — o valor corrigido volta para aprovação", () => {
  const d = corpo("payout_report_finance_decide");

  it("fora da rodada final, corrigir só PROPÕE (não libera nem muda o valor)", () => {
    const ini = d.indexOf("proposed_amount_cents = p_new_amount_cents");
    expect(ini).toBeGreaterThan(0);
    const propor = d.slice(ini, d.indexOf("financeiro_propos_valor", ini));
    expect(d).toMatch(/review_state = case when v_has_unit then 'correcao_unidade' else 'correcao_dentista' end,\s+released = false/);
    expect(propor).not.toMatch(/^\s+amount_cents = p_new_amount_cents/m);
  });

  it("só a rodada final corrige e libera direto", () => {
    expect(d).toMatch(/if v_i\.final_round then[\s\S]*?amount_cents = p_new_amount_cents,[\s\S]*?released = true/);
  });

  it("a unidade confirma; o dentista aceita; não concordar abre a rodada final", () => {
    const ack = corpo("payout_report_value_ack");
    expect(ack).toContain("public.can_approve_payout_report(v_i.report_id)");
    expect(ack).toContain("v_i.review_state <> 'correcao_unidade'");
    const resp = corpo("payout_report_value_respond");
    expect(resp).toContain("v_r.provider_id <> v_user");
    expect(resp).toMatch(/set review_state = 'no_financeiro', final_round = true/);
  });

  it("o valor aceito chega ao repasse (o Histórico de repasse lê provider_payouts)", () => {
    expect(corpo("payout_report_value_respond")).toContain(
      "update public.provider_payouts set amount_cents = v_i.proposed_amount_cents"
    );
    expect(d).toContain("update public.provider_payouts set amount_cents = p_new_amount_cents");
  });

  it("o dentista não vê o valor antes de a unidade confirmar", () => {
    expect(corpo("my_payout_report_detail")).toContain(
      "case when i.review_state = 'correcao_unidade' then null else i.proposed_amount_cents end"
    );
  });

  it("a decisão do Financeiro tem uma versão só (a antiga é derrubada)", () => {
    expect(sql).toContain("drop function if exists public.payout_report_finance_decide(uuid, text, text, bigint, text);");
  });
});

const contato = (o: Partial<MediationContact>): MediationContact => ({
  itemId: "i1",
  party: "unidade",
  outcome: "conversou",
  channel: "whatsapp",
  contactName: null,
  summary: "conversamos",
  createdByName: null,
  createdAt: "2026-11-12T10:00:00Z",
  counts: true,
  ...o,
});

describe("a conta da tela", () => {
  it("a decisão se libera só com as duas conversas desta rodada", () => {
    expect(roteiro([contato({})], "i1").podeDecidir).toBe(false);
    expect(roteiro([contato({}), contato({ party: "dentista", counts: false })], "i1").podeDecidir).toBe(false);
    const r = roteiro([contato({}), contato({ party: "dentista", outcome: "sem_contato", channel: null })], "i1");
    expect(r.podeDecidir).toBe(true);
    expect(roteiro([contato({}), contato({ party: "dentista" })], "outra").podeDecidir).toBe(false);
  });

  it("registrar a conversa: canal quando conversou, resumo sempre", () => {
    expect(mediationError({ outcome: "conversou", channel: null, summary: "tudo certo" })).toContain("por onde");
    expect(mediationError({ outcome: "sem_contato", channel: null, summary: "oi" })).toContain("tentou");
    expect(mediationError({ outcome: "conversou", channel: "ligacao", summary: "tudo certo" })).toBeNull();
  });

  it("a mensagem pronta não leva o nome do cliente (vai pelo WhatsApp)", () => {
    const m = mensagemDaDivergencia({ party: "dentista", reportCode: "RP-000006", procedureName: "Restauração", amountCents: 15500 });
    expect(m).toContain("RP-000006");
    expect(m).toContain("{nome}");
    expect(m).not.toMatch(/cliente:/i);
  });

  it("ligar só com DDD", () => {
    expect(linkDeLigacao("(43) 99999-0000")).toBe("tel:+5543999990000");
    expect(linkDeLigacao("9999-0000")).toBeNull();
    expect(linkDeLigacao(null)).toBeNull();
  });

  it("os estados novos têm nome nas duas visões, e o banco é lido", () => {
    expect(REVIEW_LABEL.correcao_unidade).toBeTruthy();
    expect(MY_REVIEW_LABEL.correcao_dentista).toBeTruthy();
    const r = reviewFromDb({ review_state: "correcao_dentista", proposed_amount_cents: "12000", final_round: true, prev_report_code: "RP-000006" });
    expect(r.reviewState).toBe("correcao_dentista");
    expect(r.proposedAmountCents).toBe(12000);
    expect(r.finalRound).toBe(true);
    expect(r.prevReportCode).toBe("RP-000006");
  });

  it("as recusas novas têm frase", () => {
    expect(reportErrorText("MEDIATION_REQUIRED")).toContain("unidade e com o dentista");
    expect(reportErrorText("GUIDANCE_REQUIRED")).toContain("orientação");
  });

  it("a explicação da falha cobre as quatro saídas do banco (0400)", () => {
    expect(FALHA_SAIDAS).toHaveLength(4);
    const f = ler("supabase/migrations/0400_repasse_falha_do_dentista.sql");
    for (const s of ["'refaz_sem_custo'", "'desconto'", "'nao_pagar'", "'sem_falha'"]) expect(f).toContain(s);
  });
});
