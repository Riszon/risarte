import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  camposComerciaisDaEmpresa,
  lerPagamentoDaImplantacao,
  propostaTravada,
  recusaDaAlteracao,
  situacaoDaProposta,
  type Reabertura,
} from "@/lib/empresarial/alteracao-da-proposta";
import { implantacaoDaPropostaGravada } from "@/lib/empresarial/valor-da-proposta";

// Pedido do dono (09/11/2026): proposta travada depois do contrato assinado,
// um recurso para alterar, o 1º pagamento do funil nas cobranças da empresa e
// a empresa a um clique do funil. Quem trava de verdade é o banco (1041);
// aqui ficam as regras da tela e as réguas que prendem as peças.

const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const reab = (o: Partial<Reabertura> = {}): Reabertura => ({
  id: "r1",
  motivo: "Empresa pediu mais titulares",
  reabertaEm: "2026-11-05T12:00:00Z",
  reabertaPor: "Gestor",
  assinadaAntesEm: "2026-11-01T12:00:00Z",
  levadaParaEmpresaEm: null,
  ...o,
});

describe("a situação da proposta", () => {
  it("sem assinatura e sem alteração: livre", () => {
    const s = situacaoDaProposta({ contractSignedAt: null, companyId: null, ultima: null });
    expect(s.tipo).toBe("livre");
    expect(propostaTravada(s)).toBe(false);
  });

  it("assinada: travada", () => {
    const s = situacaoDaProposta({
      contractSignedAt: "2026-11-01T12:00:00Z",
      companyId: "e1",
      ultima: null,
    });
    expect(s.tipo).toBe("travada");
    expect(propostaTravada(s)).toBe(true);
  });

  it("destravada e ainda não reassinada: em alteração, e edita", () => {
    const s = situacaoDaProposta({ contractSignedAt: null, companyId: "e1", ultima: reab() });
    expect(s.tipo).toBe("em_alteracao");
    expect(propostaTravada(s)).toBe(false);
  });

  it("reassinada com empresa: travada e esperando ir para a empresa", () => {
    const s = situacaoDaProposta({
      contractSignedAt: "2026-11-06T12:00:00Z",
      companyId: "e1",
      ultima: reab(),
    });
    expect(s.tipo).toBe("levar_para_empresa");
    expect(propostaTravada(s)).toBe(true);
  });

  it("reassinada sem empresa: só travada (a criação leva tudo)", () => {
    const s = situacaoDaProposta({
      contractSignedAt: "2026-11-06T12:00:00Z",
      companyId: null,
      ultima: reab(),
    });
    expect(s.tipo).toBe("travada");
  });

  it("já levada para a empresa: travada, sem o aviso", () => {
    const s = situacaoDaProposta({
      contractSignedAt: "2026-11-06T12:00:00Z",
      companyId: "e1",
      ultima: reab({ levadaParaEmpresaEm: "2026-11-07T12:00:00Z" }),
    });
    expect(s.tipo).toBe("travada");
  });
});

describe("o 1º pagamento", () => {
  const hoje = "2026-11-09";
  it("aceita data, valor e forma", () => {
    expect(
      lerPagamentoDaImplantacao({ data: "2026-11-08", valorCents: 52440, forma: "PIX" }, hoje)
    ).toEqual({ ok: true, data: "2026-11-08", valorCents: 52440, forma: "PIX" });
  });
  it("recusa data no futuro, valor zero e forma inventada", () => {
    expect(
      lerPagamentoDaImplantacao({ data: "2026-11-10", valorCents: 100, forma: "PIX" }, hoje).ok
    ).toBe(false);
    expect(
      lerPagamentoDaImplantacao({ data: "2026-11-08", valorCents: 0, forma: "PIX" }, hoje).ok
    ).toBe(false);
    expect(
      lerPagamentoDaImplantacao({ data: "2026-11-08", valorCents: 100, forma: "CHEQUE" }, hoje).ok
    ).toBe(false);
    expect(
      lerPagamentoDaImplantacao({ data: null, valorCents: 100, forma: "PIX" }, hoje).ok
    ).toBe(false);
  });

  it("a sugestão é a implantação da proposta, e nada sem preço gravado", () => {
    const q = {
      billing_basis: "PER_EMPLOYEE" as const,
      employee_count: 10,
      holder_fee_cents: 3990,
      fixed_monthly_cents: null,
      implantation_includes_dependents: false,
      payment_model: "COMPANY_PAYS" as const,
      subsidy_type: null,
      subsidy_value: null,
      dental_plan_monthly_cents: null,
      includes_dependents: false,
      dependents_estimate: null,
      dependent_fee_cents: null,
    };
    expect(implantacaoDaPropostaGravada(q as never, [])).toBe(39900);
    expect(implantacaoDaPropostaGravada({ ...q, holder_fee_cents: null } as never, [])).toBeNull();
  });
});

