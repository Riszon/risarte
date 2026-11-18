// Risarte Empresarial — REVISAR CONTRATO (1050; pedido do dono, 18/11/2026;
// plano docs/risarte-empresarial/REVISAR-CONTRATO-PLANO.md, R1–R7).
//
// As regras comerciais da empresa só mudam por uma revisão: ela nasce com a
// foto das regras de hoje (`_termos_da_empresa`, no banco), recebe as
// alterações, exige o aditivo assinado e é aplicada pelo gestor.
//
// Pura: o formulário vira `TermosDoContrato` (com as recusas em português),
// a tela lista o que muda e as recusas do banco viram texto.

export const IMPLANTACAO_SITUACOES = ["COBRAR", "JA_PAGA", "ISENTA"] as const;
export type SituacaoDaImplantacao = (typeof IMPLANTACAO_SITUACOES)[number];
export const IMPLANTACAO_SITUACAO_LABELS: Record<SituacaoDaImplantacao, string> = {
  COBRAR: "Cobrar pela regra combinada",
  JA_PAGA: "Já paga antes do sistema",
  ISENTA: "Isenta (combinado com a empresa)",
};

export type TermosDaEmpresa = {
  payment_model: string;
  company_subsidy_type: string | null;
  company_subsidy_value: number | null;
  due_day: number | null;
  payment_methods: string[] | null;
  default_max_installments: number | null;
  grace_period_days: number | null;
  employee_grace_period_days: number | null;
  special_agreements: string | null;
  min_adhesions: number | null;
  max_adhesions: number | null;
  adhesion_limit_target: string | null;
  contracted_holders: number | null;
  contracted_dependents: number | null;
  excess_mode: string | null;
  excess_fixed_cents: number | null;
  excess_holder_fee_cents: number | null;
  excess_dependent_fee_cents: number | null;
  billing_basis: string | null;
  fixed_monthly_cents: number | null;
  implantation_includes_dependents: boolean | null;
  implantation_status: string;
  implantation_prepaid_holders: number | null;
  min_term_months: number | null;
  early_exit_fee_cents: number | null;
};

export type PrecoDoContrato = {
  holder_fee_cents: number;
  dependent_individual_fee_cents: number;
  dependent_family_fee_cents: number;
  dependent_family_extra_fee_cents: number;
  dependent_family_size: number;
  dependent_mode: string;
  max_installments: number;
};

export type TermosDoContrato = {
  empresa: TermosDaEmpresa;
  /** Nulo = vale o preço da rede. */
  preco: PrecoDoContrato | null;
  faixas: { min_quantity: number; price_cents: number }[];
};

// ---------------------------------------------------------------------------
// Do formulário para os termos
// ---------------------------------------------------------------------------

type Campos = Record<string, string | string[] | undefined>;

