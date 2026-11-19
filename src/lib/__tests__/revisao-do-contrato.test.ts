import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  diferencasDosTermos,
  recusaDaRevisao,
  termosDoFormulario,
  type TermosDoContrato,
} from "@/lib/empresarial/revisao-do-contrato";
import {
  cobertosPorTitular,
  implantacaoDosDependentesNovos,
} from "@/lib/empresarial/implantacao-dos-dependentes";
import type { AdhesionPricing } from "@/lib/empresarial/pricing";

// 1050 — REVISAR CONTRATO, a implantação da importada (R4) e a dos
// dependentes novos (R7). Plano aprovado pelo dono em 18/11/2026
// (docs/risarte-empresarial/REVISAR-CONTRATO-PLANO.md).

const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const semNbsp = (s: string) => s.replace(/ /g, " ");

const base: TermosDoContrato = {
  empresa: {
    payment_model: "COMPANY_PAYS",
    company_subsidy_type: null,
    company_subsidy_value: null,
    due_day: 10,
    payment_methods: ["PIX", "BOLETO"],
    default_max_installments: 12,
    grace_period_days: 0,
    employee_grace_period_days: 0,
    special_agreements: null,
    min_adhesions: null,
    max_adhesions: null,
    adhesion_limit_target: null,
    contracted_holders: 40,
    contracted_dependents: null,
    excess_mode: "PER_ADHESION",
    excess_fixed_cents: null,
    excess_holder_fee_cents: 3000,
    excess_dependent_fee_cents: 2000,
    billing_basis: "PER_EMPLOYEE",
    fixed_monthly_cents: null,
    implantation_includes_dependents: false,
    implantation_status: "COBRAR",
    implantation_prepaid_holders: null,
    min_term_months: null,
    early_exit_fee_cents: null,
  },
  preco: null,
  faixas: [{ min_quantity: 50, price_cents: 3000 }],
};

/** O formulário como a tela manda, com os valores de hoje. */
function formulario(extra: Record<string, string | string[]> = {}) {
  return {
    reason: "Ajustar o combinado",
    payment_model: "COMPANY_PAYS",
    due_day: "10",
    payment_methods: ["BOLETO", "PIX"],
    default_max_installments: "12",
    grace_period_days: "0",
    employee_grace_period_days: "0",
    billing_basis: "PER_EMPLOYEE",
    preco_origem: "rede",
    faixa_min: ["50"],
    faixa_preco: ["30,00"],
    contracted_holders: "40",
    implantation_status: "COBRAR",
    implantation_includes_dependents: "nao",
    ...extra,
  };
}

