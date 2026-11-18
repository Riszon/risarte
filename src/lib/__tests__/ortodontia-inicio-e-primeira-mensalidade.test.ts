import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { attentionReasons, faltaParaComecar, primeiraMensalidadeEmAberto } from "@/lib/ortodontia/regras";
import { mensagemDaOrtodontia } from "@/lib/ortodontia/erros";

// AP183 D1 (0432, decisões do dono E1–E4 em 18/11/2026): as mensalidades
// nascem no fechamento da venda, a 1ª no 1º vencimento combinado (nunca
// vencida); o caso da venda só começa com a 1ª mensalidade paga, e a data de
// início é a da instalação; a agenda não deixa agendar a instalação sem a 1ª
// paga; o caso legado não muda.

const ler = (f: string) => readFileSync(f, "utf8");
const DIR = "supabase/migrations";
const arquivos = readdirSync(DIR).filter((f) => /^0\d{3}.*\.sql$/.test(f)).sort().reverse();
function corpo(nome: string): string {
  const re = new RegExp(`create or replace function public\\.${nome}\\(`, "i");
  const f = arquivos.find((a) => re.test(ler(`${DIR}/${a}`)));
  if (!f) throw new Error(`nenhuma migração define ${nome}: a régua não mediu nada`);
  const sql = ler(`${DIR}/${f}`);
  const ini = sql.search(re);
  return sql.slice(ini, sql.indexOf("$$;", ini));
}

describe("as regras da tela", () => {
  const m = (due_date: string, status: "em_aberto" | "paga" | "cancelada" | "atrasada") => ({ due_date, status });
  it("a 1ª mensalidade é a de vencimento mais cedo, sem as canceladas", () => {
    expect(primeiraMensalidadeEmAberto([m("2026-12-10", "em_aberto"), m("2026-11-28", "paga")])).toBe(false);
    expect(primeiraMensalidadeEmAberto([m("2026-11-28", "em_aberto"), m("2026-12-10", "paga")])).toBe(true);
    expect(primeiraMensalidadeEmAberto([m("2026-11-28", "cancelada"), m("2026-12-10", "paga")])).toBe(false);
    expect(primeiraMensalidadeEmAberto([])).toBe(false);
    expect(primeiraMensalidadeEmAberto(undefined)).toBe(false);
  });
  it("o que falta para começar", () => {
    expect(faltaParaComecar({ status: "aguardando_inicio", installedOn: null, charges: [m("2026-11-28", "em_aberto")] })).toEqual([
      "a 1ª mensalidade paga",
      "a instalação do aparelho",
    ]);
    expect(faltaParaComecar({ status: "aguardando_inicio", installedOn: "2026-11-18", charges: [m("2026-11-28", "em_aberto")] })).toEqual([
      "a 1ª mensalidade paga",
    ]);
    // Quem não vê dinheiro (a Dentista) só vê a falta da instalação.
    expect(faltaParaComecar({ status: "aguardando_inicio", installedOn: null, charges: null })).toEqual(["a instalação do aparelho"]);
    expect(faltaParaComecar({ status: "em_tratamento", installedOn: null, charges: null })).toEqual([]);
  });
  it("a Atenção pede o pagamento antes de pedir a instalação", () => {
    const caso = { status: "aguardando_inicio" as const, start_date: null, planned_end_date: null, finished_at: null };
    const r1 = attentionReasons({ caso, maintenances: [], charges: [m("2026-11-28", "em_aberto")], today: "2026-11-18" });
    expect(r1).toContain("falta_primeira_mensalidade");
    expect(r1).not.toContain("aguardando_inicio");
    const r2 = attentionReasons({ caso, maintenances: [], charges: [m("2026-11-28", "paga")], today: "2026-11-18" });
    expect(r2).toContain("aguardando_inicio");
  });
  it("as recusas novas em português", () => {
    expect(mensagemDaOrtodontia({ message: "FIRST_FEE_UNPAID" })).toMatch(/1ª mensalidade paga/);
    expect(mensagemDaOrtodontia({ message: "ORTHO_FIRST_FEE_UNPAID" })).toMatch(/instalação/);
  });
});

describe("o banco (a definição mais nova de cada função)", () => {
  it("o caso nasce na venda já com as mensalidades, e o lote leva o meio de cobrança", () => {
    const s = corpo("_ortho_open_from_sale");
    expect(s).toContain("perform public._ortho_emit_batch(v_id");
    expect(s).toContain("coalesce(v_t.billing_method, 'boleto')");
    expect(s).toContain("first_due_date");
  });
  it("o 1º lote vence no 1º vencimento, nunca no passado", () => {
    const s = corpo("_ortho_emit_batch");
    expect(s).toContain("v_first_due := greatest(v_t.first_due_date, public.today_br())");
    expect(s).toContain("case when i = 0 and v_first_due is not null then v_first_due");
  });
  it("o início espera a 1ª mensalidade paga, no automático e no botão", () => {
    expect(corpo("_ortho_begin_treatment")).toContain("not public._ortho_first_fee_paid(p_case_id)");
    expect(corpo("ortho_set_status")).toContain("raise exception 'FIRST_FEE_UNPAID'");
  });
  it("a 1ª paga inicia o caso sem nunca derrubar a baixa", () => {
    const s = corpo("ortho_charges_first_fee_start");
    expect(s).toContain("exception when others then");
    expect(s).toContain("v_c.installed_on, '1ª mensalidade paga'");
  });
  it("o acordo recebe o 1º vencimento e recusa data no passado", () => {
    const s = corpo("save_negotiation_ortho");
    expect(s).toContain("p_first_due_date date default null");
    expect(s).toContain("raise exception 'FIRST_DUE_IN_PAST'");
  });
  it("o caso legado não espera nada (E4)", () => {
    expect(corpo("_ortho_first_fee_paid")).toContain("when c.origin is distinct from 'venda' then true");
  });
});

describe("a agenda confere antes de gravar (E3)", () => {
  it("criar e editar agendamento perguntam ao banco", () => {
    const s = ler("src/app/(app)/agenda/actions.ts");
    const criar = s.slice(s.indexOf("export async function createAppointment("));
    expect(criar.indexOf("recusaDaInstalacao(")).toBeGreaterThan(-1);
    expect(criar.indexOf("recusaDaInstalacao(")).toBeLessThan(criar.indexOf('.from("appointments")'));
    expect(s).toContain('supabase.rpc("ortho_installation_block"');
  });
});
