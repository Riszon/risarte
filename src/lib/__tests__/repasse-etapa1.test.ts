import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  countRecalculable,
  groupWatchRows,
  recalculateErrorText,
  watchReasonText,
  watchRowFromDb,
  type WatchRow,
} from "@/lib/finance/payout-watchlist";

/**
 * REPASSE DOS DENTISTAS, ETAPA 1 (0387, 0.417.0).
 *
 * O defeito que o dono viu no treino em 10/11/2026: todo repasse apurado
 * nasceu com R$ 0,00 (o nível do dentista e a tabela chegaram depois da
 * conclusão), não havia como recalcular e a tela não dizia o motivo.
 * A prova de comportamento é `scripts/repasse-ensaio-0387.mjs --confirmar` (transação
 * desfeita no treino); estas réguas prendem o texto da migração e as frases
 * da tela.
 */
const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/0387_repasse_destravar_e_proteger.sql"),
  "utf8"
)
  .replace(/\r\n/g, "\n")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;
const linha = (p: Partial<WatchRow>): WatchRow => ({
  kind: "zerado",
  payoutId: "p1",
  sessionId: null,
  providerName: "Dentista",
  procedureName: "Limpeza",
  refDate: "2026-11-10",
  doneCount: null,
  totalCount: null,
  reason: "sem_valor",
  wouldPayCents: 0,
  ...p,
});

describe("0387 — as travas do repasse moram no banco", () => {
  it("linha em fechamento não é alterada nem apagada", () => {
    expect(sql).toMatch(/if old\.closing_id is not null then\s+raise exception 'PAYOUT_LOCKED'/);
    expect(sql).toMatch(/before update or delete on public\.provider_payouts/);
  });

  it("ninguém grava direto pela API: a regra de escrita livre sai e não volta", () => {
    expect(sql).toContain('drop policy if exists "provider_payouts_write" on public.provider_payouts;');
    expect(sql).not.toMatch(/create policy[^;]*on public\.provider_payouts/);
  });

  it("apagar a sessão não apaga o repasse", () => {
    expect(sql).toMatch(/references public\.treatment_sessions \(id\) on delete restrict/);
  });

  it("só recalcula linha zerada e fora de fechamento", () => {
    const corpo = sql.slice(
      sql.indexOf("function public.payout_recalculate(p_payout_id uuid)"),
      sql.indexOf("function public.payout_recalculate_zeros")
    );
    expect(corpo).toContain("if not public.can_post_finance(v_p.clinic_id) then raise exception 'NOT_ALLOWED'");
    expect(corpo).toContain("if v_p.closing_id is not null then raise exception 'PAYOUT_LOCKED'");
    expect(corpo).toContain("if v_p.amount_cents <> 0 then raise exception 'PAYOUT_NOT_ZERO'");
    // A tabela que vale NA DATA do procedimento, vezes a quantidade do bloco.
    expect(corpo).toContain("v_p.accrual_date)");
    expect(corpo).toContain("coalesce(v_rate.amount_cents, 0) * v_p.units");
    expect(corpo).toContain("recalculated_by = v_user");
    expect(corpo).toContain("insert into public.audit_logs");
  });

  it("procedimento 'sem repasse' não tem valor por nenhum degrau", () => {
    const corpo = sql.slice(
      sql.indexOf("function public.payout_rate_for("),
      sql.indexOf("function public.provider_payouts_mark_no_payout")
    );
    const saida = corpo.indexOf("c.procedure_id = p_procedure_id and c.no_payout");
    expect(saida).toBeGreaterThan(-1);
    // A saída vem ANTES de qualquer degrau da tabela.
    expect(saida).toBeLessThan(corpo.indexOf("from public.provider_payout_rates r"));
  });

  it("a apuração guarda quantos procedimentos a linha paga", () => {
    expect(sql).toContain("accrual_date, amount_cents, rate_id, units");
    expect(sql).toContain("coalesce(v_rate.amount_cents, 0) * v_units, v_rate.rate_id, v_units");
  });

  it("as funções novas não respondem sem login", () => {
    for (const f of ["payout_recalculate(uuid)", "payout_recalculate_zeros(uuid)", "payout_watchlist(uuid)"]) {
      expect(sql).toContain(`revoke execute on function public.${f} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${f} to authenticated;`);
    }
  });

  it("as pendências só saem para quem vê o financeiro da unidade", () => {
    expect(sql).toMatch(/not \(p_clinic_id in \(select public\.finance_visible_clinic_ids\(\)\)\) then\s+raise exception 'NOT_ALLOWED'/);
  });
});

