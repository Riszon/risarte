/**
 * Os tipos do módulo de assinatura digital (ZS2). Espelham as tabelas
 * `signature_*` da 0340 e o que as regras puras trocam entre si. Sem lógica.
 */

export type SignatureAudience = "patient" | "company";

export type TemplateKind = "contract" | "consent" | "budget" | "image_release" | "adhesion" | "other";

export type TemplateAuthLevel = "simple" | "strong" | "by_amount";

export type AuthLevel = "simple" | "strong";

export type WitnessMode = "fixed" | "choose_at_send";

export type RisarteSignerMode = "role" | "sender" | "user" | "none";

/** O texto de um modelo, na forma em que é guardado e editado. */
export type TemplateSection = { title: string; body: string };
export type TemplateBody = { preamble: string; sections: TemplateSection[]; closing: string };

export type SignatureTemplate = {
  id: string;
  code: string;
  name: string;
  audience: SignatureAudience;
  kind: TemplateKind;
  body: TemplateBody | null;
  source: "empresarial_contract_templates" | null;
  variables: string[];
  auth_level: TemplateAuthLevel;
  witness_count: number;
  witness_mode: WitnessMode;
  default_witness_staff_ids: string[];
  risarte_signer_mode: RisarteSignerMode;
  risarte_signer_role: string | null;
  risarte_signer_user_id: string | null;
  is_active: boolean;
  is_provisional_text: boolean;
  sort_order: number;
};

export type SignatureKit = {
  id: string;
  name: string;
  audience: SignatureAudience;
  is_active: boolean;
  sort_order: number;
  template_ids: string[];
};

export type SignerType =
  | "client"
  | "legal_guardian"
  | "company_representative"
  | "witness"
  | "risarte_representative"
  | "other";

/** 1 = o cliente e o lado dele; 2 = testemunhas; 3 = a Risarte. */
export type OrderGroup = 1 | 2 | 3;

/** Um signatário montado para o envio (ainda sem token da ZapSign). */
export type SignerDraft = {
  sort_order: number;
  order_group: OrderGroup;
  signer_type: SignerType;
  name: string;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  user_id: string | null;
  staff_member_id: string | null;
  qualification: string;
};

export type PackageStatus =
  | "draft"
  | "sent"
  | "partially_signed"
  | "signed"
  | "refused"
  | "expired"
  | "cancelled";

export type PackageStage = "client" | "witnesses" | "risarte" | "done";

export type SignerStatus = "pending" | "link_opened" | "signed" | "refused";

export type PackageOriginType =
  | "client"
  | "plan_negotiation"
  | "treatment_plan"
  | "company"
  | "company_document"
  | "commercial_lead";

/** Uma pessoa do sistema que pode assinar pela Risarte ou como testemunha. */
export type StaffSignerOption = {
  /** Chave estável na janela: "staff:<id>" ou "user:<id>". */
  key: string;
  staff_member_id: string | null;
  user_id: string | null;
  name: string;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  role_label: string;
};
