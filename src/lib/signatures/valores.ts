import { dataPorExtenso, valorPorExtenso } from "@/lib/empresarial/contrato";
import { formatCnpj, formatCpf } from "@/lib/masks";
import { diaBr } from "@/lib/orcamento";
import { formatBRL as formatBRLIntl } from "@/lib/pricing";

/** O `Intl` separa "R$" do número com espaço que não quebra; no PDF e no texto
 * que a pessoa copia, espaço comum dá menos surpresa (como no Empresarial). */
function formatBRL(cents: number): string {
  return formatBRLIntl(cents).replace(/\u00a0/g, " ");
}

/**
 * O contrato pode ser gerado e assinado no mesmo ato da negociação, antes de
 * o Consultor escrever o resumo (decisão do dono, B12 de
 * `docs/assinaturas/CONTRATO-PRESTACAO-PADRAO.md`). Sem resumo, o campo diz
 * isso por escrito em vez de sair como linha em branco — e o envio segue.
 */
export const RESUMO_NAO_REGISTRADO = "(não registrado até a data da assinatura deste documento)";

/**
 * OS VALORES QUE PREENCHEM OS `{{campos}}` DE UM MODELO DE PACIENTE
 * (`CAMPOS_DO_PACIENTE`, `variables.ts`). Regra pura, testada em
 * `assinaturas-valores.test.ts`: recebe o que o servidor leu e devolve o
 * dicionário; campo sem valor sai `null` (vira a linha em branco no PDF).
 */

export type ClientValues = {
  full_name: string;
  cpf: string | null;
  birth_date: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  address_number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
};

export type GuardianValues = {
  full_name: string;
  cpf: string | null;
  relationship: string | null;
};

export type ClinicValues = {
  name: string;
  /** 0350: a razão social — o nome da CONTRATADA nos documentos. */
  legal_name?: string | null;
  cnpj: string | null;
  phone: string | null;
  address: string | null;
  address_number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
};

export type TreatmentProcedure = {
  description: string;
  quantity: number;
  unitPriceCents: number;
  toothCode?: string | null;
  plannedSessions?: number | null;
};

export type TreatmentValues = {
  procedures: TreatmentProcedure[];
  totalCents: number;
  /** "Cartão de crédito parcelado em 6 parcelas; entrada de R$ 500,00". */
  conditions: string | null;
  /** 'aaaa-mm-dd'. */
  validityIso: string | null;
  dentistName: string | null;
  /** OC-00158: o resumo da apresentação (cockpit do Consultor), quando existe. */
  presentationSummary?: string | null;
};

export function enderecoEmLinha(a: {
  address: string | null;
  address_number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
}): string | null {
  const rua = [a.address, a.address_number].filter(Boolean).join(", ");
  const partes = [
    rua ? rua + (a.complement ? ` (${a.complement})` : "") : null,
    a.neighborhood,
    a.city && a.state ? `${a.city}/${a.state}` : a.city || a.state,
    a.zip_code ? `CEP ${a.zip_code}` : null,
  ].filter(Boolean);
  return partes.length ? partes.join(" – ") : null;
}

/** Uma linha por procedimento: "• Restauração — dente 36 — 2 sessões — R$ 250,00". */
export function procedimentosEmLinhas(procedures: TreatmentProcedure[]): string | null {
  if (procedures.length === 0) return null;
  return procedures
    .map((p) => {
      const partes = [p.description.trim()];
      if (p.toothCode) partes.push(`dente ${p.toothCode}`);
      if (p.quantity > 1) partes.push(`${p.quantity}×`);
      if (p.plannedSessions && p.plannedSessions > 0) {
        partes.push(`${p.plannedSessions} ${p.plannedSessions === 1 ? "sessão" : "sessões"}`);
      }
      partes.push(formatBRL(p.unitPriceCents * p.quantity));
      return `• ${partes.join(" — ")}`;
    })
    .join("\n");
}

export function montarValores(input: {
  client: ClientValues;
  guardian: GuardianValues | null;
  isMinor: boolean;
  clinic: ClinicValues;
  treatment: TreatmentValues | null;
  packageNumber: string;
  /** 'aaaa-mm-dd' no Brasil. */
  todayIso: string;
}): Record<string, string | null> {
  const { client, guardian, clinic, treatment } = input;
  const contratante = input.isMinor && guardian ? guardian : null;
  const dataExtenso = dataPorExtenso(input.todayIso);
  const cidade = clinic.city?.trim() || null;
  return {
    paciente_nome: client.full_name,
    paciente_cpf: client.cpf ? formatCpf(client.cpf) : null,
    paciente_nascimento: client.birth_date ? diaBr(client.birth_date) : null,
    paciente_telefone: client.phone,
    paciente_email: client.email,
    paciente_endereco: enderecoEmLinha(client),
    responsavel_nome: guardian?.full_name ?? null,
    responsavel_cpf: guardian?.cpf ? formatCpf(guardian.cpf) : null,
    responsavel_parentesco: guardian?.relationship ?? null,
    contratante_nome: contratante ? contratante.full_name : client.full_name,
    contratante_cpf: contratante
      ? contratante.cpf
        ? formatCpf(contratante.cpf)
        : null
      : client.cpf
        ? formatCpf(client.cpf)
        : null,
    unidade_nome: clinic.name,
    unidade_razao_social: clinic.legal_name?.trim() || null,
    unidade_cnpj: clinic.cnpj ? formatCnpj(clinic.cnpj) : null,
    unidade_endereco: enderecoEmLinha(clinic),
    unidade_cidade: cidade,
    unidade_telefone: clinic.phone,
    dentista_nome: treatment?.dentistName ?? null,
    tratamento_procedimentos: treatment ? procedimentosEmLinhas(treatment.procedures) : null,
    tratamento_valor_total: treatment ? formatBRL(treatment.totalCents) : null,
    tratamento_valor_extenso: treatment ? valorPorExtenso(treatment.totalCents) : null,
    tratamento_condicoes: treatment?.conditions ?? null,
    tratamento_validade: treatment?.validityIso ? diaBr(treatment.validityIso) : null,
    apresentacao_resumo: treatment?.presentationSummary?.trim() || RESUMO_NAO_REGISTRADO,
    documento_numero: input.packageNumber,
    documento_data: diaBr(input.todayIso),
    documento_data_extenso: dataExtenso ? (cidade ? `${cidade}, ${dataExtenso}` : dataExtenso) : null,
  };
}