describe("0387 — as pendências, na frase que a pessoa lê", () => {
  it("lê a linha do banco e descarta tipo desconhecido", () => {
    const r = watchRowFromDb({
      kind: "zerado", payout_id: "a", session_id: null, provider_name: "X",
      procedure_name: "Y", ref_date: "2026-11-10", done_count: null,
      total_count: null, reason: "recalculavel", would_pay_cents: "15500",
    });
    expect(r?.wouldPayCents).toBe(15500);
    expect(r?.reason).toBe("recalculavel");
    expect(
      watchRowFromDb({
        kind: "inventado", payout_id: null, session_id: null, provider_name: null,
        procedure_name: null, ref_date: null, done_count: null, total_count: null,
        reason: null, would_pay_cents: null,
      })
    ).toBeNull();
  });

  it("o zerado recalculável diz quanto vai gravar", () => {
    const t = watchReasonText(linha({ reason: "recalculavel", wouldPayCents: 15500 }), brl);
    expect(t).toContain("R$ 155,00");
    expect(t).toContain("Recalcule");
  });

  it("sem nível e sem valor mandam para lugares diferentes", () => {
    expect(watchReasonText(linha({ reason: "sem_nivel" }), brl)).toContain("nível de carreira");
    const semValor = watchReasonText(linha({ reason: "sem_valor" }), brl);
    expect(semValor).toContain("10/11/2026");
    expect(semValor).toContain("sem repasse");
  });

  it("em andamento conta as sessões que faltam", () => {
    expect(
      watchReasonText(linha({ kind: "em_andamento", reason: null, doneCount: 1, totalCount: 3 }), brl)
    ).toContain("1 de 3 sessões concluídas. Entra no repasse quando as 2 sessões que faltam terminarem.");
    expect(
      watchReasonText(linha({ kind: "em_andamento", reason: null, doneCount: 2, totalCount: 3 }), brl)
    ).toContain("a última sessão terminar");
  });

  it("agrupa pondo primeiro o que dá para consertar com um clique", () => {
    const g = groupWatchRows([
      linha({ kind: "sem_procedimento", reason: null, payoutId: null }),
      linha({ reason: "sem_valor", payoutId: "b" }),
      linha({ reason: "recalculavel", payoutId: "a", wouldPayCents: 100 }),
      linha({ kind: "em_andamento", reason: null, payoutId: null, doneCount: 1, totalCount: 3 }),
    ]);
    expect(g.map((x) => x.kind)).toEqual(["zerado", "em_andamento", "sem_procedimento"]);
    expect(g[0].rows.map((r) => r.payoutId)).toEqual(["a", "b"]);
  });

  it("o botão 'recalcular todos' conta só os que já têm valor", () => {
    expect(
      countRecalculable([
        linha({ reason: "recalculavel" }),
        linha({ reason: "sem_nivel" }),
        linha({ kind: "em_andamento", reason: null }),
      ])
    ).toBe(1);
  });

  it("os erros do banco chegam em português", () => {
    expect(recalculateErrorText("PAYOUT_LOCKED")).toContain("fechamento");
    expect(recalculateErrorText("PAYOUT_NOT_ZERO")).toContain("não é recalculado");
    expect(recalculateErrorText("NOT_ALLOWED")).toContain("não permite");
    expect(recalculateErrorText("outra coisa")).toBe("Não foi possível recalcular.");
  });
});
