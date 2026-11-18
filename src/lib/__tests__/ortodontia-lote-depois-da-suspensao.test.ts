import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inicioDoProximoLote } from "@/lib/ortodontia/regras";

// AP181 (0430, 18/11/2026): depois de suspender e retomar, o lote novo nascia
// depois do lote que a suspensão cancelou inteiro (no roteiro: lote 3 em
// 05/2028; de 12/2026 a 04/2028 sem mensalidade). Agora o lote novo parte do
// último mês coberto — o fim de um lote ATIVO ou a última mensalidade NÃO
// cancelada —, nunca antes do mês atual.

const m = (mes: string, status = "em_aberto") => ({ kind: "mensalidade", status, reference_month: `${mes}-01` });

describe("inicioDoProximoLote", () => {
  it("renovação normal: o mês seguinte ao fim do lote ativo", () => {
    expect(
      inicioDoProximoLote({
        lotes: [{ status: "ativo", last_month: "2027-10-01" }],
        cobrancas: [m("2026-11", "paga"), m("2027-10")],
        inicioDoTratamento: "2026-11-17",
        hoje: "2027-09-20",
      })
    ).toBe("2027-11-01");
  });
  it("depois da suspensão: o mês seguinte à última mensalidade válida, não ao lote cancelado (o caso do roteiro)", () => {
    expect(
      inicioDoProximoLote({
        lotes: [
          { status: "encerrado", last_month: "2027-10-01" },
          { status: "encerrado", last_month: "2028-04-01" },
        ],
        cobrancas: [m("2026-11", "paga"), m("2026-12", "cancelada"), m("2028-04", "cancelada")],
        inicioDoTratamento: "2026-11-17",
        hoje: "2026-11-18",
      })
    ).toBe("2026-12-01");
  });
  it("retomada meses depois: começa no mês da retomada (o dono decidiu cobrá-lo)", () => {
    expect(
      inicioDoProximoLote({
        lotes: [{ status: "encerrado", last_month: "2027-10-01" }],
        cobrancas: [m("2026-11", "paga"), m("2026-12", "cancelada")],
        inicioDoTratamento: "2026-11-17",
        hoje: "2027-03-15",
      })
    ).toBe("2027-03-01");
  });
  it("primeiro lote: o mês do início do tratamento, nunca antes do mês atual", () => {
    expect(inicioDoProximoLote({ lotes: [], cobrancas: [], inicioDoTratamento: "2026-11-17", hoje: "2026-11-18" })).toBe("2026-11-01");
    expect(inicioDoProximoLote({ lotes: [], cobrancas: [], inicioDoTratamento: "2025-05-02", hoje: "2026-11-18" })).toBe("2026-11-01");
  });
  it("a contenção não conta como mês coberto", () => {
    expect(
      inicioDoProximoLote({
        lotes: [],
        cobrancas: [m("2026-11", "paga"), { kind: "contencao", status: "em_aberto", reference_month: "2027-06-01" }],
        inicioDoTratamento: "2026-11-17",
        hoje: "2026-11-18",
      })
    ).toBe("2026-12-01");
  });
});

describe("o banco faz a mesma conta (a migração mais nova que define as duas rotinas)", () => {
  const DIR = "supabase/migrations";
  const arquivos = readdirSync(DIR).filter((f) => /^0\d{3}.*\.sql$/.test(f)).sort().reverse();
  const corpo = (nome: string) => {
    const re = new RegExp(`create or replace function public\\.${nome}\\(`, "i");
    const f = arquivos.find((a) => re.test(readFileSync(`${DIR}/${a}`, "utf8")));
    if (!f) throw new Error(`nenhuma migração define ${nome}`);
    const sql = readFileSync(`${DIR}/${f}`, "utf8");
    const ini = sql.search(re);
    return sql.slice(ini, sql.indexOf("$$;", ini));
  };
  it("_ortho_emit_batch olha o lote ativo e a mensalidade não cancelada", () => {
    const s = corpo("_ortho_emit_batch");
    expect(s).toContain("b.status = 'ativo'");
    expect(s).toContain("ch.kind = 'mensalidade'");
    expect(s).toContain("ch.status <> 'cancelada'");
    expect(s).toContain("date_trunc('month', public.today_br())::date");
  });
  it("a renovação não calcula o mês por conta própria", () => {
    expect(corpo("ortho_decide_batch")).not.toContain("v_b.last_month + interval");
  });
});