const texto = (c: Campos, k: string) => {
  const v = c[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
};
const lista = (c: Campos, k: string) => {
  const v = c[k];
  return Array.isArray(v) ? v : v ? [v] : [];
};

/** "1.234,56" / "1234.56" / "" → centavos (nulo quando vazio, NaN quando inválido). */
export function reaisParaCentavos(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number.parseFloat(v.replace(/\s|R\$/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
}
function inteiro(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v.trim());
  return Number.isInteger(n) ? n : Number.NaN;
}

/**
 * Lê o formulário da revisão. `base` é a foto de quando ela abriu: o que o
 * formulário não traz fica como estava.
 */
export function termosDoFormulario(
  base: TermosDoContrato,
  c: Campos
): { ok: true; termos: TermosDoContrato } | { ok: false; erros: string[] } {
  const erros: string[] = [];
  const num = (k: string, rotulo: string, min = 0, max = Number.MAX_SAFE_INTEGER): number | null => {
    const n = inteiro(texto(c, k));
    if (n === null) return null;
    if (Number.isNaN(n) || n < min || n > max) {
      erros.push(`${rotulo}: informe um número inteiro${max < Number.MAX_SAFE_INTEGER ? ` entre ${min} e ${max}` : ` a partir de ${min}`}.`);
      return null;
    }
    return n;
  };
  const dinheiro = (k: string, rotulo: string): number | null => {
    const v = reaisParaCentavos(texto(c, k));
    if (v === null) return null;
    if (Number.isNaN(v) || v < 0) {
      erros.push(`${rotulo}: valor inválido.`);
      return null;
    }
    return v;
  };

  const base_e = base.empresa;
  const paymentModel = texto(c, "payment_model") || base_e.payment_model;
  const subsidyType = paymentModel === "COMPANY_PARTIAL" ? texto(c, "company_subsidy_type") || "PERCENT" : null;
  let subsidyValue: number | null = null;
  if (paymentModel === "COMPANY_PARTIAL") {
    subsidyValue =
      subsidyType === "PERCENT" ? num("company_subsidy_value", "Subsídio (%)", 1, 100) : dinheiro("company_subsidy_value", "Subsídio (R$)");
    if (subsidyValue === null && !erros.length) erros.push("Informe quanto a empresa paga (o subsídio).");
  }
  const dueDay = num("due_day", "Dia de vencimento", 1, 28);
  if (dueDay === null && !erros.some((e) => e.startsWith("Dia"))) erros.push("Informe o dia de vencimento.");

  const basis = texto(c, "billing_basis") || base_e.billing_basis || "PER_EMPLOYEE";
  const fixo = basis === "FIXED_PER_COMPANY";
  const fixedMonthly = fixo ? dinheiro("fixed_monthly_cents", "Valor fixo mensal") : null;
  if (fixo && !fixedMonthly) erros.push("Valor fixo por empresa: informe o valor fixo mensal.");

  const excessMode = fixo ? texto(c, "excess_mode") || null : null;
  const minAd = num("min_adhesions", "Mínimo de adesões", 1);
  const maxAd = num("max_adhesions", "Máximo de adesões", 1);
  if (minAd !== null && maxAd !== null && minAd > maxAd) erros.push("O mínimo de adesões não pode passar do máximo.");

  const situacao = texto(c, "implantation_status") || base_e.implantation_status || "COBRAR";
  if (!(IMPLANTACAO_SITUACOES as readonly string[]).includes(situacao)) erros.push("Escolha a situação da implantação.");
  const prepagos = situacao === "JA_PAGA" ? num("implantation_prepaid_holders", "Titulares que já pagaram a implantação", 0) : null;
  if (situacao === "JA_PAGA" && prepagos === null && !erros.some((e) => e.startsWith("Titulares que"))) {
    erros.push("Já paga antes do sistema: informe quantos titulares já pagaram a implantação.");
  }

  const marcados = lista(c, "payment_methods").filter((m) => ["BOLETO", "PIX", "CARD"].includes(m));
  // Mesma escolha em outra ordem não é mudança.
  const doBase = base_e.payment_methods ?? [];
  const metodos =
    marcados.length === doBase.length && marcados.every((m) => doBase.includes(m)) ? doBase : marcados;

  const empresa: TermosDaEmpresa = {
    ...base_e,
    payment_model: paymentModel,
    company_subsidy_type: subsidyType,
    company_subsidy_value: subsidyValue,
    due_day: dueDay,
    payment_methods: metodos.length ? metodos : ["BOLETO"],
    default_max_installments: num("default_max_installments", "Parcelas do tratamento", 1, 48),
    grace_period_days: num("grace_period_days", "Carência da empresa (dias)", 0, 3650) ?? 0,
    employee_grace_period_days: num("employee_grace_period_days", "Carência do colaborador (dias)", 0, 3650) ?? 0,
    special_agreements: texto(c, "special_agreements") || null,
    min_adhesions: minAd,
    max_adhesions: maxAd,
    adhesion_limit_target:
      minAd !== null || maxAd !== null ? texto(c, "adhesion_limit_target") || "HOLDERS" : base_e.min_adhesions == null && base_e.max_adhesions == null ? base_e.adhesion_limit_target : null,
    contracted_holders: num("contracted_holders", "Titulares contratados", 0),
    contracted_dependents: num("contracted_dependents", "Dependentes contratados", 0),
    // Por titular, o excedente é a tabela (termo de inclusão): os campos do
    // excedente não aparecem e ficam como estavam.
    excess_mode: fixo ? excessMode : base_e.excess_mode,
    excess_fixed_cents: !fixo ? base_e.excess_fixed_cents : excessMode === "NEW_FIXED" ? dinheiro("excess_fixed_cents", "Novo valor fixo") : null,
    excess_holder_fee_cents: !fixo ? base_e.excess_holder_fee_cents : excessMode === "PER_ADHESION" ? dinheiro("excess_holder_fee_cents", "Excedente por titular") : null,
    excess_dependent_fee_cents: !fixo ? base_e.excess_dependent_fee_cents : excessMode === "PER_ADHESION" ? dinheiro("excess_dependent_fee_cents", "Excedente por dependente") : null,
    billing_basis: basis,
    fixed_monthly_cents: fixedMonthly,
    implantation_includes_dependents: texto(c, "implantation_includes_dependents") === "sim",
    implantation_status: situacao,
    implantation_prepaid_holders: prepagos,
    min_term_months: num("min_term_months", "Prazo mínimo (meses)", 1, 240),
    early_exit_fee_cents: dinheiro("early_exit_fee_cents", "Multa de saída"),
  };

  // Preço: "rede" = volta ao preço da rede (sem linha própria).
  let preco: PrecoDoContrato | null = base.preco;
  if (texto(c, "preco_origem") === "rede") {
    preco = null;
  } else if (texto(c, "preco_origem") === "proprio") {
    const t = dinheiro("holder_fee_cents", "Preço por titular");
    const i = dinheiro("dependent_individual_fee_cents", "Dependente individual");
    const f = dinheiro("dependent_family_fee_cents", "Pacote familiar");
    const x = dinheiro("dependent_family_extra_fee_cents", "Dependente extra");
    const tam = num("dependent_family_size", "Tamanho do pacote familiar", 2, 20);
    const parcelas = num("max_installments", "Parcelas da adesão", 1, 48);
    if (t === null || i === null || f === null || x === null) {
      erros.push("Preço próprio: preencha os quatro valores (titular, dependente individual, pacote familiar e extra).");
    } else {
      preco = {
        holder_fee_cents: t,
        dependent_individual_fee_cents: i,
        dependent_family_fee_cents: f,
        dependent_family_extra_fee_cents: x,
        dependent_family_size: tam ?? 3,
        dependent_mode: texto(c, "dependent_mode") === "PER_DEPENDENT" ? "PER_DEPENDENT" : "FAMILY_PACKAGE",
        max_installments: parcelas ?? 24,
      };
    }
  }

  // Faixas: linhas "a partir de N: R$ X"; vazias são ignoradas.
  const qs = lista(c, "faixa_min");
  const ps = lista(c, "faixa_preco");
  const faixas: { min_quantity: number; price_cents: number }[] = [];
  qs.forEach((q, idx) => {
    const pv = ps[idx] ?? "";
    if (!q.trim() && !pv.trim()) return;
    const n = inteiro(q);
    const v = reaisParaCentavos(pv);
    if (n === null || Number.isNaN(n) || n < 2 || v === null || Number.isNaN(v) || v <= 0) {
      erros.push(`Faixa ${idx + 1}: informe a quantidade (a partir de 2) e o preço.`);
      return;
    }
    faixas.push({ min_quantity: n, price_cents: v });
  });
  const vistas = new Set<number>();
  for (const f of faixas) {
    if (vistas.has(f.min_quantity)) erros.push(`Faixa a partir de ${f.min_quantity} repetida.`);
    vistas.add(f.min_quantity);
  }
  faixas.sort((a, b) => a.min_quantity - b.min_quantity);

  if (erros.length) return { ok: false, erros: [...new Set(erros)] };
  // Valor fixo não usa faixa: as que existiam ficam guardadas como estavam.
  return { ok: true, termos: { empresa, preco, faixas: fixo ? base.faixas : faixas } };
}

// ---------------------------------------------------------------------------
// O que muda (de → para)
// ---------------------------------------------------------------------------

const brl = (c: number | null | undefined) =>
  c == null ? "—" : (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const n = (v: number | null | undefined, unidade = "") => (v == null ? "—" : `${v}${unidade}`);

const ROTULOS_DA_EMPRESA: { k: keyof TermosDaEmpresa; rotulo: string; fmt: (v: never) => string }[] = [
  { k: "payment_model", rotulo: "Quem paga", fmt: (v: string) => ({ COMPANY_PAYS: "Empresa paga integral", COMPANY_PARTIAL: "Empresa paga parcial", EMPLOYEE_PAYS: "Titular paga" })[v] ?? v },
  { k: "company_subsidy_value", rotulo: "Subsídio da empresa", fmt: (v: number | null) => n(v) },
  { k: "due_day", rotulo: "Dia de vencimento", fmt: (v: number | null) => n(v) },
  { k: "payment_methods", rotulo: "Formas de pagamento do tratamento", fmt: (v: string[] | null) => (v ?? []).join(", ") || "—" },
  { k: "default_max_installments", rotulo: "Parcelas do tratamento", fmt: (v: number | null) => n(v, "x") },
  { k: "grace_period_days", rotulo: "Carência da empresa", fmt: (v: number | null) => n(v, " dias") },
  { k: "employee_grace_period_days", rotulo: "Carência do colaborador", fmt: (v: number | null) => n(v, " dias") },
  { k: "special_agreements", rotulo: "Combinado na venda", fmt: (v: string | null) => v || "—" },
  { k: "min_adhesions", rotulo: "Mínimo de adesões", fmt: (v: number | null) => n(v) },
  { k: "max_adhesions", rotulo: "Máximo de adesões", fmt: (v: number | null) => n(v) },
  { k: "contracted_holders", rotulo: "Titulares contratados", fmt: (v: number | null) => n(v) },
  { k: "contracted_dependents", rotulo: "Dependentes contratados", fmt: (v: number | null) => n(v) },
  { k: "billing_basis", rotulo: "Como se cobra", fmt: (v: string | null) => (v === "FIXED_PER_COMPANY" ? "Valor fixo por empresa" : "Por titular") },
  { k: "fixed_monthly_cents", rotulo: "Valor fixo mensal", fmt: (v: number | null) => brl(v) },
  { k: "excess_mode", rotulo: "Acima do contratado", fmt: (v: string | null) => (v === "NEW_FIXED" ? "Novo valor fixo" : v === "PER_ADHESION" ? "Por adesão" : "—") },
  { k: "excess_fixed_cents", rotulo: "Novo valor fixo (excedente)", fmt: (v: number | null) => brl(v) },
  { k: "excess_holder_fee_cents", rotulo: "Excedente por titular", fmt: (v: number | null) => brl(v) },
  { k: "excess_dependent_fee_cents", rotulo: "Excedente por dependente", fmt: (v: number | null) => brl(v) },
  { k: "implantation_includes_dependents", rotulo: "Implantação cobra os dependentes", fmt: (v: boolean | null) => (v ? "Sim" : "Não") },
  { k: "implantation_status", rotulo: "Implantação", fmt: (v: string) => IMPLANTACAO_SITUACAO_LABELS[v as SituacaoDaImplantacao] ?? v },
  { k: "implantation_prepaid_holders", rotulo: "Titulares que já pagaram a implantação", fmt: (v: number | null) => n(v) },
  { k: "min_term_months", rotulo: "Prazo mínimo (fidelidade)", fmt: (v: number | null) => n(v, " meses") },
  { k: "early_exit_fee_cents", rotulo: "Multa de saída antecipada", fmt: (v: number | null) => brl(v) },
];

function igual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function textoDoPreco(p: PrecoDoContrato | null): string {
  if (!p) return "Preço da rede";
  const dep =
    p.dependent_mode === "PER_DEPENDENT"
      ? `dependente ${brl(p.dependent_individual_fee_cents)} cada`
      : `dependentes: 1 ${brl(p.dependent_individual_fee_cents)}, pacote até ${p.dependent_family_size} ${brl(p.dependent_family_fee_cents)}, extra ${brl(p.dependent_family_extra_fee_cents)}`;
  return `Titular ${brl(p.holder_fee_cents)}; ${dep}; adesão em até ${p.max_installments}x`;
}

export type Mudanca = { rotulo: string; de: string; para: string };

/** O que a revisão muda, na ordem do formulário. */
export function diferencasDosTermos(antes: TermosDoContrato, depois: TermosDoContrato): Mudanca[] {
  const out: Mudanca[] = [];
  for (const { k, rotulo, fmt } of ROTULOS_DA_EMPRESA) {
    const a = antes.empresa?.[k];
    const b = depois.empresa?.[k];
    if (!igual(a, b)) out.push({ rotulo, de: (fmt as (v: unknown) => string)(a), para: (fmt as (v: unknown) => string)(b) });
  }
  if (!igual(antes.preco, depois.preco)) {
    out.push({ rotulo: "Preço da adesão", de: textoDoPreco(antes.preco), para: textoDoPreco(depois.preco) });
  }
  const tf = (f: TermosDoContrato["faixas"]) =>
    f.length ? f.map((x) => `a partir de ${x.min_quantity}: ${brl(x.price_cents)}`).join(" · ") : "Sem faixas";
  if (!igual(antes.faixas, depois.faixas)) out.push({ rotulo: "Faixas por quantidade", de: tf(antes.faixas ?? []), para: tf(depois.faixas ?? []) });
  return out;
}

// ---------------------------------------------------------------------------
// As recusas do banco
// ---------------------------------------------------------------------------

export function recusaDaRevisao(mensagem: string | null | undefined): string {
  const m = mensagem ?? "";
  if (m.includes("REVISION_OPEN:")) {
    const code = m.split("REVISION_OPEN:")[1]?.match(/RV-\d+/)?.[0] ?? "";
    return `Já existe uma revisão aberta (${code}) para esta empresa. Termine ou cancele essa antes.`;
  }
  if (m.includes("REASON_REQUIRED")) return "Escreva o motivo da revisão (pelo menos 10 letras).";
  if (m.includes("DOCUMENT_REQUIRED")) return "Anexe o aditivo assinado antes de aplicar.";
  if (m.includes("INVALID_DOCUMENT")) return "O arquivo anexado não é um aditivo desta empresa.";
  if (m.includes("NO_CHANGES")) return "A revisão não muda nenhuma regra. Altere algo ou cancele a revisão.";
  if (m.includes("REVISION_CLOSED")) return "Esta revisão já foi aplicada ou cancelada.";
  if (m.includes("INVALID_TERMS")) return "As regras da revisão estão incompletas. Recarregue a página e tente de novo.";
  if (m.includes("NOT_ALLOWED")) return "Você não tem permissão para isso.";
  if (m.includes("CONTRACT_TERMS_LOCKED")) {
    return "As regras combinadas só mudam pela revisão do contrato (aba Regras combinadas → Revisar contrato).";
  }
  if (m.includes("NOT_FOUND")) return "Revisão não encontrada.";
  return "Não foi possível concluir. Tente de novo em instantes.";
}
