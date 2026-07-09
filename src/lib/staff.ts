// Risartanos — colaboradores da unidade (H4.1). Tipos e rótulos compartilhados
// entre a tela, as ações e a ficha. Identificadores em inglês; rótulos pt-BR.

/** Bucket privado das fotos dos colaboradores (H4.1 Lote 1b). */
export const STAFF_PHOTO_BUCKET = "staff-photos";

export const GENDERS = ["female", "male", "other", "undisclosed"] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = {
  female: "Feminino",
  male: "Masculino",
  other: "Outro",
  undisclosed: "Prefiro não informar",
};

export const MARITAL_STATUSES = [
  "single",
  "married",
  "stable_union",
  "divorced",
  "widowed",
] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];
export const MARITAL_LABELS: Record<MaritalStatus, string> = {
  single: "Solteiro(a)",
  married: "Casado(a)",
  stable_union: "União estável",
  divorced: "Divorciado(a)",
  widowed: "Viúvo(a)",
};

export const CONTRACT_TYPES = [
  "clt",
  "pj",
  "intern",
  "freelancer",
  "other",
] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];
export const CONTRACT_LABELS: Record<ContractType, string> = {
  clt: "CLT",
  pj: "PJ",
  intern: "Estagiário(a)",
  freelancer: "Autônomo(a)",
  other: "Outro",
};

export type StaffMember = {
  id: string;
  clinicId: string;
  code: string | null;
  fullName: string;
  preferredName: string | null;
  cpf: string | null;
  birthDate: string | null;
  gender: Gender | null;
  maritalStatus: MaritalStatus | null;
  spouseName: string | null;
  spousePhone: string | null;
  whatsapp: string | null;
  email: string | null;
  zipCode: string | null;
  address: string | null;
  addressNumber: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  contractType: ContractType | null;
  roleTitle: string | null;
  photoPath: string | null;
  notes: string | null;
  isActive: boolean;
  /** Usuário de acesso (login) vinculado — H4.1 Lote 2b. */
  userId: string | null;
  /** Unidades onde o Risartano está INATIVO (status por unidade — H4.1). */
  inactiveUnitIds: string[];
  /** Especialidades do profissional (H4.5 Lote 3) — alimentam a sugestão de
   * profissional por sessão. */
  specialties: string[];
};

/** Resumo do acesso (login) vinculado, exibido na tela Risartanos. */
export type StaffAccess = {
  userId: string;
  /** E-mail do login (null quando o RLS não deixa o visitante ler o perfil). */
  email: string | null;
  loginActive: boolean;
  /** Funções por clínica, já com rótulo pt-BR ("Recepcionista · Cambé"). */
  rolesText: string;
  /** Unidades e cargos do Risartano (o cargo vem do acesso — H4.1). */
  units: { clinicId: string; clinicName: string; roleLabel: string }[];
  /** Ids das unidades onde o login tem papel (para checar gestão multi-unidade). */
  unitClinicIds: string[];
};

/** Nome de exibição: prefere "como quer ser chamado", cai para o nome completo. */
export function staffDisplayName(s: {
  preferredName: string | null;
  fullName: string;
}): string {
  return s.preferredName?.trim() || s.fullName;
}
