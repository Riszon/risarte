import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPROVER_LABEL,
  CONTEST_KINDS,
  CONTEST_LABEL,
  MIN_REASON,
  MY_REVIEW_LABEL,
  MY_STATUS_LABEL,
  REPORT_STATUS_LABEL,
  REVIEW_LABEL,
  correctionError,
  dentistResponseError,
  eventLabel,
  nextStepText,
  reportErrorText,
  reviewFromDb,
} from "@/lib/finance/payout-report";

/**
 * REPASSE DOS DENTISTAS, ETAPA 3 (0391) — as aprovações.
 *
 * A prova de comportamento é `scripts/repasse-ensaio-0391.mjs --confirmar`
 * (transação desfeita no treino, 43 conferências: o caminho inteiro, com
 * Financeiro, Coordenador, Gerente e dentista). Estas réguas prendem no texto
 * da migração as travas que não podem sumir numa recriação de função, e as
 * frases da tela.
 */
const ler = (arq: string) =>
  readFileSync(join(process.cwd(), arq), "utf8").replace(/\r\n/g, "\n");
const sql = ler("supabase/migrations/0391_repasse_aprovacoes.sql")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

/** O corpo de uma função, do `create` até o `revoke` dela. */
const corpo = (nome: string) => {
  const ini = sql.search(new RegExp(`create (?:or replace )?function public\\.${nome}\\s*\\(`));
  if (ini < 0) throw new Error(`NÃO MEDI: não achei public.${nome} na 0391`);
  return sql.slice(ini, sql.indexOf("revoke execute on function", ini));
};

describe("0391 — quem aprova", () => {
  it("ninguém aprova o próprio relatório", () => {
    expect(corpo("can_approve_payout_report")).toContain(
      "pr.provider_id <> (select auth.uid())"
    );
    const a = corpo("_payout_report_approvers");
    expect(a).toContain("m.user_id <> r.provider_id");
    expect(a).toContain("c.user_id <> r.provider_id");
  });

  it("o Coordenador só aprova quando a unidade NÃO tem Gerente", () => {
    expect(corpo("_payout_report_approvers")).toMatch(
      /from coord c, r\s+where not exists \(select 1 from mgr\)/
    );
  });

  it("sem aprovador na unidade, é o Financeiro — e não quem enviou", () => {
    const c = corpo("can_approve_payout_report");
    expect(c).toContain("not exists (select 1 from public._payout_report_approvers(p_report_id))");
    expect(c).toContain("and public.can_manage_payout_reports()");
    expect(c).toContain("and pr.sent_by is distinct from (select auth.uid())");
  });

  it("aprovar recebe UM relatório: não existe função em lote", () => {
    expect(sql).toMatch(/function public\.payout_report_manager_approve\(p_report_id uuid\)/);
    const assinaturas = [...sql.matchAll(/function public\.(\w*approve\w*)\(([^)]*)\)/g)];
    for (const [, nome, args] of assinaturas) {
      expect(args, nome).not.toMatch(/\[\]|jsonb|json/);
    }
  });

  it("cada passo confere a etapa e quem está fazendo", () => {
    const passos: [string, string, string][] = [
      ["payout_report_send", "can_manage_payout_reports()", "v_r.status <> 'rascunho'"],
      ["payout_report_return", "can_approve_payout_report(p_report_id)", "v_r.status <> 'com_gerente'"],
      ["payout_report_manager_approve", "can_approve_payout_report(p_report_id)", "v_r.status <> 'com_gerente'"],
      ["payout_report_dentist_respond", "v_r.provider_id <> v_user", "v_r.status <> 'com_dentista'"],
      ["payout_report_manager_answer", "can_approve_payout_report(v_i.report_id)", "v_r.status <> 'em_contestacao'"],
      ["payout_report_finance_decide", "can_manage_payout_reports()", "v_i.review_state <> 'no_financeiro'"],
    ];
    for (const [f, quem, etapa] of passos) {
      const c = corpo(f);
      expect(c, `${f}: quem`).toContain(quem);
      expect(c, `${f}: etapa`).toContain(etapa);
    }
  });

  it("depois de enviado, só o aprovador ajusta as linhas (e só na vez dele)", () => {
    const g = corpo("_payout_report_can_adjust");
    expect(g).toContain("p_status = 'rascunho' and public.can_manage_payout_reports()");
    expect(g).toContain("p_status = 'com_gerente' and public.can_approve_payout_report(p_report_id)");
    for (const f of ["payout_report_exclude_item", "payout_report_restore_item"]) {
      const c = corpo(f);
      expect(c, f).toContain("if v_status not in ('rascunho', 'com_gerente') then raise exception 'REPORT_NOT_DRAFT'");
      expect(c, f).toContain("if not public._payout_report_can_adjust(v_i.report_id, v_status) then raise exception 'NOT_ALLOWED'");
    }
  });
});

