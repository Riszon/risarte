import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mensagemDoUsoDoPacote, origemDoPacote } from "@/lib/signatures/origem";
import { podeMarcarFaltou, situacoesParaMudar } from "@/lib/appointments";
import { dinheiroNoTexto } from "@/lib/dinheiro-no-texto";
import { podeNaUnidadeOuNaRede, type SessionContext } from "@/lib/auth";
import { canManagePurchaseRequests, canReceivePurchases } from "@/lib/purchases-access";
import { matrizPadrao } from "@/lib/permissions";

// Correções do roteiro da ortodontia, segunda leva (18/11/2026): AP180,
// AP182, os itens 4–7 do AP183 e o D5 (Compras e Cobrança pela regra do banco).

const ler = (f: string) => readFileSync(f, "utf8");

describe("AP180 — o contrato mandado pela ficha nasce da negociação aceita", () => {
  const contrato = [{ kind: "contract" }];
  it("ficha + contrato + negociação aceita → origem da negociação", () => {
    expect(
      origemDoPacote({ origem: { type: "client", id: "c" }, modelos: contrato, negociacao: { id: "n", status: "aceita" } })
    ).toEqual({ type: "plan_negotiation", id: "n" });
    expect(
      origemDoPacote({ origem: { type: "client", id: "c" }, modelos: [{ kind: "budget" }], negociacao: { id: "n", status: "aceita" } })
    ).toEqual({ type: "plan_negotiation", id: "n" });
  });
  it("sem contrato, negociação não aceita ou outra origem: fica como veio", () => {
    const daFicha = { type: "client" as const, id: "c" };
    expect(origemDoPacote({ origem: daFicha, modelos: [{ kind: "consent" }], negociacao: { id: "n", status: "aceita" } })).toEqual(daFicha);
    expect(origemDoPacote({ origem: daFicha, modelos: contrato, negociacao: { id: "n", status: "em_negociacao" } })).toEqual(daFicha);
    expect(origemDoPacote({ origem: daFicha, modelos: contrato, negociacao: { id: null, status: null } })).toEqual(daFicha);
    const doPlano = { type: "treatment_plan" as const, id: "p" };
    expect(origemDoPacote({ origem: doPlano, modelos: contrato, negociacao: { id: "n", status: "aceita" } })).toEqual(doPlano);
  });
  it("o envio usa a regra e a porta do pacote já assinado existe", () => {
    const send = ler("src/lib/signatures/send.ts");
    expect(send).toContain("origemDoPacote(");
    expect(send).toContain("p_origin_type: origem.type");
    const m = ler("supabase/migrations/0431_assinatura_no_fechamento_e_manutencao_ao_cancelar.sql");
    expect(m).toContain("public.commercial_can_close(v_neg.clinic_id)");
    expect(m).toContain("'assinatura_digital', v_pkg.id");
    expect(mensagemDoUsoDoPacote("NOT_ALLOWED")).toMatch(/fecha a venda/);
    expect(mensagemDoUsoDoPacote("PACKAGE_OTHER_NEGOTIATION")).toMatch(/outra negociação/);
  });
});

describe("AP182 — cancelar o agendamento cancela a manutenção que nasceu dele", () => {
  it("a definição mais nova de ortho_appointment_sync olha from_appointment no cancelamento", () => {
    const dir = "supabase/migrations";
    const re = /create or replace function public\.ortho_appointment_sync\(/i;
    const f = readdirSync(dir).filter((x) => /^0\d{3}.*\.sql$/.test(x)).sort().reverse().find((x) => re.test(ler(`${dir}/${x}`)));
    if (!f) throw new Error("nenhuma migração define ortho_appointment_sync");
    const sql = ler(`${dir}/${f}`);
    const corpo = sql.slice(sql.search(re), sql.indexOf("$$;", sql.search(re)));
    const ramo = corpo.slice(corpo.indexOf("new.status::text = 'cancelled'"));
    expect(ramo).toContain("when from_appointment then 'cancelada'");
  });
});

describe("AP183 — itens 5 e 7", () => {
  const agora = Date.parse("2026-11-18T12:00:00Z");
  it("'Faltou' só depois do horário de início", () => {
    expect(podeMarcarFaltou("2026-11-18T13:00:00Z", agora)).toBe(false);
    expect(podeMarcarFaltou("2026-11-18T11:59:00Z", agora)).toBe(true);
    expect(situacoesParaMudar("scheduled", "2026-11-18T13:00:00Z", agora)).not.toContain("no_show");
    expect(situacoesParaMudar("scheduled", "2026-11-18T10:00:00Z", agora)).toContain("no_show");
    expect(situacoesParaMudar("scheduled", "2026-11-18T10:00:00Z", agora)).not.toContain("scheduled");
  });
  it("o servidor confere o horário da falta", () => {
    expect(ler("src/app/(app)/agenda/actions.ts")).toContain('status === "no_show" && !podeMarcarFaltou(');
  });
  it("o valor do motivo sai em reais", () => {
    expect(dinheiroNoTexto("Mensalidade ortodôntica de R$ 140.00 abaixo do mínimo de R$ 150.00")).toBe(
      "Mensalidade ortodôntica de R$ 140,00 abaixo do mínimo de R$ 150,00"
    );
    expect(dinheiroNoTexto("Parcela de R$ 1234.5 abaixo")).toBe("Parcela de R$ 1.234,50 abaixo");
    expect(dinheiroNoTexto("sem valor")).toBe("sem valor");
  });
});

describe("D5 — Compras e Cobrança seguem o banco para o Financeiro da Franqueadora", () => {
  const F = "franqueadora";
  const U = "unidade";
  const sessao = (rolesByClinic: Record<string, string[]>, ligado: string[] = []) => {
    const permissoes = matrizPadrao();
    for (const cap of ligado) permissoes[cap] = [...new Set([...(permissoes[cap] ?? []), "finance_franchisor"])] as never;
    return {
      isAdminMaster: false,
      rolesByClinic,
      permissoes,
      clinics: [
        { id: F, name: "F", type: "franchisor", is_active: true },
        { id: U, name: "U", type: "franchise_unit", is_active: true },
      ],
    } as unknown as SessionContext;
  };
  it("a matriz ligada para o Financeiro da Franqueadora vale na unidade", () => {
    const s = sessao({ [F]: ["finance_franchisor"] }, ["acao.compras.requisitar", "acao.cobranca.emitir"]);
    expect(canManagePurchaseRequests(s, U)).toBe(true);
    expect(canReceivePurchases(s, U)).toBe(true);
    expect(podeNaUnidadeOuNaRede(s, "acao.cobranca.emitir", U)).toBe(true);
  });
  it("com a matriz desligada, continua barrado (a decisão é do dono, AP125)", () => {
    const s = sessao({ [F]: ["finance_franchisor"] });
    expect(canManagePurchaseRequests(s, U)).toBe(false);
    expect(podeNaUnidadeOuNaRede(s, "acao.cobranca.emitir", U)).toBe(false);
  });
  it("as telas de Cobrança usam a regra", () => {
    for (const f of ["src/app/(app)/prontuarios/[id]/cobranca-actions.ts", "src/app/(app)/comercial/parcelado-actions.ts"]) {
      const s = ler(f);
      expect(s).not.toMatch(/[^a-zA-Z]pode\(session, "acao\.cobranca/);
      expect(s).toContain('podeNaUnidadeOuNaRede(session, "acao.cobranca.');
    }
  });
});