describe("as recusas do banco viram frase", () => {
  it("cada código tem a sua", () => {
    expect(recusaDaAlteracao("PROPOSAL_LOCKED")).toContain("Alterar proposta e contrato");
    expect(recusaDaAlteracao("CONTRACT_SIGNED_LOCKED")).toContain("motivo");
    expect(recusaDaAlteracao("IMPLANTATION_IN_FINANCE")).toContain("estorna");
    expect(recusaDaAlteracao("NOT_SIGNED_AGAIN")).toContain("assinado de novo");
    expect(recusaDaAlteracao("NOT_SIGNED")).toBe("Este contrato não está assinado.");
    expect(recusaDaAlteracao("outra coisa")).toBeNull();
  });
});

describe("o que a proposta reassinada atualiza na empresa", () => {
  it("não mexe em CNPJ, nome fantasia, observações nem quantos colaboradores", () => {
    const c = camposComerciaisDaEmpresa({
      cnpj: "1",
      trade_name: "X",
      notes: "n",
      employee_count: 3,
      legal_name: "X Ltda",
      due_day: 10,
    });
    expect(c).toEqual({ legal_name: "X Ltda", due_day: 10 });
  });
});

describe("as peças presas no lugar", () => {
  const sql = ler("supabase/migrations/1041_proposta_travada_e_implantacao_no_financeiro.sql");

  it("a trava do banco cobre as 7 tabelas da proposta", () => {
    for (const t of [
      "lead_qualification",
      "lead_price_tiers",
      "lead_benefits",
      "lead_perks",
      "lead_clinics",
      "proposal_templates",
      "contract_templates",
    ]) {
      expect(sql).toContain(`'${t}'`);
    }
  });

  it("settle_billing é porta: a conta da baixa mora em _settle_billing_raw", () => {
    const porta = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION empresarial.settle_billing"));
    expect(porta).toContain("perform empresarial._settle_billing_raw(p_billing_id, p_paid_at);");
    expect(porta.slice(0, porta.indexOf("$function$;"))).not.toContain("split_rules");
  });

  it("a ficha e o contrato travam a tela quando a proposta está travada", () => {
    const ficha = ler("src/app/(app)/empresarial/funil/[leadId]/ficha-proposta.tsx");
    expect(ficha).toMatch(/<fieldset\s+disabled=\{travada\}/);
    const pagina = ler("src/app/(app)/empresarial/funil/[leadId]/page.tsx");
    expect(pagina).toContain("travada={propostaTravada(situacaoDaPropostaAgora)}");
    expect(pagina).toContain("<AtalhosDaEmpresa");
    const contrato = ler("src/app/(app)/empresarial/funil/[leadId]/contrato/page.tsx");
    expect(contrato).toContain("disabled={Boolean(assinadoEm)}");
  });

  it("a caixinha do pagamento não volta: o selo exige data, valor e forma", () => {
    const acoes = ler("src/app/(app)/empresarial/funil/[leadId]/actions.ts");
    expect(acoes).toContain('if (seal === "implantation") {');
    const selos = ler("src/app/(app)/empresarial/funil/[leadId]/envio-e-selos.tsx");
    expect(selos).not.toContain('marcar("implantation"');
    expect(selos).toContain("<PagamentoDaImplantacao");
  });

  it("criar a empresa lança o 1º pagamento nas cobranças", () => {
    const funil = ler("src/app/(app)/empresarial/funil/actions.ts");
    expect(funil).toContain('db.rpc("post_lead_implantation"');
  });
});
