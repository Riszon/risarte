// Módulo Risarte Empresarial — enums do banco (inglês) ↔ rótulos pt-BR.
// Espelha os CHECKs das tabelas em supabase/migrations/0097_empresarial_schema.sql.
// Dinheiro sempre em CENTAVOS inteiros.

export const COMPANY_STATUSES = ["ACTIVE", "SUSPENDED", "TERMINATED"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];
export const COMPANY_STATUS_LABELS: Record<CompanyStatus, string> = {
  ACTIVE: "Ativa",
  SUSPENDED: "Suspensa",
  TERMINATED: "Encerrada",
};

export const PAYMENT_MODELS = [
  "COMPANY_PAYS",
  "COMPANY_PARTIAL",
  "EMPLOYEE_PAYS",
] as const;
export type PaymentModel = (typeof PAYMENT_MODELS)[number];
export const PAYMENT_MODEL_LABELS: Record<PaymentModel, string> = {
  COMPANY_PAYS: "Empresa paga integral",
  COMPANY_PARTIAL: "Empresa paga parcial",
  EMPLOYEE_PAYS: "Colaborador paga",
};

export const PAYMENT_METHODS = ["BOLETO", "PIX", "CARD"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  BOLETO: "Boleto",
  PIX: "Pix",
  CARD: "Cartão",
};

export const DEPENDENT_PLANS = [
  "NONE",
  "INDIVIDUAL",
  "FAMILY",
  "FAMILY_EXTRA",
] as const;
export type DependentPlan = (typeof DEPENDENT_PLANS)[number];
export const DEPENDENT_PLAN_LABELS: Record<DependentPlan, string> = {
  NONE: "Sem dependentes",
  INDIVIDUAL: "Dependente individual",
  FAMILY: "Dependente familiar",
  FAMILY_EXTRA: "Familiar + extras",
};

export const EMPLOYEE_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
};

export const REGISTRATION_STAGES = ["PRE_REGISTERED", "COMPLETED"] as const;
export type RegistrationStage = (typeof REGISTRATION_STAGES)[number];
export const REGISTRATION_STAGE_LABELS: Record<RegistrationStage, string> = {
  PRE_REGISTERED: "Pré-cadastrado",
  COMPLETED: "Cadastro completo",
};

export const LEFT_REASONS = [
  "RESIGNED",
  "DISMISSED",
  "COMPANY_TERMINATED",
  "VOLUNTARY",
] as const;
export type LeftReason = (typeof LEFT_REASONS)[number];
export const LEFT_REASON_LABELS: Record<LeftReason, string> = {
  RESIGNED: "Pedido de demissão",
  DISMISSED: "Desligamento",
  COMPANY_TERMINATED: "Fim da parceria",
  VOLUNTARY: "Saída voluntária",
};

export const RELATIONSHIPS = ["SPOUSE", "CHILD", "PARENT", "OTHER"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];
export const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  SPOUSE: "Cônjuge",
  CHILD: "Filho(a)",
  PARENT: "Pai/Mãe",
  OTHER: "Outro",
};

export const BENEFIT_TYPES = [
  "DISCOUNT_PERCENT",
  "DISCOUNT_AMOUNT",
  "FREE",
  "NOT_COVERED",
] as const;
export type BenefitType = (typeof BENEFIT_TYPES)[number];
export const BENEFIT_TYPE_LABELS: Record<BenefitType, string> = {
  DISCOUNT_PERCENT: "Desconto (%)",
  DISCOUNT_AMOUNT: "Desconto (R$)",
  FREE: "Sem custo",
  NOT_COVERED: "Não coberto",
};

export const BILLING_TYPES = ["IMPLANTATION", "MONTHLY"] as const;
export type BillingType = (typeof BILLING_TYPES)[number];
export const BILLING_TYPE_LABELS: Record<BillingType, string> = {
  IMPLANTATION: "Implantação (1º pagamento)",
  MONTHLY: "Mensalidade",
};

export const BILLING_STATUSES = ["PENDING", "PAID", "OVERDUE"] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];
export const BILLING_STATUS_LABELS: Record<BillingStatus, string> = {
  PENDING: "Pendente",
  PAID: "Pago",
  OVERDUE: "Em atraso",
};

export const LEAD_STAGES = [
  "CAPTURE",
  "CONTACT",
  "MEETING_SCHEDULED",
  "PRESENTED",
  "PROPOSAL_SENT",
  "FOLLOW_UP",
  "CLOSED_WON",
  "CLOSED_LOST",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  CAPTURE: "Captação",
  CONTACT: "Contato",
  MEETING_SCHEDULED: "Reunião agendada",
  PRESENTED: "Apresentado",
  PROPOSAL_SENT: "Proposta enviada",
  FOLLOW_UP: "Follow-up",
  CLOSED_WON: "Fechado (ganho)",
  CLOSED_LOST: "Perdido",
};

export const SOCIAL_TRIGGER_TYPES = [
  "EMPLOYEE_COUNT",
  "TIME_IN_PROGRAM",
  "ATTENDANCE",
  "TREATMENT_SPEND",
] as const;
export type SocialTriggerType = (typeof SOCIAL_TRIGGER_TYPES)[number];
export const SOCIAL_TRIGGER_LABELS: Record<SocialTriggerType, string> = {
  EMPLOYEE_COUNT: "Quantidade de colaboradores",
  TIME_IN_PROGRAM: "Tempo no programa",
  ATTENDANCE: "Comparecimento",
  TREATMENT_SPEND: "Gasto em tratamento",
};
