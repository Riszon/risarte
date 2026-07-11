// Módulo Risarte Empresarial — tipos do domínio (camelCase no app; as colunas do
// banco são snake_case). Dinheiro em centavos inteiros.
import type {
  BillingStatus,
  BillingType,
  CompanyStatus,
  DependentPlan,
  EmployeeStatus,
  LeadStage,
  PaymentMethod,
  PaymentModel,
  RegistrationStage,
  Relationship,
} from "./constants";

export type CompanyAddress = {
  zipCode?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
};

export type Company = {
  id: string;
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  stateRegistration: string | null;
  address: CompanyAddress | null;
  employeeCount: number | null;
  status: CompanyStatus;
  paymentModel: PaymentModel;
  companySubsidyType: "PERCENT" | "AMOUNT" | null;
  companySubsidyValue: number | null; // % (base 100) ou centavos
  dueDay: number;
  assignedConsultantId: string | null;
  paymentMethods: PaymentMethod[];
  defaultMaxInstallments: number;
  contractStartedAt: string | null;
  gracePeriodDays: number;
  employeeGracePeriodDays: number;
  notes: string | null;
  createdAt: string;
};

export type Employee = {
  id: string;
  companyId: string;
  clientId: string | null;
  clinicId: string | null;
  cpf: string;
  fullName: string;
  phone: string;
  email: string | null;
  status: EmployeeStatus;
  registrationStage: RegistrationStage;
  dependentPlan: DependentPlan;
  gracePeriodDays: number | null;
  joinedAt: string;
  leftAt: string | null;
  leftReason: string | null;
};

export type Dependent = {
  id: string;
  employeeId: string;
  clientId: string | null;
  clinicId: string | null;
  cpf: string;
  fullName: string | null;
  phone: string | null;
  relationship: Relationship;
  status: EmployeeStatus;
};

export type AdhesionBilling = {
  id: string;
  companyId: string;
  billingType: BillingType;
  referenceMonth: string | null;
  totalAmountCents: number;
  status: BillingStatus;
  dueDate: string | null;
  paidAt: string | null;
  splitRisarteCents: number | null;
  splitRislifeCents: number | null;
};

export type CommercialLead = {
  id: string;
  companyName: string;
  cnpj: string | null;
  contactName: string | null;
  contactPhone: string | null;
  stage: LeadStage;
  consultantId: string | null;
  lostReason: string | null;
  companyId: string | null;
  createdAt: string;
  updatedAt: string;
};