describe("0391 — o dentista", () => {
  const r = corpo("payout_report_dentist_respond");

  it("contestar exige motivo da lista e texto", () => {
    expect(r).toContain("v_kind not in ('valor', 'nao_fui_eu', 'outro') then raise exception 'INVALID_KIND'");
    expect(r).toContain(`length(v_text) < ${MIN_REASON} then raise exception 'REASON_REQUIRED'`);
    // A lista da tela é a mesma do banco.
    expect([...CONTEST_KINDS].sort()).toEqual(["nao_fui_eu", "outro", "valor"]);
  });

  it("APROVAÇÃO PARCIAL: o que não foi contestado fica liberado para pagar", () => {
    expect(r).toMatch(
      /set review_state = 'aprovado', released = true, released_at = now\(\)\s+where report_id = p_report_id and status = 'incluido' and review_state = 'pendente'/
    );
  });

  it("a 2ª contestação da mesma linha vai ao Financeiro", () => {
    expect(r).toContain("case when contest_round >= 1 then 'no_financeiro' else 'contestado' end");
  });

  it("ele só lê pelas funções dele, e elas não trazem o registro interno", () => {
    for (const f of ["my_payout_reports", "my_payout_report_detail"]) {
      const c = corpo(f);
      expect(c, f).toContain("provider_id = (select auth.uid())");
      expect(c, f).toContain("in ('com_dentista', 'em_contestacao', 'em_desempate', 'aprovado')");
      expect(c, f).not.toMatch(/exclusion_|excluded_|payout_report_events/);
    }
    expect(corpo("my_payout_report_detail")).toContain(
      "where i.report_id = p_report_id and i.status = 'incluido'"
    );
    // Nenhuma regra de leitura nova nas tabelas: o dentista não as lê direto.
    expect(sql).not.toMatch(/create policy/);
  });

  it("o prazo lembra e avisa, e NUNCA aprova", () => {
    const d = corpo("payout_report_deadline_run");
    expect(d).toContain("dentist_escalated_at = now()");
    expect(d).toContain("dentist_reminded_at = now()");
    expect(d).not.toMatch(/released\s*=\s*true/);
    expect(d).not.toMatch(/review_state\s*=/);
    expect(d).not.toMatch(/set status/);
    expect(sql).toContain("'risarte-payout-reports-daily', '20 8 * * *'");
    expect(sql).not.toMatch(/grant execute on function public\.payout_report_deadline_run/);
  });

  it("5 dias úteis pulam fim de semana e feriado nacional", () => {
    const b = corpo("_payout_add_business_days");
    expect(b).toContain("extract(dow from v_date) not in (0, 6)");
    expect(b).toContain("h.holiday_date = v_date and h.scope = 'national'");
    expect(corpo("payout_report_manager_approve")).toContain(
      "public._payout_add_business_days(public.today_br(), 5)"
    );
  });
});

describe("0391 — o Financeiro decide", () => {
  const f = corpo("payout_report_finance_decide");

  it("só ele, com motivo, e nunca sobre o próprio repasse", () => {
    expect(f).toContain("if not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'");
    expect(f).toContain("if v_r.provider_id = v_user then raise exception 'NOT_ALLOWED'");
    expect(f).toContain("raise exception 'REASON_REQUIRED'");
  });

  it("corrigir guarda o valor antigo e recusa valor igual ou zerado", () => {
    expect(f).toContain("p_new_amount_cents <= 0 or p_new_amount_cents = v_i.amount_cents");
    expect(f).toContain("original_amount_cents = coalesce(original_amount_cents, amount_cents)");
  });

  it("o aprovador não tem caminho para mudar valor", () => {
    expect(corpo("payout_report_manager_answer")).not.toMatch(/amount_cents\s*=/);
    expect(corpo("payout_report_manager_approve")).not.toMatch(/amount_cents\s*=/);
  });
});

