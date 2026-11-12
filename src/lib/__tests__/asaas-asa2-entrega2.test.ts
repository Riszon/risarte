// ASA2, entrega 2 (4006) — o selo "Em atraso" e o Painel de cobranças. O que é
// do BANCO (o corte em dias úteis, quem vê o selo nas duas etapas, o teto, o
// escopo do painel, a auditoria da planilha, a taxa gravada pelo aviso) é
// provado pelo ensaio `scripts/asaas-ensaio-asa2-entrega2.mjs`, no treino.
// Aqui: as contas puras e as réguas que impedem a regressão no código.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAPACIDADES_POR_ID } from "@/lib/permissions";
import { parcelaEmAtraso, textoDoSelo } from "@/lib/finance/selo-atraso";
import {
  agendaDoAReceber,
  argumentosDaLista,
  lerFiltros,
  relatorioDasCobrancas,
  type LinhaAReceber,
} from "@/lib/finance/painel-cobrancas";

const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const SQL = ler("supabase/migrations/4006_asa2_selo_em_atraso_e_painel_de_cobrancas.sql");

describe("o selo: uma regra só", () => {
  it("em atraso é vencimento até o corte do banco; sem a 4006, vencida desde o dia seguinte", () => {
    expect(parcelaEmAtraso({ dueDate: "2026-11-08", emAberto: true }, "2026-11-08", "2026-11-12")).toBe(true);
    expect(parcelaEmAtraso({ dueDate: "2026-11-09", emAberto: true }, "2026-11-08", "2026-11-12")).toBe(false);
    expect(parcelaEmAtraso({ dueDate: "2026-11-01", emAberto: false }, "2026-11-08", "2026-11-12")).toBe(false);
    expect(parcelaEmAtraso({ dueDate: "2026-11-11", emAberto: true }, null, "2026-11-12")).toBe(true);
  });
  it("o texto conta os dias e não leva valor", () => {
    expect(textoDoSelo(1)).toBe("Em atraso há 1 dia");
    expect(textoDoSelo(12)).toBe("Em atraso há 12 dias");
    const selo = ler("src/components/selo-em-atraso.tsx");
    expect(selo).not.toMatch(/formatBRL|_cents|Cents/);
  });
  it("a ficha, a lista de prontuários e a agenda perguntam ao banco (sem lista de papéis no código)", () => {
    const ficha = ler("src/app/(app)/prontuarios/[id]/page.tsx");
    expect(ficha).toMatch(/corteDoAtraso\(supabase\)/);
    expect(ficha).toMatch(/selosDeAtraso\(supabase, \[client\.id\]\)/);
    expect(ficha).toMatch(/<SeloEmAtraso dias=\{diasDeAtraso\} \/>/);
    const lista = ler("src/app/(app)/prontuarios/page.tsx");
    expect(lista).toMatch(/corteDoAtraso\(supabase\)/);
    expect(lista).not.toMatch(/daysLate\(/);
    const agenda = ler("src/app/(app)/agenda/page.tsx");
    expect(agenda.match(/selosDeAtraso\(/g)?.length).toBe(2);
    const cockpit = ler("src/app/(app)/avaliacao/[clientId]/client-status-panel.tsx");
    expect(cockpit).not.toMatch(/Em breve/);
  });
});

describe("as permissões: duas etapas e o teto", () => {
  const teto = (cap: string) => {
    const corpo = SQL.slice(SQL.indexOf("create or replace function public._gateway_cap_ceiling("));
    const fim = corpo.indexOf("$$;");
    const bloco = corpo.slice(0, fim);
    const i = bloco.indexOf(`when '${cap}' then`);
    return bloco.slice(i, bloco.indexOf("::public.user_role[]", i));
  };
  it("o selo nunca alcança dentista, planner, TSB, ASB nem SDR", () => {
    for (const r of ["dentist", "planner_dentist", "tsb", "asb", "sdr", "clinical_coordinator"]) {
      expect(teto("acao.cobranca.selo_atraso"), r).not.toMatch(new RegExp(`'${r}'`));
    }
  });
  it("o painel nunca alcança a Recepcionista", () => {
    expect(teto("modulo.painel_cobrancas")).not.toMatch(/'receptionist'/);
    expect(teto("modulo.painel_cobrancas")).toMatch(/'unit_manager','franchisee','finance_franchisor'/);
  });
  it("o padrão do banco é o mesmo do código: selo com Gerente e Franqueado; painel só o Admin", () => {
    expect(CAPACIDADES_POR_ID.get("acao.cobranca.selo_atraso")?.padrao).toEqual(["unit_manager", "franchisee"]);
    expect(CAPACIDADES_POR_ID.get("modulo.painel_cobrancas")?.padrao).toEqual([]);
    expect(SQL).toMatch(/when 'acao\.cobranca\.selo_atraso' then array\['unit_manager','franchisee'\]::public\.user_role\[\]/);
    expect(SQL).toMatch(/when 'modulo\.painel_cobrancas' then '\{\}'::public\.user_role\[\]/);
  });
  it("toda função interna nova responde só à chave de serviço; as portas abertas têm grant", () => {
    const internas = [...SQL.matchAll(/create or replace function public\.(_[a-z_]+)\(/g)].map((m) => m[1]);
    expect(internas.length).toBeGreaterThanOrEqual(5);
    for (const f of new Set(internas)) {
      expect(SQL, f).toMatch(new RegExp(`revoke execute on function public\\.${f}\\([^)]*\\) from public, anon, authenticated;`));
      expect(SQL, f).not.toMatch(new RegExp(`grant execute on function public\\.${f}\\(`));
    }
    for (const f of ["overdue_badge_cutoff", "client_overdue_badges", "gateway_receivables_due", "gateway_charges_list"]) {
      expect(SQL, f).toMatch(new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to authenticated;`));
    }
  });
});

describe("o Painel de cobranças", () => {
  const linha = (o: Partial<LinhaAReceber>): LinhaAReceber => ({
    charge_id: Math.random().toString(),
    clinic_id: "u1",
    clinic_name: "Unidade 1",
    client_id: "c1",
    client_name: "Ana",
    client_code: "LDN-00001",
    billing_type: "BOLETO",
    paid_on: "2026-11-10",
    credit_date: "2026-11-12",
    paid_cents: 1000,
    fee_cents: 100,
    net_cents: 900,
    ...o,
  });
  it("as faixas são cumulativas e a data que já passou conta em hoje", () => {
    const ag = agendaDoAReceber(
      [
        linha({ credit_date: "2026-11-10" }),
        linha({ credit_date: "2026-11-12" }),
        linha({ credit_date: "2026-11-18", billing_type: "PIX" }),
        linha({ credit_date: "2026-12-14", billing_type: "CREDIT_CARD", clinic_id: "u2", clinic_name: "Unidade 2" }),
        linha({ credit_date: null }),
      ],
      "2026-11-12"
    );
    const f = Object.fromEntries(ag.faixas.map((x) => [x.chave, x.soma.qtd]));
    expect(f).toEqual({ hoje: 2, "7": 3, "30": 3, "60": 4 });
    expect(ag.total).toEqual({ qtd: 5, bruto: 5000, taxa: 500, liquido: 4500 });
    expect(ag.porMeio.find((m) => m.valor === "CREDIT_CARD")?.soma.qtd).toBe(1);
    // Só os meios que já existem: nada de "a partir da ASA4" na tela.
    expect(ag.porMeio.map((m) => m.rotulo)).toEqual(["Boleto", "Pix", "Cartão à vista"]);
    expect(ag.porDia.map((d) => d.data)).toEqual(["2026-11-10", "2026-11-12", "2026-11-18", "2026-12-14", null]);
    expect(ag.porUnidade.map((u) => u.nome)).toEqual(["Unidade 1", "Unidade 2"]);
  });
  it("sem o líquido gravado, o líquido é o pago menos a taxa", () => {
    const ag = agendaDoAReceber([linha({ net_cents: null, fee_cents: 62 })], "2026-11-12");
    expect(ag.total.liquido).toBe(938);
  });
  it("os filtros da URL só passam o que é válido", () => {
    expect(lerFiltros({ situacao: "drop table", meio: "BOLETO", data: "x", de: "2026-13", unidade: "1; select" })).toEqual({
      unidade: null,
      situacoes: null,
      meios: ["BOLETO"],
      data: "emissao",
      de: null,
      ate: null,
    });
  });
  it("só a planilha pede o registro na auditoria", () => {
    const f = lerFiltros({});
    expect(argumentosDaLista(f, true).p_export).toBe(true);
    expect(ler("src/app/(app)/financeiro/cobrancas/planilha/route.ts")).toMatch(/argumentosDaLista\(filtros, true\)/);
    expect(ler("src/app/(app)/financeiro/cobrancas/page.tsx")).toMatch(/argumentosDaLista\(filtros, false\)/);
    const corpo = SQL.slice(SQL.indexOf("create or replace function public.gateway_charges_list("));
    expect(corpo.slice(0, corpo.indexOf("$$;"))).toMatch(/if p_export then[\s\S]*insert into public\.audit_logs[\s\S]*'export', 'gateway_charges_panel'/);
  });
  it("a planilha avisa que as cobranças criadas no painel do Asaas não aparecem", () => {
    const r = relatorioDasCobrancas({ linhas: [], filtros: lerFiltros({}), nomeDaUnidade: null, geradoPor: "X", agora: "2026-11-12 10:00" });
    expect(r.subtitulo).toMatch(/painel do Asaas não aparecem/);
    expect(r.colunas.filter((c) => c.tipo === "dinheiro").every((c) => c.somar)).toBe(true);
  });
});
