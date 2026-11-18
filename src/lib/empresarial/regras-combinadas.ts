// Risarte Empresarial — AS REGRAS COMBINADAS DA EMPRESA, num lugar só
// (pedido do dono, 18/11/2026; plano docs/risarte-empresarial/REVISAR-CONTRATO-PLANO.md,
// Etapa 1).
//
// "Quando criada a empresa deve ter como visualizar todas as regras
// combinadas, faixa de pagamento etc." As regras moram em várias tabelas
// (companies, adhesion_pricing, company_price_tiers, procedure_benefits,
// company_perks, company_clinics, split_rules, os termos de inclusão e a
// proposta do lead); esta função só MONTA o texto que a tela mostra.
//
// Pura: quem lê o banco é `regras-combinadas.tsx`. Cada linha diz quando o
// que vale é o PADRÃO DA REDE (a empresa não tem regra própria).

import { formatBRL } from "@/lib/pricing";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_MODEL_LABELS,
  type PaymentMethod,
  type PaymentModel,
} from "./constants";
import { BILLING_MODEL_LABELS, type BillingModel } from "./documents";

export type PrecoDaAdesao = {
  holder_fee_cents: number;
  dependent_individual_fee_cents: number;
  dependent_family_fee_cents: number;
  dependent_family_extra_fee_cents: number;
  dependent_family_size: number | null;
  dependent_mode: string | null;
  max_installments: number | null;
};

export type DivisaoDoPagamento = {
  first_payment_risarte_pct: number;
  first_payment_rislife_pct: number;
  recurring_risarte_pct: number;
  recurring_rislife_pct: number;
};

export type EmpresaDasRegras = {
  payment_model: string;
  company_subsidy_type: string | null;
  company_subsidy_value: number | null;
  due_day: number | null;
  billing_model: string | null;
  payment_methods: string[] | null;
  default_max_installments: number | null;
  contract_started_at: string | null;
  grace_period_days: number | null;
  employee_grace_period_days: number | null;
  special_agreements: string | null;
  min_adhesions: number | null;
  max_adhesions: number | null;
  adhesion_limit_target: string | null;
  origin_lead_id: string | null;
  contracted_holders: number | null;
  contracted_dependents: number | null;
  excess_mode: string | null;
  excess_fixed_cents: number | null;
  excess_holder_fee_cents: number | null;
  excess_dependent_fee_cents: number | null;
  billing_basis: string | null;
  fixed_monthly_cents: number | null;
  implantation_includes_dependents: boolean | null;
  implantation_dependents_cents: number | null;
  social_participates: boolean | null;
};

export type DadosDasRegras = {
  empresa: EmpresaDasRegras;
  precoDaEmpresa: PrecoDaAdesao | null;
  precoDaRede: PrecoDaAdesao | null;
  faixas: { min_quantity: number; price_cents: number }[];
  termosAceitos: { holders: number; dependents: number }[];
  /** Contratado + termos aceitos (`limite_de_titulares`); nulo = sem trava. */
  limiteDeTitulares: number | null;
  /** Implantações não canceladas. */
  implantacoes: { status: string; total_amount_cents: number; holders_covered: number | null }[];
  beneficiosProprios: number;
  beneficiosDaRede: number;
  vantagens: { name: string; status: string }[];
  unidadePrincipal: string | null;
  unidades: string[];
  divisaoDaEmpresa: DivisaoDoPagamento | null;
  divisaoDaRede: DivisaoDoPagamento | null;
  /** Só a empresa que veio do funil. */
  proposta: {
    contratoAssinadoEm: string | null;
    prazoMinimoMeses: number | null;
    multaDeSaidaCents: number | null;
  } | null;
};

export type LinhaDaRegra = {
  rotulo: string;
  valor: string;
  /** Vale o padrão da rede (a empresa não tem regra própria). */
  padraoDaRede?: boolean;
};

export type BlocoDeRegras = {
  chave: string;
  titulo: string;
  linhas: LinhaDaRegra[];
  /** Algo a conferir antes de agir (ex.: a implantação da importada). */
  aviso?: string;
};

const NAO_COMBINADO = "Não combinado";

function dias(n: number | null | undefined): string {
  if (n == null) return NAO_COMBINADO;
  if (n === 0) return "Sem carência";
  return n === 1 ? "1 dia" : `${n} dias`;
}