describe("0391 — funções e avisos", () => {
  it("nenhuma função responde sem login; as internas nem a logado", () => {
    const criadas = new Set(
      [...sql.matchAll(/create (?:or replace )?function public\.(\w+)\s*\(/g)].map((m) => m[1])
    );
    expect(criadas.size).toBeGreaterThanOrEqual(25);
    for (const nome of criadas) {
      expect(sql, nome).toMatch(
        new RegExp(`revoke execute on function public\\.${nome}\\([^)]*\\) from public, anon, authenticated;`)
      );
      if (nome.startsWith("_") || nome === "payout_report_deadline_run") {
        expect(sql, `${nome} é interna`).not.toMatch(
          new RegExp(`grant execute on function public\\.${nome}\\(`)
        );
      }
    }
  });

  it("os avisos do sino não levam dado de paciente", () => {
    const titulos = [...sql.matchAll(/_payout_report_notify\(([\s\S]*?)\);/g)].map((m) => m[1]);
    expect(titulos.length).toBeGreaterThanOrEqual(8);
    for (const t of titulos) expect(t).not.toMatch(/client|full_name|cpf|phone/i);
    expect(corpo("payout_report_deadline_run")).not.toMatch(/client|full_name|cpf|phone/i);
  });

  it("toda ação gravada na linha do tempo tem frase", () => {
    const diretas = [
      ...sql.matchAll(/perform public\._payout_report_event\([^,]+,[^,]+,[^,]+,\s*'(\w+)'/g),
    ].map((m) => m[1]);
    const emCase = [...sql.matchAll(/(?:then|else) '(\w+)'(?=[\s\S]{0,40}?(?:end|else))/g)]
      .map((m) => m[1])
      .filter((a) => /^(item_|contestado|aprovado|cancelado|em_|voltou_)/.test(a));
    const todas = new Set([...diretas, ...emCase, "prazo_vencido"]);
    expect(todas.size).toBeGreaterThanOrEqual(14);
    for (const a of todas) expect(eventLabel(a), a).not.toBe(a);
  });
});

describe("0391 — a tela", () => {
  it("toda situação do banco tem rótulo, e o dentista tem os dele", () => {
    const situacoes = [...sql.matchAll(/'(rascunho|com_gerente|com_dentista|em_contestacao|em_desempate|aprovado|cancelado)'/g)].map((m) => m[1]);
    for (const s of new Set(situacoes)) expect(REPORT_STATUS_LABEL[s], s).toBeTruthy();
    for (const s of ["com_dentista", "em_contestacao", "em_desempate", "aprovado"]) {
      expect(MY_STATUS_LABEL[s], s).toBeTruthy();
    }
    for (const k of CONTEST_KINDS) expect(CONTEST_LABEL[k]).toBeTruthy();
    for (const k of ["gerente", "coordenador", "financeiro"]) expect(APPROVER_LABEL[k]).toBeTruthy();
    expect(Object.keys(REVIEW_LABEL).sort()).toEqual(Object.keys(MY_REVIEW_LABEL).sort());
  });

  it("a resposta do dentista é conferida antes de ir ao banco", () => {
    expect(dentistResponseError([], "")).toBeNull();
    expect(dentistResponseError([{ itemId: "a", kind: "valor", text: "abc" }], "")).toContain("Explique");
    expect(dentistResponseError([{ itemId: "a", kind: "valor", text: "valor errado" }], "")).toBeNull();
    expect(dentistResponseError([], "abc")).toContain("faltando");
    expect(dentistResponseError([], "faltou a limpeza")).toBeNull();
    expect(
      dentistResponseError([{ itemId: "a", kind: "inventado" as never, text: "motivo longo" }], "")
    ).toContain("motivo");
  });

  it("a correção de valor recusa vazio, zero e valor igual", () => {
    expect(correctionError(null, 10000)).not.toBeNull();
    expect(correctionError(0, 10000)).not.toBeNull();
    expect(correctionError(10000, 10000)).toContain("igual");
    expect(correctionError(8000, 10000)).toBeNull();
  });

  it("a conversa lida do banco não inventa estado nem motivo", () => {
    const r = reviewFromDb({
      review_state: "inventado", released: null, contest_kind: "x", contest_round: null,
      finance_action: "y", original_amount_cents: "10000",
    });
    expect(r.reviewState).toBeNull();
    expect(r.contestKind).toBeNull();
    expect(r.financeAction).toBeNull();
    expect(r.released).toBe(false);
    expect(r.contestRound).toBe(0);
    expect(r.originalAmountCents).toBe(10000);
    expect(reviewFromDb({}).originalAmountCents).toBeNull();
  });

  it("o próximo passo diz de quem é a vez", () => {
    const base = { approverKind: "coordenador", dentistDueOn: "2026-11-17" };
    expect(nextStepText({ ...base, status: "com_gerente" })).toContain("Coordenador clínico");
    expect(nextStepText({ ...base, status: "com_dentista" })).toContain("17/11/2026");
    expect(nextStepText({ ...base, status: "em_desempate" })).toContain("Financeiro");
    expect(nextStepText({ ...base, status: "aprovado" })).toContain("Liberado para pagar");
  });

  it("os erros novos do banco chegam em português", () => {
    for (const cod of ["WRONG_STAGE", "EMPTY_REPORT", "INVALID_ITEM", "INVALID_AMOUNT", "NOT_ALLOWED"]) {
      const t = reportErrorText(cod);
      expect(t, cod).not.toContain(cod);
      expect(t, cod).not.toBe("Não foi possível concluir. Tente de novo.");
    }
  });

  it("a visão do dentista não importa nada do registro interno", () => {
    const tela = ler("src/app/(app)/repasses/[id]/my-report-view.tsx");
    expect(tela).not.toMatch(/exclusion|excludedBy|payout_report_history|eventLabel/);
    const pagina = ler("src/app/(app)/repasses/[id]/page.tsx");
    // O dentista do relatório cai SEMPRE na visão dele, antes de qualquer outra.
    expect(pagina.indexOf("if (eu.is_provider)")).toBeGreaterThan(-1);
    expect(pagina.indexOf("if (eu.is_provider)")).toBeLessThan(pagina.indexOf("carregarRelatorio(supabase, id)"));
  });
});
