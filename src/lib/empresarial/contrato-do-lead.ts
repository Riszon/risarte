import "server-only";

import { todayInBrazil } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import type { BenefitType, PaymentModel } from "./constants";
import type { CompanyCategory } from "./documents";
import type { CompanyAddress } from "./types";
import {
  paraQuemVale,
  rotuloDaCarencia,
  rotuloDasUnidades,
  rotuloDoBeneficio,
  rotuloDoUso,
  type BeneficioDaProposta,
} from "./beneficios-da-proposta";
import { carregarVantagensDaProposta } from "./vantagens-servidor";
import { lerMetas, participaDoSocial, rotuloDaMeta, textoDoPagamento } from "./riso-social";
import { lerGenero, montarContrato, type Contratada, type ContratoMontado, type ModeloDeContrato } from "./contrato";
import { lerContratada, lerModelosDoContrato, type ModelosDoContrato } from "./contrato-dados";
import type { AnexoDoContrato } from "./contrato-para-assinatura";
import { empresarialDb } from "./db";

/**
 * O CONTRATO DE ADESÃO DE UM LEAD, LIDO DE UMA VEZ (OC-00083/1027; ZS5).
 *
 * Saiu de dentro da tela `/empresarial/funil/[leadId]/contrato` para que o
 * que se VÊ e o que se ASSINA venham da mesma leitura: a tela desenha, o envio
 * para assinatura (`src/lib/signatures/send-empresa.ts`) vira PDF. Duas
 * leituras diferentes seriam dois contratos diferentes.
 *
 * ⚠️ Contrato não sai com leitura pela metade (AP13): qualquer leitura que
 * falhe volta como `leitura`, com o que não foi lido.
 *
 * ⚠️ `select("*")` no levantamento, de propósito: as colunas novas do contrato
 * nascem em migrações que viajam à mão; pedi-las pelo nome derrubaria a tela.
 */

type LeadRow = { id: string; company_name: string; cnpj: string | null; company_id: string | null; consultant_id: string | null };

export type QualDoContrato = {
  legal_name: string | null;
  category: CompanyCategory | null;
  address: CompanyAddress | null;
  responsible_name: string | null;
  responsible_role: string | null;
  responsible_cpf: string | null;
  responsible_email?: string | null;
  responsible_phone?: string | null;
  responsible_rg?: string | null;
  responsible_nationality?: string | null;
  due_day?: number | null;
  billing_basis: "PER_EMPLOYEE" | "FIXED_PER_COMPANY" | null;
  fixed_monthly_cents: number | null;
  employee_count: number | null;
  holder_fee_cents: number | null;
  includes_dependents: boolean | null;
  dependent_fee_cents: number | null;
  dependent_mode: "PER_DEPENDENT" | "FAMILY_PACKAGE" | null;
  dependent_family_fee_cents: number | null;
  dependent_family_extra_fee_cents: number | null;
  dependent_family_size: number | null;
  company_grace_days: number | null;
  employee_grace_days: number | null;
  // 1034
  payment_model: PaymentModel | null;
  treatment_payment_methods: string[] | null;
  treatment_max_installments: number | null;
  social_participates: boolean | null;
  social_goals: unknown;
  // 1037: ausentes = a migração ainda não rodou neste banco.
  responsible_gender?: string | null;
  min_term_months?: number | null;
  early_exit_fee_cents?: number | null;
};

type BeneficioRow = {
  procedure_id: string;
  benefit_type: BenefitType;
  benefit_value: number | null;
  usage_limit_count: number | null;
  usage_period_months: number | null;
  grace_period_months: number;
  max_installments: number | null;
  for_holder: boolean;
  for_dependent: boolean;
  clinic_ids: string[] | null;
};

type UnidadeRow = { id: string; name: string; city: string | null; state: string | null };

export type BeneficioDoContrato = BeneficioDaProposta & { nome: string };

