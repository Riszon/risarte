// FORNECEDORES (0371) — as regras puras do cadastro: rótulos, abrangência,
// obrigatórios e o "onde vale". A barreira de verdade é o banco
// (`save_supplier`, `can_see_supplier`); isto serve à tela e aos testes.

import { isValidCnpj, isValidCpf } from "@/lib/masks";

export type SupplierScope = "franqueadora" | "rede" | "unidades";

export const SCOPE_LABELS: Record<SupplierScope, string> = {
  franqueadora: "Só a Franqueadora",
  rede: "Todas as unidades",
  unidades: "Unidades escolhidas",
};

export const PAYMENT_METHOD_OPTIONS = [
  { value: "boleto", label: "Boleto" },
  { value: "pix", label: "PIX" },
  { value: "transferencia", label: "Transferência" },
  { value: "cartao", label: "Cartão" },
  { value: "debito_automatico", label: "Débito automático" },
  { value: "dinheiro", label: "Dinheiro" },
] as const;

export const BANK_ACCOUNT_TYPE_OPTIONS = [
  { value: "corrente", label: "Corrente" },
  { value: "poupanca", label: "Poupança" },
  { value: "pagamento", label: "Conta de pagamento" },
] as const;

export const PIX_KEY_TYPE_OPTIONS = [
  { value: "cpf_cnpj", label: "CPF / CNPJ" },
  { value: "email", label: "E-mail" },
  { value: "telefone", label: "Telefone" },
  { value: "aleatoria", label: "Chave aleatória" },
] as const;

const porValor = (lista: readonly { value: string; label: string }[]) =>
  Object.fromEntries(lista.map((o) => [o.value, o.label]));

export const PAYMENT_METHOD_LABELS: Record<string, string> = porValor(PAYMENT_METHOD_OPTIONS);
export const BANK_ACCOUNT_TYPE_LABELS: Record<string, string> = porValor(BANK_ACCOUNT_TYPE_OPTIONS);
export const PIX_KEY_TYPE_LABELS: Record<string, string> = porValor(PIX_KEY_TYPE_OPTIONS);

export type SupplierKind = {
  code: string;
  label: string;
  sortOrder: number;
  active: boolean;
};

/** Tudo o que a ficha mostra e grava. Textos vazios viram "" na tela. */
export type SupplierForm = {
  id: string;
  name: string;
  legalName: string;
  document: string;
  kind: string;
  scope: SupplierScope;
  clinicIds: string[];
  stateRegistration: string;
  municipalRegistration: string;
  contactName: string;
  phone: string;
  whatsapp: string;
  email: string;
  financeEmail: string;
  website: string;
  addressZip: string;
  addressStreet: string;
  addressNumber: string;
  addressComplement: string;
  addressDistrict: string;
  addressCity: string;
  addressState: string;
  bankName: string;
  bankBranch: string;
  bankAccount: string;
  bankAccountType: string;
  accountHolder: string;
  accountHolderDocument: string;
  pixKeyType: string;
  pixKey: string;
  defaultPaymentMethod: string;
  paymentTermsDays: string;
  defaultAccountCode: string;
  paymentNotes: string;
  notes: string;
  active: boolean;
};

export const EMPTY_SUPPLIER: SupplierForm = {
  id: "",
  name: "",
  legalName: "",
  document: "",
  kind: "",
  scope: "unidades",
  clinicIds: [],
  stateRegistration: "",
  municipalRegistration: "",
  contactName: "",
  phone: "",
  whatsapp: "",
  email: "",
  financeEmail: "",
  website: "",
  addressZip: "",
  addressStreet: "",
  addressNumber: "",
  addressComplement: "",
  addressDistrict: "",
  addressCity: "",
  addressState: "",
  bankName: "",
  bankBranch: "",
  bankAccount: "",
  bankAccountType: "",
  accountHolder: "",
  accountHolderDocument: "",
  pixKeyType: "",
  pixKey: "",
  defaultPaymentMethod: "",
  paymentTermsDays: "",
  defaultAccountCode: "",
  paymentNotes: "",
  notes: "",
  active: true,
};

/** As colunas que a ficha lê do banco (uma lista só, para não divergir). */
export const SUPPLIER_COLUMNS =
  "id, clinic_id, name, legal_name, document, kind, scope, state_registration, municipal_registration, contact_name, phone, whatsapp, email, finance_email, website, address_zip, address_street, address_number, address_complement, address_district, address_city, address_state, bank_name, bank_branch, bank_account, bank_account_type, account_holder, account_holder_document, pix_key_type, pix_key, default_payment_method, payment_terms_days, default_account_code, payment_notes, notes, active, created_at, created_by, updated_at, updated_by";

