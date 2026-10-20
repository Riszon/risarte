import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  atrasados,
  mensagemDaVigencia,
  proximoReajuste,
  quandoVale,
  type Agendamento,
} from "@/lib/vigencia-do-preco";

// 0309 — vigência do preço (Odontograma OD1, decisão D3 do dono, 20/10/2026):
// o preço de hoje continua onde está; o banco guarda o histórico sozinho e
// aplica o reajuste agendado na madrugada da data; data no passado não pode.

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const M = ler("supabase/migrations/0309_vigencia_do_preco.sql");
const corpoDe = (nome: string) => {
  const i = M.indexOf(`function public.${nome}(`);
  return M.slice(i, M.indexOf("$$;", i));
};

const ag = (id: string, procedureId: string, clinicId: string | null, validFrom: string): Agendamento => ({
  id, procedureId, clinicId, priceCents: 100, validFrom, note: null,
});

describe("a régua da data", () => {
  it("vazio ou hoje vale na hora; futuro agenda; passado e inválida não", () => {
    expect(quandoVale("", "2026-10-20")).toBe("hoje");
    expect(quandoVale("2026-10-20", "2026-10-20")).toBe("hoje");
    expect(quandoVale("2026-11-01", "2026-10-20")).toBe("futuro");
    expect(quandoVale("2026-10-19", "2026-10-20")).toBe("passado");
    expect(quandoVale("20/10/2026", "2026-10-20")).toBe("invalida");
  });

  it("atrasado = a data já chegou; próximo = o mais cedo DAQUELE preço", () => {
    const lista = [ag("a", "p1", null, "2026-10-19"), ag("b", "p1", null, "2026-12-01"), ag("c", "p1", "u1", "2026-11-01"), ag("d", "p3", null, "2026-10-20")];
    // o de HOJE também: a madrugada já devia tê-lo aplicado
    expect(atrasados(lista, "2026-10-20").map((a) => a.id)).toEqual(["a", "d"]);
    expect(proximoReajuste(lista, "p1", "u1")?.id).toBe("c");
    expect(proximoReajuste(lista, "p1", null)?.id).toBe("a");
    expect(proximoReajuste(lista, "p2", null)).toBeNull();
  });

  it("os recados do banco em português; o desconhecido não vira chute", () => {
    expect(mensagemDaVigencia("DATE_NOT_FUTURE")).toMatch(/a partir de amanhã/);
    expect(mensagemDaVigencia("ALGO")).toBeNull();
  });
});

describe("o banco (0309)", () => {
  it("TODA mudança de preço vira histórico — pelo gatilho, nas duas tabelas", () => {
    expect(M).toContain("after insert or update of default_price_cents on public.procedures");
    expect(M).toContain("after insert or update of price_cents or delete on public.clinic_procedure_prices");
  });

  it("o histórico não muda nem se apaga — só vai junto do procedimento nunca usado", () => {
    const f = corpoDe("procedure_price_history_immutable");
    expect(f).toContain("if tg_op = 'DELETE' and pg_trigger_depth() > 1 then");
    expect(f).toContain("raise exception 'PRICE_HISTORY_IMMUTABLE';");
    expect(M).toContain("before update or delete on public.procedure_price_history");
  });

  it("o histórico conta o que valeu de verdade: a data é sempre a de hoje", () => {
    expect(corpoDe("_price_history_context")).toContain("o_valid_from := public.today_br();");
    expect(M).not.toContain("price_valid_from");
  });

  it("reajuste atrasado não passa por cima de mudança feita à mão", () => {
    const f = corpoDe("_apply_due_procedure_prices");
    expect(f).toContain("and h.source in ('alteracao', 'remocao')");
    expect(f).toContain("and h.valid_from >= s.valid_from) then");
    expect(f).toContain("continue;");
  });

  it("agendar: só o Admin, só data futura, e não abre sem login", () => {
    for (const f of ["schedule_procedure_price", "schedule_price_readjust"]) {
      expect(corpoDe(f), f).toContain("if v_user is null or not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;");
      expect(corpoDe(f), f).toContain("if p_valid_from is null or p_valid_from <= public.today_br() then raise exception 'DATE_NOT_FUTURE'; end if;");
    }
    expect(M).toContain("revoke execute on function public._apply_due_procedure_prices() from public, anon, authenticated;");
    expect(M).toContain("'risarte-precos-agendados', '5 3 * * *'");
  });

  it("o histórico fica fora da auditoria (já é histórico), o agendamento entra", () => {
    expect(M).toContain("values ('public', 'procedure_price_history',");
    expect(M).toContain("select public.audit_attach_all();");
  });
});

describe("as telas", () => {
  const acoes = ler("src/app/(app)/procedimentos/actions.ts");

  it("preço com data futura: o de hoje NÃO muda, o novo fica agendado", () => {
    expect(acoes).toContain("? { ...parsed.values, default_price_cents: old.default_price_cents }");
    expect(acoes).toContain('await supabase.rpc("schedule_procedure_price", {');
    expect(acoes).toContain('await supabase.rpc("schedule_price_readjust", {');
    // o preço da UNIDADE tem o seu próprio desvio para o agendamento
    expect(acoes).toContain('  if (quando === "futuro") {\n    if (price.trim() === "") {');
    expect(acoes).toContain("      p_clinic_id: clinicId,\n      p_price_cents: cents,");
  });

  it("data no passado é recusada nos três caminhos", () => {
    expect(acoes.match(/if \(quando === "passado" \|\| quando === "invalida"\) \{/g)).toHaveLength(3);
  });

  it("a data aparece na edição, no preço da unidade e no reajuste em massa; o atrasado avisa", () => {
    expect(ler("src/app/(app)/procedimentos/procedures-editor.tsx")).toContain("          mostrarVigencia\n        />");
    expect(ler("src/app/(app)/procedimentos/procedures-editor.tsx")).toContain("setUnitPrice(selectedUnitId, p.id, unitPrice, unitValidFrom)");
    expect(ler("src/app/(app)/procedimentos/bulk-panels.tsx")).toContain("validFrom: validFrom || undefined,");
    expect(ler("src/app/(app)/procedimentos/page.tsx")).toContain("quantos={atrasados(agendamentos, todayInBrazil()).length}");
  });
});
