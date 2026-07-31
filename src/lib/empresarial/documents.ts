// Documentos da empresa parceira (Empresarial): tipos, rótulos pt-BR, máscara e
// validação. Mesmas funções no navegador (enquanto digita) e no servidor (antes
// de salvar) — igual ao padrão de src/lib/masks.ts.

export const DOC_TYPES = ["CNPJ", "CPF", "CAEPF", "CNO", "NIF"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  CNPJ: "CNPJ",
  CPF: "CPF",
  CAEPF: "CAEPF (produtor rural)",
  CNO: "CNO (obra civil)",
  NIF: "NIF (estrangeiro)",
};

/** Quantos dígitos cada tipo exige (NIF é alfanumérico, 4–20). */
export const DOC_LENGTHS: Record<DocType, number | null> = {
  CNPJ: 14,
  CPF: 11,
  CAEPF: 14,
  CNO: 12,
  NIF: null,
};

export const COMPANY_CATEGORIES = [
  "empresa_privada",
  "orgao_publico",
  "consorcio",
  "condominio",
  "produtor_rural",
  "autonomo",
  "obra_civil",
  "estrangeiro",
] as const;
export type CompanyCategory = (typeof COMPANY_CATEGORIES)[number];

export const COMPANY_CATEGORY_LABELS: Record<CompanyCategory, string> = {
  empresa_privada: "Empresa privada",
  orgao_publico: "Órgão público",
  consorcio: "Consórcio",
  condominio: "Condomínio",
  produtor_rural: "Produtor rural",
  autonomo: "Autônomo",
  obra_civil: "Obra civil",
  estrangeiro: "Estrangeira",
};

/** Tipo de documento sugerido pela categoria (o usuário pode trocar). */
export const SUGGESTED_DOC_BY_CATEGORY: Record<CompanyCategory, DocType> = {
  empresa_privada: "CNPJ",
  orgao_publico: "CNPJ",
  consorcio: "CNPJ",
  condominio: "CNPJ",
  produtor_rural: "CAEPF",
  autonomo: "CPF",
  obra_civil: "CNO",
  estrangeiro: "NIF",
};

export const BILLING_MODELS = ["unico", "por_cnpj"] as const;
export type BillingModel = (typeof BILLING_MODELS)[number];

export const BILLING_MODEL_LABELS: Record<BillingModel, string> = {
  unico: "Boleto único (consolidado)",
  por_cnpj: "Um boleto por CNPJ",
};

export const COMPANY_FILE_TYPES = [
  "contrato_social",
  "cartao_cnpj",
  "procuracao",
  "contrato_programa",
  "outro",
] as const;
export type CompanyFileType = (typeof COMPANY_FILE_TYPES)[number];

export const COMPANY_FILE_TYPE_LABELS: Record<CompanyFileType, string> = {
  contrato_social: "Contrato social",
  cartao_cnpj: "Cartão CNPJ",
  procuracao: "Procuração",
  contrato_programa: "Contrato do programa",
  outro: "Outro",
};

export const EMPLOYEE_FILE_TYPES = [
  "rg",
  "cpf",
  "comprovante_vinculo",
  "termo_adesao",
  "outro",
] as const;
export type EmployeeFileType = (typeof EMPLOYEE_FILE_TYPES)[number];

export const EMPLOYEE_FILE_TYPE_LABELS: Record<EmployeeFileType, string> = {
  rg: "RG",
  cpf: "CPF",
  comprovante_vinculo: "Comprovante de vínculo",
  termo_adesao: "Termo de adesão",
  outro: "Outro",
};

export const COMPANY_DOCS_BUCKET = "empresarial-empresa-docs";
export const EMPLOYEE_DOCS_BUCKET = "empresarial-colaborador-docs";

function digits(value: string, max: number): string {
  return value.replace(/\D/g, "").slice(0, max);
}

/** Aplica a máscara do tipo enquanto o usuário digita. */
export function maskDocument(type: DocType, value: string): string {
  if (type === "NIF") {
    return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 20);
  }
  if (type === "CPF") {
    const d = digits(value, 11);
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
  }
  if (type === "CNPJ") {
    const d = digits(value, 14);
    return d
      .replace(/^(\d{2})(\d)/, "$1.$2")
      .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3/$4")
      .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, "$1.$2.$3/$4-$5");
  }
  if (type === "CAEPF") {
    const d = digits(value, 14);
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3/$4")
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})\/(\d{3})(\d)/, "$1.$2.$3/$4-$5");
  }
  // CNO: 00.000.00000/00
  const d = digits(value, 12);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{2})\.(\d{3})\.(\d{5})(\d)/, "$1.$2.$3/$4");
}

/** Só os caracteres que vão para o banco (dígitos; NIF = alfanumérico). */
export function documentDigits(type: DocType, value: string): string {
  if (type === "NIF") {
    return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  }
  return value.replace(/\D/g, "");
}

/** Valida o tamanho por tipo. Devolve null quando está ok, ou o erro em pt-BR. */
export function validateDocument(type: DocType, value: string): string | null {
  const clean = documentDigits(type, value);
  if (type === "NIF") {
    return clean.length >= 4 && clean.length <= 20
      ? null
      : "O NIF deve ter de 4 a 20 caracteres.";
  }
  const expected = DOC_LENGTHS[type];
  if (expected && clean.length !== expected) {
    return `O ${type} deve ter ${expected} dígitos.`;
  }
  return null;
}

/** Rótulo curto para mostrar o documento numa lista. */
export function documentLabel(
  type: DocType,
  formatted: string,
  nickname?: string | null
): string {
  const base = `${type} ${formatted}`;
  return nickname ? `${nickname} — ${base}` : base;
}