describe("o formulário da revisão", () => {
  it("sem mexer em nada, não muda nada (nem a ordem das formas, nem o excedente escondido)", () => {
    const r = termosDoFormulario(base, formulario());
    expect(r.ok).toBe(true);
    if (r.ok) expect(diferencasDosTermos(base, r.termos)).toEqual([]);
  });

  it("lista o que muda, de → para", () => {
    const r = termosDoFormulario(
      base,
      formulario({ due_day: "15", implantation_status: "JA_PAGA", implantation_prepaid_holders: "30", min_term_months: "12" })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = diferencasDosTermos(base, r.termos);
    expect(m).toContainEqual({ rotulo: "Dia de vencimento", de: "10", para: "15" });
    expect(m).toContainEqual({ rotulo: "Implantação", de: "Cobrar pela regra combinada", para: "Já paga antes do sistema" });
    expect(m).toContainEqual({ rotulo: "Titulares que já pagaram a implantação", de: "—", para: "30" });
    expect(m).toContainEqual({ rotulo: "Prazo mínimo (fidelidade)", de: "—", para: "12 meses" });
  });

  it("preço próprio e faixas novas", () => {
    const r = termosDoFormulario(
      base,
      formulario({
        preco_origem: "proprio",
        holder_fee_cents: "29,90",
        dependent_individual_fee_cents: "29,90",
        dependent_family_fee_cents: "49,90",
        dependent_family_extra_fee_cents: "14,90",
        dependent_family_size: "4",
        max_installments: "12",
        faixa_min: ["100", "50", ""],
        faixa_preco: ["25,00", "27,50", ""],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.termos.preco).toMatchObject({ holder_fee_cents: 2990, dependent_family_size: 4, dependent_mode: "FAMILY_PACKAGE" });
    expect(r.termos.faixas).toEqual([
      { min_quantity: 50, price_cents: 2750 },
      { min_quantity: 100, price_cents: 2500 },
    ]);
    const m = diferencasDosTermos(base, r.termos).map((x) => ({ ...x, de: semNbsp(x.de), para: semNbsp(x.para) }));
    expect(m.find((x) => x.rotulo === "Preço da adesão")?.de).toBe("Preço da rede");
  });

  it("recusa o que não fecha, em português", () => {
    const r = termosDoFormulario(
      base,
      formulario({
        due_day: "31",
        implantation_status: "JA_PAGA",
        min_adhesions: "50",
        max_adhesions: "10",
        faixa_min: ["1"],
        faixa_preco: ["10,00"],
        billing_basis: "FIXED_PER_COMPANY",
      })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros.join(" | ")).toContain("Dia de vencimento");
    expect(r.erros.join(" | ")).toContain("quantos titulares já pagaram");
    expect(r.erros.join(" | ")).toContain("mínimo de adesões não pode passar do máximo");
    expect(r.erros.join(" | ")).toContain("informe o valor fixo mensal");
  });

  it("as recusas do banco viram frase", () => {
    expect(recusaDaRevisao("REVISION_OPEN:RV-00007")).toContain("RV-00007");
    expect(recusaDaRevisao("DOCUMENT_REQUIRED")).toContain("aditivo");
    expect(recusaDaRevisao("CONTRACT_TERMS_LOCKED")).toContain("Revisar contrato");
    expect(recusaDaRevisao("NO_CHANGES")).toContain("não muda nenhuma regra");
  });
});

describe("a implantação dos dependentes novos (R7)", () => {
  const pacote: AdhesionPricing = {
    holderFeeCents: 3500,
    dependentIndividualFeeCents: 3990,
    dependentFamilyFeeCents: 5990,
    dependentFamilyExtraFeeCents: 1990,
    maxInstallments: 24,
    dependentFamilySize: 3,
    dependentMode: "FAMILY_PACKAGE",
  };
  const t = (ativos: number, cobertos: number, pagador: { nome: string; documento: string } | null = null) => ({
    employeeId: `e${ativos}${cobertos}`,
    nome: "Maria",
    ativos,
    cobertos,
    pagador,
  });

  it("1º dependente paga o individual; do individual ao familiar paga o familiar inteiro (decisão do dono)", () => {
    expect(implantacaoDosDependentesNovos(pacote, [t(1, 0)])[0].cents).toBe(3990);
    expect(implantacaoDosDependentesNovos(pacote, [t(2, 1)])[0]).toMatchObject({ cents: 5990, novos: 1, dependentes: 2 });
  });

  it("entrar no mesmo pacote não cobra; passar para extras cobra o pacote novo inteiro", () => {
    expect(implantacaoDosDependentesNovos(pacote, [t(3, 2)])).toEqual([]);
    expect(implantacaoDosDependentesNovos(pacote, [t(4, 3)])[0].cents).toBe(5990 + 1990);
  });

  it("quem já está coberto não aparece; por dependente cobra só os novos", () => {
    expect(implantacaoDosDependentesNovos(pacote, [t(2, 2)])).toEqual([]);
    const porDependente = { ...pacote, dependentMode: "PER_DEPENDENT" as const };
    expect(implantacaoDosDependentesNovos(porDependente, [t(3, 1)])[0].cents).toBe(2 * 3990);
  });

  it("leva o pagador da 1049", () => {
    const pag = { nome: "Maria", documento: "52998224725" };
    expect(implantacaoDosDependentesNovos(pacote, [t(1, 0, pag)])[0].pagador).toEqual(pag);
  });

  it("cobertura: o maior número, sem contar cobrança cancelada", () => {
    const m = cobertosPorTitular([
      { employee_id: "a", dependents_covered: 1, billing_status: null },
      { employee_id: "a", dependents_covered: 3, billing_status: "CANCELLED" },
      { employee_id: "a", dependents_covered: 2, billing_status: "PENDING" },
    ]);
    expect(m.get("a")).toBe(2);
  });
});

describe("o banco (1050) e o caminho do app", () => {
  const sql = ler("supabase/migrations/1050_revisao_do_contrato.sql");

  it("a trava cobre as regras e só abre pela revisão, na criação e na proposta reassinada", () => {
    for (const col of ["due_day", "contracted_holders", "billing_basis", "implantation_status", "min_term_months"]) {
      expect(sql).toContain(`new.${col} is distinct from old.${col}`);
    }
    expect(sql).toContain("current_setting('empresarial.revisao_em_curso', true)");
    expect(sql).toContain("c.created_at > now() - interval '10 minutes'");
    expect(sql).toContain("r.applied_to_company_at is null");
  });

  it("aplicar exige o aditivo e o gestor (R2, R6)", () => {
    const aplicar = sql.slice(sql.indexOf("create or replace function empresarial.apply_contract_revision"));
    expect(aplicar).toContain("not empresarial.is_program_manager()");
    expect(aplicar).toContain("raise exception 'DOCUMENT_REQUIRED'");
  });

  it("as portas novas não respondem a quem não está logado", () => {
    for (const f of ["open_contract_revision", "save_contract_revision", "apply_contract_revision", "cancel_contract_revision"]) {
      expect(sql).toMatch(new RegExp(`revoke all on function empresarial\\.${f}\\([^)]*\\) from public, anon, authenticated`));
    }
  });

  it("o botão de implantação respeita a isenção e o 'já paga' (R4)", () => {
    const acoes = ler("src/app/(app)/empresarial/[companyId]/billing-actions.ts");
    expect(acoes).toContain(`company.implantation_status === "ISENTA"`);
    expect(acoes).toContain("implantation_prepaid_holders ?? 0");
  });

  it("o cadastro da empresa não muda mais as regras por fora (R1)", () => {
    const acoes = ler("src/app/(app)/empresarial/actions.ts");
    const update = acoes.slice(acoes.indexOf("export async function updateCompany"));
    expect(update).toContain(".update(cadastro)");
    expect(ler("src/app/(app)/empresarial/[companyId]/page.tsx")).not.toContain("<AdhesionPricingForm");
  });

  it("a fidelidade e a multa viajam da proposta para a empresa (R5)", () => {
    const p = ler("src/lib/empresarial/proposta.ts");
    expect(p).toContain("min_term_months: qual?.min_term_months ?? null");
    expect(p).toContain("early_exit_fee_cents: qual?.early_exit_fee_cents ?? null");
  });
});