const t = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Linha do banco → ficha da tela. */
export function supplierFromRow(r: Record<string, unknown>, clinicIds: string[]): SupplierForm {
  return {
    id: t(r.id),
    name: t(r.name),
    legalName: t(r.legal_name),
    document: t(r.document),
    kind: t(r.kind),
    scope: (t(r.scope) || "unidades") as SupplierScope,
    clinicIds,
    stateRegistration: t(r.state_registration),
    municipalRegistration: t(r.municipal_registration),
    contactName: t(r.contact_name),
    phone: t(r.phone),
    whatsapp: t(r.whatsapp),
    email: t(r.email),
    financeEmail: t(r.finance_email),
    website: t(r.website),
    addressZip: t(r.address_zip),
    addressStreet: t(r.address_street),
    addressNumber: t(r.address_number),
    addressComplement: t(r.address_complement),
    addressDistrict: t(r.address_district),
    addressCity: t(r.address_city),
    addressState: t(r.address_state),
    bankName: t(r.bank_name),
    bankBranch: t(r.bank_branch),
    bankAccount: t(r.bank_account),
    bankAccountType: t(r.bank_account_type),
    accountHolder: t(r.account_holder),
    accountHolderDocument: t(r.account_holder_document),
    pixKeyType: t(r.pix_key_type),
    pixKey: t(r.pix_key),
    defaultPaymentMethod: t(r.default_payment_method),
    paymentTermsDays: t(r.payment_terms_days),
    defaultAccountCode: t(r.default_account_code),
    paymentNotes: t(r.payment_notes),
    notes: t(r.notes),
    active: r.active !== false,
  };
}

/** Ficha da tela → o que a porta `save_supplier` recebe. */
export function supplierToPayload(f: SupplierForm, ownerClinicId: string | null) {
  return {
    id: f.id || null,
    owner_clinic_id: ownerClinicId,
    name: f.name,
    legal_name: f.legalName,
    document: f.document,
    kind: f.kind,
    scope: f.scope,
    clinic_ids: f.scope === "unidades" ? f.clinicIds : [],
    state_registration: f.stateRegistration,
    municipal_registration: f.municipalRegistration,
    contact_name: f.contactName,
    phone: f.phone,
    whatsapp: f.whatsapp,
    email: f.email,
    finance_email: f.financeEmail,
    website: f.website,
    address_zip: f.addressZip,
    address_street: f.addressStreet,
    address_number: f.addressNumber,
    address_complement: f.addressComplement,
    address_district: f.addressDistrict,
    address_city: f.addressCity,
    address_state: f.addressState,
    bank_name: f.bankName,
    bank_branch: f.bankBranch,
    bank_account: f.bankAccount,
    bank_account_type: f.bankAccountType,
    account_holder: f.accountHolder,
    account_holder_document: f.accountHolderDocument,
    pix_key_type: f.pixKeyType,
    pix_key: f.pixKey,
    default_payment_method: f.defaultPaymentMethod,
    payment_terms_days: f.paymentTermsDays.replace(/\D/g, ""),
    default_account_code: f.defaultAccountCode,
    payment_notes: f.paymentNotes,
    notes: f.notes,
    active: f.active,
  };
}

/** "Pessoa jurídica" / "Pessoa física" pelo tamanho do documento. */
export function tipoDePessoa(document: string): string | null {
  const d = document.replace(/\D/g, "");
  if (d.length === 14) return "Pessoa jurídica";
  if (d.length === 11) return "Pessoa física";
  return null;
}

/**
 * Os obrigatórios (decisão do dono, 09/11/2026): nome, tipo, abrangência e
 * CNPJ/CPF. Devolve a primeira falta, na ordem da ficha, ou null. O banco
 * confere os mesmos (menos o dígito verificador, que é só aviso).
 */
export function faltaNaFicha(f: SupplierForm): string | null {
  if (!f.name.trim()) return "Informe o nome do fornecedor.";
  const d = f.document.replace(/\D/g, "");
  if (d.length !== 11 && d.length !== 14)
    return "Informe o CNPJ (14 dígitos) ou o CPF (11 dígitos).";
  if (!f.kind) return "Escolha o tipo do fornecedor.";
  if (f.scope === "unidades" && f.clinicIds.length === 0)
    return "Escolha ao menos uma unidade.";
  return null;
}

/** Aviso (não trava): documento com dígito verificador errado. */
export function avisoDoDocumento(document: string): string | null {
  const d = document.replace(/\D/g, "");
  if (d.length === 14 && !isValidCnpj(d)) return "Este CNPJ não confere (dígito verificador). Confira antes de salvar.";
  if (d.length === 11 && !isValidCpf(d)) return "Este CPF não confere (dígito verificador). Confira antes de salvar.";
  return null;
}

/** "Todas as unidades" · "Só a Franqueadora" · "Cambé, Londrina". */
export function descreverAbrangencia(
  scope: SupplierScope,
  clinicIds: string[],
  nomes: Map<string, string>
): string {
  if (scope !== "unidades") return SCOPE_LABELS[scope];
  const lista = clinicIds.map((id) => nomes.get(id) ?? "unidade").sort((a, b) => a.localeCompare(b, "pt-BR"));
  return lista.length ? lista.join(", ") : "Nenhuma unidade";
}

/** O fornecedor vale nesta unidade? (espelho de `supplier_serves_clinic`) */
export function valeNaUnidade(
  scope: SupplierScope,
  clinicIds: string[],
  clinicId: string,
  clinicIsFranchisor: boolean
): boolean {
  if (scope === "rede") return true;
  if (scope === "franqueadora") return clinicIsFranchisor;
  return clinicIds.includes(clinicId);
}

/** Código de um tipo novo a partir do nome: "TI e software" → "ti_e_software". */
export function codigoDoTipo(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** As opções de tipo para escolher: as ativas, mais a atual se estiver desativada. */
export function opcoesDeTipo(kinds: SupplierKind[], atual: string): SupplierKind[] {
  return kinds
    .filter((k) => k.active || k.code === atual)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "pt-BR"));
}