export type ContratoDoLead = {
  lead: LeadRow;
  q: QualDoContrato | null;
  modelos: ModelosDoContrato;
  modelo: ModeloDeContrato;
  contrato: ContratoMontado;
  contratada: Contratada | null;
  beneficios: BeneficioDoContrato[];
  nomeDaUnidade: Map<string, string>;
  vantagens: { perkId: string; texto: string }[];
};

export type ContratoDoLeadResult =
  | { ok: true; dados: ContratoDoLead }
  | { ok: false; motivo: "lead" }
  | { ok: false; motivo: "modelo"; erroDoModelo: boolean }
  | { ok: false; motivo: "leitura"; naoLido: string[] };

export async function carregarContratoDoLead(leadId: string): Promise<ContratoDoLeadResult> {
  const db = await empresarialDb();
  const { data: lead } = await db
    .from("commercial_leads")
    .select("id, company_name, cnpj, company_id, consultant_id")
    .eq("id", leadId)
    .maybeSingle<LeadRow>();
  if (!lead) return { ok: false, motivo: "lead" };

  const modelos = await lerModelosDoContrato(db, leadId);
  const modelo = modelos.daEmpresa ?? modelos.daRede;
  if (modelos.erro || !modelo) return { ok: false, motivo: "modelo", erroDoModelo: Boolean(modelos.erro) };

  const [
    { data: q, error: erroDoLevantamento },
    { data: faixasRows, error: erroDasFaixas },
    { data: benRows, error: erroDosBeneficios },
    { data: parceriaRows, error: erroDaParceria },
    { contratada, erro: erroDaContratada },
  ] = await Promise.all([
    db.from("lead_qualification").select("*").eq("lead_id", leadId).maybeSingle<QualDoContrato>(),
    db
      .from("lead_price_tiers")
      .select("min_quantity, price_cents")
      .eq("lead_id", leadId)
      .returns<{ min_quantity: number; price_cents: number }[]>(),
    db
      .from("lead_benefits")
      .select(
        "procedure_id, benefit_type, benefit_value, usage_limit_count, usage_period_months, grace_period_months, max_installments, for_holder, for_dependent, clinic_ids"
      )
      .eq("lead_id", leadId)
      .returns<BeneficioRow[]>(),
    db.from("lead_clinics").select("clinic_id").eq("lead_id", leadId).returns<{ clinic_id: string }[]>(),
    lerContratada(db),
  ]);
  // 1033: as outras vantagens combinadas — entram no anexo (decisão do dono).
  const vantagens = await carregarVantagensDaProposta(db, leadId);

  const naoLido = [
    erroDoLevantamento && "a proposta",
    erroDasFaixas && "as faixas de preço",
    erroDosBeneficios && "os benefícios",
    vantagens === null && "as outras vantagens",
    erroDaParceria && "as unidades da parceria",
    erroDaContratada && "os dados da Risarte",
  ].filter((x): x is string => Boolean(x));

  const supabase = await createClient();
  const idsDaParceria = (parceriaRows ?? []).map((c) => c.clinic_id);
  // Sem parceria declarada, o programa não limita unidade nenhuma (a regra de
  // `valeNaUnidade`): a abrangência é a de todas as unidades ativas da rede.
  const consultaDeUnidades = supabase.from("clinics").select("id, name, city, state");
  const { data: unidadesRows, error: erroDasUnidades } = await (
    idsDaParceria.length > 0
      ? consultaDeUnidades.in("id", idsDaParceria)
      : consultaDeUnidades.eq("is_active", true).eq("type", "franchise_unit")
  ).returns<UnidadeRow[]>();
  if (erroDasUnidades) naoLido.push("as unidades");

  const beneficios: BeneficioDoContrato[] = [];
  if (benRows?.length) {
    const { data: procs, error: erroDosProcedimentos } = await supabase
      .from("procedures")
      .select("id, name")
      .in("id", benRows.map((b) => b.procedure_id))
      .returns<{ id: string; name: string }[]>();
    if (erroDosProcedimentos) naoLido.push("os nomes dos procedimentos");
    const nomePorId = new Map((procs ?? []).map((x) => [x.id, x.name]));
    for (const b of benRows) {
      beneficios.push({
        nome: nomePorId.get(b.procedure_id) ?? "Procedimento",
        procedureId: b.procedure_id,
        benefitType: b.benefit_type,
        benefitValue: b.benefit_value,
        usageLimitCount: b.usage_limit_count,
        usagePeriodMonths: b.usage_period_months,
        gracePeriodMonths: b.grace_period_months,
        maxInstallments: b.max_installments,
        forHolder: b.for_holder,
        forDependent: b.for_dependent,
        clinicIds: b.clinic_ids ?? [],
      });
    }
    beneficios.sort((a, z) => a.nome.localeCompare(z.nome, "pt-BR"));
  }
  if (naoLido.length > 0) return { ok: false, motivo: "leitura", naoLido };

  const unidades = unidadesRows ?? [];
  const contrato = montarContrato({
    empresa: {
      companyName: lead.company_name,
      cnpj: lead.cnpj,
      legalName: q?.legal_name ?? null,
      category: q?.category ?? null,
      address: q?.address ?? null,
      responsibleName: q?.responsible_name ?? null,
      responsibleRole: q?.responsible_role ?? null,
      responsibleNationality: q?.responsible_nationality ?? null,
      responsibleRg: q?.responsible_rg ?? null,
      responsibleCpf: q?.responsible_cpf ?? null,
      dueDay: q?.due_day ?? null,
      billingBasis: q?.billing_basis ?? null,
      fixedMonthlyCents: q?.fixed_monthly_cents ?? null,
      employeeCount: q?.employee_count ?? null,
      holderFeeCents: q?.holder_fee_cents ?? null,
      includesDependents: q?.includes_dependents ?? null,
      dependentFeeCents: q?.dependent_fee_cents ?? null,
      dependentMode: q?.dependent_mode ?? null,
      dependentFamilyFeeCents: q?.dependent_family_fee_cents ?? null,
      dependentFamilyExtraFeeCents: q?.dependent_family_extra_fee_cents ?? null,
      dependentFamilySize: q?.dependent_family_size ?? null,
      responsibleGender: lerGenero(q?.responsible_gender),
      minTermMonths: q?.min_term_months ?? null,
      earlyExitFeeCents: q?.early_exit_fee_cents ?? null,
    },
    faixas: (faixasRows ?? []).map((f) => ({ minQuantity: f.min_quantity, priceCents: f.price_cents })),
    contratada,
    unidades,
    beneficios: beneficios.length,
    hoje: todayInBrazil(),
  });

  return {
    ok: true,
    dados: {
      lead,
      q: q ?? null,
      modelos,
      modelo,
      contrato,
      contratada,
      beneficios,
      nomeDaUnidade: new Map(unidades.map((u) => [u.id, u.name])),
      vantagens: (vantagens ?? []).map((v) => ({ perkId: v.perkId, texto: v.texto })),
    },
  };
}

/** O Anexo I na forma do PDF de assinatura — os MESMOS rótulos da tela. */
export function anexoDoContrato(d: ContratoDoLead): AnexoDoContrato {
  const q = d.q;
  const metas = lerMetas(q?.social_goals);
  return {
    carenciaDoProgramaDias: q?.company_grace_days ?? null,
    carenciaDoTitularDias: q?.employee_grace_days ?? null,
    beneficios: d.beneficios.map((b) => ({
      nome: b.nome,
      unidades: b.clinicIds?.length ? rotuloDasUnidades(b.clinicIds, d.nomeDaUnidade) : null,
      cobertura: rotuloDoBeneficio(b),
      paraQuem: paraQuemVale(b),
      limite: rotuloDoUso(b) ?? "sem limite",
      carencia: rotuloDaCarencia(b) ?? "sem carência",
    })),
    pagamento: textoDoPagamento(q?.treatment_payment_methods, q?.treatment_max_installments),
    social:
      participaDoSocial(q?.payment_model) && q?.social_participates !== false
        ? { metas: metas.map((m) => rotuloDaMeta(m)) }
        : null,
    vantagens: d.vantagens.map((v) => v.texto),
  };
}
