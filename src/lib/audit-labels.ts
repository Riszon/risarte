// Rótulos pt-BR para a tela de Auditoria (H4.1 Lote 3). A trilha `audit_logs`
// guarda ação e tipo de registro como códigos em inglês; aqui viram texto.

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  login: "Entrou no sistema",
  logout: "Saiu do sistema",
  create: "Cadastrou",
  update: "Alterou",
  view: "Consultou",
  delete: "Excluiu",
  anonymize: "Anonimizou",
  export: "Exportou",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

/** Ações oferecidas no filtro (as mais comuns). */
export const AUDIT_ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: "login", label: "Entrou no sistema" },
  { value: "create", label: "Cadastrou" },
  { value: "update", label: "Alterou" },
  { value: "view", label: "Consultou" },
  { value: "export", label: "Exportou" },
  { value: "anonymize", label: "Anonimizou" },
];

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  session: "Acesso",
  client: "Cliente",
  treatment_plan: "Plano de tratamento",
  plan_option: "Opção do plano",
  appointment: "Agendamento",
  staff_member: "Risartano",
  user: "Usuário",
  user_clinic_roles: "Acesso (função)",
  procedure: "Procedimento",
  clinic: "Clínica",
  client_share: "Compartilhamento",
  consent: "Consentimento",
  clinical_media: "Mídia clínica",
  anamnesis: "Anamnese",
  treatment_session: "Sessão de tratamento",
};

export function auditEntityLabel(entityType: string): string {
  return AUDIT_ENTITY_LABELS[entityType] ?? entityType;
}

/** Tipos de registro oferecidos no filtro. */
export const AUDIT_ENTITY_OPTIONS: { value: string; label: string }[] = [
  { value: "client", label: "Cliente" },
  { value: "treatment_plan", label: "Plano de tratamento" },
  { value: "appointment", label: "Agendamento" },
  { value: "staff_member", label: "Risartano" },
  { value: "user", label: "Usuário" },
  { value: "procedure", label: "Procedimento" },
  { value: "session", label: "Acesso" },
];