function pessoas(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

function dataBr(iso: string | null): string | null {
  if (!iso) return null;
  const [a, m, d] = iso.slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : null;
}

function pct(n: number): string {
  return `${Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/** De onde a empresa veio: o funil (com proposta) ou a importação/cadastro direto. */
export function origemDaEmpresa(d: DadosDasRegras): "funil" | "sem_proposta" {
  return d.empresa.origin_lead_id ? "funil" : "sem_proposta";
}

function blocoOrigem(d: DadosDasRegras): BlocoDeRegras {
  const e = d.empresa;
  const linhas: LinhaDaRegra[] = [];
  if (origemDaEmpresa(d) === "funil") {
    linhas.push({ rotulo: "Origem", valor: "Funil comercial (proposta e contrato no sistema)" });
    const assinado = dataBr(d.proposta?.contratoAssinadoEm ?? null);
    linhas.push({ rotulo: "Contrato de adesão", valor: assinado ? `Assinado em ${assinado}` : "Sem assinatura registrada" });
  } else {
    linhas.push({
      rotulo: "Origem",
      valor: "Importação ou cadastro direto (sem proposta no sistema; o contrato é o assinado fora)",
    });
  }
  linhas.push({ rotulo: "Início do contrato", valor: dataBr(e.contract_started_at) ?? "Nasce no 1º pagamento" });
  const prazo = d.proposta?.prazoMinimoMeses;
  linhas.push({
    rotulo: "Prazo mínimo (fidelidade)",
    valor: prazo ? `${prazo} meses` : NAO_COMBINADO,
  });
  const multa = d.proposta?.multaDeSaidaCents;
  linhas.push({ rotulo: "Multa de saída antecipada", valor: multa ? formatBRL(multa) : NAO_COMBINADO });
  if (e.special_agreements?.trim()) {
    linhas.push({ rotulo: "Combinado na venda", valor: e.special_agreements.trim() });
  }
  return { chave: "origem", titulo: "Contrato", linhas };
}

function blocoPreco(d: DadosDasRegras): BlocoDeRegras {
  const e = d.empresa;
  const linhas: LinhaDaRegra[] = [];
  const fixo = e.billing_basis === "FIXED_PER_COMPANY";
  if (fixo) {
    linhas.push({ rotulo: "Como se cobra", valor: "Valor fixo por empresa" });
    linhas.push({
      rotulo: "Valor fixo mensal",
      valor: e.fixed_monthly_cents != null ? formatBRL(e.fixed_monthly_cents) : "Não cadastrado",
    });
  } else {
    linhas.push({ rotulo: "Como se cobra", valor: "Por titular" });
  }
  const preco = d.precoDaEmpresa ?? d.precoDaRede;
  const daRede = !d.precoDaEmpresa;
  if (preco) {
    if (!fixo) {
      linhas.push({ rotulo: "Preço por titular", valor: formatBRL(preco.holder_fee_cents), padraoDaRede: daRede });
    }
    const modo = preco.dependent_mode === "PER_DEPENDENT" ? "PER_DEPENDENT" : "FAMILY_PACKAGE";
    linhas.push({
      rotulo: "Dependentes",
      valor:
        modo === "PER_DEPENDENT"
          ? `Por dependente: ${formatBRL(preco.dependent_individual_fee_cents)} cada`
          : `Plano familiar: 1 dependente ${formatBRL(preco.dependent_individual_fee_cents)}; ` +
            `pacote de até ${preco.dependent_family_size ?? 3} ${formatBRL(preco.dependent_family_fee_cents)}; ` +
            `cada extra ${formatBRL(preco.dependent_family_extra_fee_cents)}`,
      padraoDaRede: daRede,
    });
  } else {
    linhas.push({ rotulo: "Preço da adesão", valor: "Não cadastrado (nem na rede)" });
  }
  if (!fixo) {
    const faixas = [...d.faixas].sort((a, b) => a.min_quantity - b.min_quantity);
    linhas.push({
      rotulo: "Faixas por quantidade",
      valor: faixas.length
        ? faixas.map((f) => `a partir de ${f.min_quantity}: ${formatBRL(f.price_cents)}`).join(" · ")
        : "Sem faixas (vale o preço por titular)",
    });
  }
  return { chave: "preco", titulo: "Preço", linhas };
}

function blocoQuantidade(d: DadosDasRegras): BlocoDeRegras {
  const e = d.empresa;
  const linhas: LinhaDaRegra[] = [];
  linhas.push({
    rotulo: "Titulares contratados",
    valor: e.contracted_holders != null ? String(e.contracted_holders) : "Não informado (cobra pelos cadastrados)",
  });
  if (e.contracted_dependents != null) {
    linhas.push({ rotulo: "Dependentes contratados", valor: String(e.contracted_dependents) });
  }
  const termos = d.termosAceitos;
  if (termos.length) {
    const t = termos.reduce((s, x) => s + (x.holders ?? 0), 0);
    const dp = termos.reduce((s, x) => s + (x.dependents ?? 0), 0);
    linhas.push({
      rotulo: "Termos de inclusão aceitos",
      valor: `${termos.length} (+${pessoas(t, "titular", "titulares")}${dp ? `, +${pessoas(dp, "dependente", "dependentes")}` : ""})`,
    });
  }
  if (d.limiteDeTitulares != null) {
    linhas.push({ rotulo: "Limite de titulares hoje", valor: String(d.limiteDeTitulares) });
  }
  const alvo =
    e.adhesion_limit_target === "DEPENDENTS"
      ? "dependentes"
      : e.adhesion_limit_target === "BOTH"
        ? "titulares e dependentes"
        : "titulares";
  if (e.min_adhesions != null || e.max_adhesions != null) {
    const partes = [
      e.min_adhesions != null ? `mínimo ${e.min_adhesions}` : null,
      e.max_adhesions != null ? `máximo ${e.max_adhesions}` : null,
    ].filter(Boolean);
    linhas.push({ rotulo: "Limites de adesão", valor: `${partes.join(", ")} (${alvo})` });
  } else {
    linhas.push({ rotulo: "Limites de adesão", valor: "Sem mínimo nem máximo" });
  }
  if (e.billing_basis === "FIXED_PER_COMPANY") {
    const modo =
      e.excess_mode === "NEW_FIXED"
        ? `novo valor fixo${e.excess_fixed_cents != null ? ` de ${formatBRL(e.excess_fixed_cents)}` : ""}`
        : e.excess_mode === "PER_ADHESION"
          ? `por adesão (titular ${e.excess_holder_fee_cents != null ? formatBRL(e.excess_holder_fee_cents) : "?"}, dependente ${e.excess_dependent_fee_cents != null ? formatBRL(e.excess_dependent_fee_cents) : "?"})`
          : NAO_COMBINADO;
    linhas.push({ rotulo: "Acima do contratado", valor: modo });
  } else {
    linhas.push({ rotulo: "Acima do contratado", valor: "Pelo preço da tabela, com a faixa (termo de inclusão)" });
  }
  return { chave: "quantidade", titulo: "Quantidade contratada", linhas };
}

function blocoImplantacao(d: DadosDasRegras): BlocoDeRegras {
  const e = d.empresa;
  const linhas: LinhaDaRegra[] = [];
  const fixo = e.billing_basis === "FIXED_PER_COMPANY";
  linhas.push({
    rotulo: "Regra",
    valor: fixo
      ? "Um mês do valor fixo (e o acréscimo de cada termo de inclusão)"
      : e.implantation_includes_dependents
        ? "Um mês dos titulares e dos dependentes"
        : "Um mês dos titulares (dependentes não pagam implantação)",
  });
  if (!fixo && e.implantation_includes_dependents && e.implantation_dependents_cents != null) {
    linhas.push({
      rotulo: "Estimativa dos dependentes (fechamento)",
      valor: formatBRL(e.implantation_dependents_cents),
    });
  }
  const vivas = d.implantacoes;
  let aviso: string | undefined;
  if (vivas.length === 0) {
    linhas.push({ rotulo: "Situação", valor: "Nenhuma implantação gerada no sistema" });
    if (origemDaEmpresa(d) === "sem_proposta") {
      aviso =
        "Empresa importada ou cadastrada direto: a importação não gera implantação. Antes de usar " +
        "Gerar implantação (aba Financeiro), confira se ela já pagou fora do sistema — o botão cobra " +
        "a implantação inteira.";
    }
  } else {
    const pagas = vivas.filter((i) => i.status === "PAID");
    const abertas = vivas.length - pagas.length;
    const total = vivas.reduce((s, i) => s + Number(i.total_amount_cents ?? 0), 0);
    const cobertos = vivas.reduce((s, i) => s + Math.max(0, i.holders_covered ?? 0), 0);
    linhas.push({
      rotulo: "Situação",
      valor:
        `${pessoas(vivas.length, "implantação", "implantações")} (${formatBRL(total)}): ` +
        `${pagas.length} paga(s)${abertas ? `, ${abertas} em aberto` : ""}`,
    });
    if (cobertos > 0) {
      linhas.push({ rotulo: "Titulares já cobertos", valor: String(cobertos) });
    }
  }
  return { chave: "implantacao", titulo: "Implantação", linhas, aviso };
}

function blocoCobranca(d: DadosDasRegras): BlocoDeRegras {
  const e = d.empresa;
  const linhas: LinhaDaRegra[] = [];
  let quem = PAYMENT_MODEL_LABELS[e.payment_model as PaymentModel] ?? e.payment_model;
  if (e.payment_model === "COMPANY_PARTIAL" && e.company_subsidy_value != null) {
    quem +=
      e.company_subsidy_type === "PERCENT"
        ? ` (a empresa paga ${pct(e.company_subsidy_value)})`
        : ` (a empresa paga ${formatBRL(e.company_subsidy_value)})`;
  }
  linhas.push({ rotulo: "Quem paga", valor: quem });
  linhas.push({ rotulo: "Vencimento", valor: e.due_day ? `Todo dia ${e.due_day}` : NAO_COMBINADO });
  linhas.push({
    rotulo: "Boletos",
    valor: BILLING_MODEL_LABELS[(e.billing_model ?? "unico") as BillingModel] ?? String(e.billing_model),
  });
  const formas = (e.payment_methods ?? []).map((m) => PAYMENT_METHOD_LABELS[m as PaymentMethod] ?? m);
  linhas.push({
    rotulo: "Tratamento: formas de pagamento",
    valor: formas.length ? formas.join(", ") : NAO_COMBINADO,
  });
  linhas.push({
    rotulo: "Tratamento: parcelas",
    valor: e.default_max_installments ? `Até ${e.default_max_installments}x` : NAO_COMBINADO,
  });
  return { chave: "cobranca", titulo: "Cobrança e pagamento", linhas };
}

function blocoCarencias(d: DadosDasRegras): BlocoDeRegras {
  const e = d.empresa;
  return {
    chave: "carencias",
    titulo: "Carências",
    linhas: [
      { rotulo: "Da empresa (a partir do início do contrato)", valor: dias(e.grace_period_days) },
      { rotulo: "Do colaborador (a partir da entrada)", valor: dias(e.employee_grace_period_days) },
    ],
  };
}

function blocoBeneficios(d: DadosDasRegras): BlocoDeRegras {
  const linhas: LinhaDaRegra[] = [];
  linhas.push(
    d.beneficiosProprios > 0
      ? { rotulo: "Procedimentos com benefício", valor: `${d.beneficiosProprios} combinado(s) com a empresa (detalhe na aba Plano & Benefícios)` }
      : {
          rotulo: "Procedimentos com benefício",
          valor: `Os da rede (${d.beneficiosDaRede}; detalhe na aba Plano & Benefícios)`,
          padraoDaRede: true,
        }
  );
  const ativas = d.vantagens;
  linhas.push({
    rotulo: "Outras vantagens",
    valor: ativas.length ? ativas.map((v) => v.name).join(", ") : "Nenhuma",
  });
  linhas.push({
    rotulo: "Riso+ Social",
    valor: d.empresa.social_participates === false ? "Não participa" : "Participa",
  });
  return { chave: "beneficios", titulo: "Benefícios", linhas };
}

function blocoUnidadesEDivisao(d: DadosDasRegras): BlocoDeRegras {
  const linhas: LinhaDaRegra[] = [];
  linhas.push({ rotulo: "Unidade principal", valor: d.unidadePrincipal ?? "Não definida" });
  linhas.push({
    rotulo: "Unidades da parceria",
    valor: d.unidades.length ? [...d.unidades].sort((a, b) => a.localeCompare(b, "pt-BR")).join(", ") : "Toda a rede",
  });
  const div = d.divisaoDaEmpresa ?? d.divisaoDaRede;
  if (div) {
    linhas.push({
      rotulo: "Divisão do 1º pagamento",
      valor: `Risarte ${pct(div.first_payment_risarte_pct)} · RisLife ${pct(div.first_payment_rislife_pct)}`,
      padraoDaRede: !d.divisaoDaEmpresa,
    });
    linhas.push({
      rotulo: "Divisão da mensalidade",
      valor: `Risarte ${pct(div.recurring_risarte_pct)} · RisLife ${pct(div.recurring_rislife_pct)}`,
      padraoDaRede: !d.divisaoDaEmpresa,
    });
  }
  return { chave: "unidades", titulo: "Unidades e divisão (split)", linhas };
}

/** Todos os blocos, na ordem da tela. */
export function montarRegras(d: DadosDasRegras): BlocoDeRegras[] {
  return [
    blocoOrigem(d),
    blocoPreco(d),
    blocoQuantidade(d),
    blocoImplantacao(d),
    blocoCobranca(d),
    blocoCarencias(d),
    blocoBeneficios(d),
    blocoUnidadesEDivisao(d),
  ];
}
