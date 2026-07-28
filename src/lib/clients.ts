// Regras do CADASTRO do cliente (I4).
//
// "Cadastro completo" é o mesmo que o formulário de novo cliente do prontuário
// exige (decisão do dono, 27/07/2026). A mesma régua vale em três lugares:
// no selo do prontuário, no filtro da lista e na trava do agendamento — e está
// espelhada no banco em `clients.registration_complete` (migração 0173).

/** Dados do cliente que entram na conta do "cadastro completo". */
export type ClientRegistrationFields = {
  fullName: string | null;
  cpf: string | null;
  /** Marcado quando a pessoa realmente não tem CPF (ex.: criança). */
  noCpf?: boolean | null;
  birthDate: string | null;
  phone: string | null;
  email: string | null;
  zipCode: string | null;
  address: string | null;
  addressNumber: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  /** Quantos responsáveis o cliente tem (só importa para menor de 18). */
  guardianCount?: number;
};

const filled = (v: string | null | undefined) => Boolean(v && v.trim() !== "");

/** Menor de 18 anos na data de referência. */
export function isMinorOn(birthDate: string | null, ref = new Date()): boolean {
  if (!birthDate) return false;
  const b = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(b.getTime())) return false;
  const limit = new Date(ref);
  limit.setFullYear(limit.getFullYear() - 18);
  return b > limit;
}

/**
 * O que falta para o cadastro ficar completo — em português, na ordem do
 * formulário. Lista vazia = cadastro completo.
 */
export function missingClientFields(c: ClientRegistrationFields): string[] {
  const missing: string[] = [];
  if (!filled(c.fullName)) missing.push("Nome completo");
  if (!c.noCpf && !filled(c.cpf)) missing.push("CPF");
  if (!filled(c.birthDate)) missing.push("Data de nascimento");
  if (!filled(c.phone)) missing.push("Telefone/WhatsApp");
  if (!filled(c.email)) missing.push("E-mail");
  if (!filled(c.zipCode)) missing.push("CEP");
  if (!filled(c.address)) missing.push("Endereço");
  if (!filled(c.addressNumber)) missing.push("Número");
  if (!filled(c.neighborhood)) missing.push("Bairro");
  if (!filled(c.city)) missing.push("Cidade");
  if (!filled(c.state)) missing.push("UF");
  if (isMinorOn(c.birthDate) && (c.guardianCount ?? 0) === 0) {
    missing.push("Responsável (menor de 18 anos)");
  }
  return missing;
}

export function isRegistrationComplete(c: ClientRegistrationFields): boolean {
  return missingClientFields(c).length === 0;
}

/** "Faltam: E-mail, CEP e mais 2." — resumo curto para selo e aviso. */
export function missingSummary(missing: string[], max = 3): string {
  if (missing.length === 0) return "Cadastro completo";
  const head = missing.slice(0, max).join(", ");
  const rest = missing.length - Math.min(max, missing.length);
  return rest > 0 ? `Faltam: ${head} e mais ${rest}` : `Faltam: ${head}`;
}
