// AP141 (0398) — VENDA CANCELADA NO MEIO DE UM PROCEDIMENTO PAGA O QUE FOI
// FEITO, PROPORCIONAL ÀS SESSÕES (decisão do dono, 11/11/2026).
//
// Antes, o cancelamento da venda marcava as sessões que faltavam como
// canceladas, e o repasse do procedimento esperava todas "concluídas" para
// sempre: o dentista não recebia nada pelas sessões feitas. A prova de
// comportamento é o ensaio no treino em transação desfeita (ESTADO, 0.430.0);
// esta régua prende o texto, para quem recriar as funções não perder a regra.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { textoDoPagoEmParte } from "@/lib/finance/repasse-em-parte";

const PASTA = join(__dirname, "..", "..", "..", "supabase", "migrations");
const arquivos = readdirSync(PASTA).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const ler = (f: string) =>
  readFileSync(join(PASTA, f), "utf8")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

function ultimaDefinicao(nome: string): { arquivo: string; corpo: string } {
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${nome}\\s*\\([\\s\\S]*?\\bas\\s+(\\$\\w*\\$)([\\s\\S]*?)\\1`,
    "gi"
  );
  let achado: { arquivo: string; corpo: string } | null = null;
  for (const f of arquivos) for (const m of ler(f).matchAll(re)) achado = { arquivo: f, corpo: m[2] };
  if (!achado) throw new Error(`NÃO MEDI: não achei a definição de public.${nome}`);
  return achado;
}

describe("AP141 — repasse de procedimento interrompido pelo cancelamento da venda", () => {
  const gatilho = ultimaDefinicao("accrue_session_payout").corpo;
  const bloco = ultimaDefinicao("_payout_accrue_block").corpo;
  const recalculo = ultimaDefinicao("payout_recalculate").corpo;
  const pendencias = ultimaDefinicao("payout_watchlist").corpo;

  it("cancelar uma sessão de item também fecha a conta do procedimento", () => {
    expect(gatilho).toMatch(
      /if new\.status = 'cancelled' and new\.item_id is not null\s+and \(TG_OP = 'INSERT' or old\.status is distinct from 'cancelled'\) then\s+perform public\._payout_accrue_block\(new\.id\);/
    );
  });

  it("sessão cancelada não segura o procedimento, e sem nenhuma feita nada se paga", () => {
    expect(bloco).toContain("s.status not in ('done', 'cancelled')");
    expect(bloco).toMatch(/where s\.id = any\(v_block\) and s\.status = 'done'[\s\S]*?if v_pay\.id is null then return; end if;/);
  });

  it("o valor é proporcional às sessões concluídas e a linha diz quantas", () => {
    expect(bloco).toMatch(
      /if v_done < v_size then\s+v_amount := round\(v_amount::numeric \* v_done \/ v_size\)::integer;/
    );
    expect(bloco).toContain("case when v_done < v_size then v_done end,");
    expect(bloco).toContain("case when v_done < v_size then v_size end");
  });

  it("recebe quem concluiu a última sessão feita (a que disparou, se foi ela)", () => {
    expect(bloco).toContain("order by (s.id = p_session_id) desc, s.done_at desc nulls last");
    expect(bloco).toContain("v_provider := coalesce(v_pay.executed_by, v_pay.planner_provider_id);");
  });

  it("recalcular e as pendências respeitam a fração (não pagam o inteiro)", () => {
    expect(recalculo).toMatch(
      /if v_p\.sessions_total is not null then\s+v_new := round\(v_new::numeric \* v_p\.sessions_done \/ v_p\.sessions_total\)::bigint;/
    );
    expect(pendencias).toContain("z.z_done::numeric / z.z_total");
  });

  it("a conta do bloco não responde à API", () => {
    const f = arquivos.find((a) => a.startsWith("0398_"));
    if (!f) throw new Error("NÃO MEDI: a 0398 não está na pasta");
    expect(ler(f)).toContain(
      "revoke execute on function public._payout_accrue_block(uuid) from public, anon, authenticated;"
    );
  });

  it("a tela de Repasses mostra o \"pago em parte\"", () => {
    const tela = readFileSync("src/app/(app)/financeiro/repasses/page.tsx", "utf8");
    expect(tela).toContain("sessions_done, sessions_total");
    expect(tela).toContain("textoDoPagoEmParte(r.sessions_done, r.sessions_total)");
    expect(tela).toContain("parteById.get(r.id as string)");
  });

  it("o texto do pago em parte", () => {
    expect(textoDoPagoEmParte(2, 3)).toBe("pago em parte: 2 de 3 sessões (venda cancelada)");
    expect(textoDoPagoEmParte(null, null)).toBeNull();
    expect(textoDoPagoEmParte(3, 3)).toBeNull();
  });
});
