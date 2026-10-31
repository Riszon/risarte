/**
 * Os tipos da API da ZapSign que o riSZon usa (docs.zapsign.com.br, lidos em
 * 31/10/2026 — plano ZS0 §3). Só o que o módulo precisa; campo que a
 * documentação não explica (`signed_file_only_finished`) fica de fora.
 */

/** Como o signatário prova quem é. */
export type ZapsignAuthMode =
  | "assinaturaTela"
  | "tokenEmail"
  | "assinaturaTela-tokenEmail"
  | "tokenSms"
  | "assinaturaTela-tokenSms"
  | "tokenWhatsapp"
  | "assinaturaTela-tokenWhatsapp"
  | "certificadoDigital";

export type ZapsignDocStatus = "pending" | "signed" | "refused";
export type ZapsignSignerStatus = "new" | "link-opened" | "signed";

export type ZapsignSignerInput = {
  name: string;
  email?: string;
  /** Código do país sem o "+" ("55"). */
  phone_country?: string;
  /** DDD + número, só dígitos. */
  phone_number?: string;
  auth_mode?: ZapsignAuthMode;
  /** 1, 2, 3… — o grupo seguinte é liberado quando o anterior conclui. */
  order_group?: number;
  /** "Testemunha", "Representante da Risarte", "Responsável legal"… */
  qualification?: string;
  external_id?: string;
  cpf?: string;
  require_cpf?: boolean;
  validate_cpf?: boolean;
  require_selfie_photo?: boolean;
  require_document_photo?: boolean;
  selfie_validation_type?: "liveness-document-match" | "liveness-NA" | "identity-NA";
  send_automatic_email?: boolean;
  send_automatic_whatsapp?: boolean;
  send_automatic_whatsapp_signed_file?: boolean;
  lock_name?: boolean;
  lock_email?: boolean;
  lock_phone?: boolean;
  lock_cpf?: boolean;
  redirect_link?: string;
};

export type ZapsignCreateDocInput = {
  name: string;
  /** PDF em base64 (≤ 10 MB) — OU `url_pdf`. */
  base64_pdf?: string;
  url_pdf?: string;
  /** O id do pacote no riSZon: volta no webhook. */
  external_id?: string;
  folder_path?: string;
  lang?: "pt-br" | "en" | "es";
  /** `true` = a ZapSign não manda e-mail aos signatários (o riSZon manda o link). */
  disable_signer_emails?: boolean;
  /** Data limite, ISO 8601. */
  date_limit_to_sign?: string;
  /** Liga a ordem por `order_group`. */
  signature_order_active?: boolean;
  reminder_every_n_days?: number;
  allow_refuse_signature?: boolean;
  observers?: string[];
  metadata?: { key: string; value: string }[];
  signers: ZapsignSignerInput[];
  /** `true` só no ambiente de teste da conta. */
  sandbox?: boolean;
};

export type ZapsignSigner = {
  token: string;
  name?: string;
  email?: string;
  phone_country?: string;
  phone_number?: string;
  status?: ZapsignSignerStatus;
  sign_url?: string;
  signed_at?: string | null;
  auth_mode?: ZapsignAuthMode | string;
  order_group?: number | null;
  qualification?: string;
  external_id?: string | null;
  times_viewed?: number;
  last_view_at?: string | null;
};

export type ZapsignDocument = {
  token: string;
  open_id?: number;
  external_id?: string | null;
  name?: string;
  status?: ZapsignDocStatus | string;
  /** URLs que EXPIRAM em 60 minutos. */
  original_file?: string | null;
  signed_file?: string | null;
  created_at?: string;
  last_update_at?: string;
  sandbox?: boolean;
  signers?: ZapsignSigner[];
  folder_path?: string;
  date_limit_to_sign?: string | null;
  signature_order_active?: boolean;
};

export type ZapsignDocListItem = Pick<
  ZapsignDocument,
  "token" | "open_id" | "external_id" | "name" | "status" | "created_at" | "last_update_at" | "sandbox"
>;

export type ZapsignDocList = {
  count: number;
  next?: string | null;
  previous?: string | null;
  results: ZapsignDocListItem[];
};

export type ZapsignListDocsQuery = {
  /** ISO 8601 (`2026-10-01T00:00:00`). */
  created_from?: string;
  created_to?: string;
  status?: ZapsignDocStatus;
  page?: number;
  sort_order?: "asc" | "desc";
};

/** Uma marca de assinatura ou rubrica NUMA página (uma por página por signatário). */
export type ZapsignRubrica = {
  /** 0 = primeira página. */
  page: number;
  /** 0–100, origem no canto inferior esquerdo. */
  relative_position_left: number;
  relative_position_bottom: number;
  relative_size_x: number;
  relative_size_y: number;
  type: "signature" | "visto";
  signer_token: string;
};

export type ZapsignUpdateSignerInput = Partial<
  Pick<
    ZapsignSignerInput,
    | "name"
    | "email"
    | "phone_country"
    | "phone_number"
    | "auth_mode"
    | "order_group"
    | "qualification"
    | "external_id"
    | "require_selfie_photo"
    | "require_document_photo"
    | "redirect_link"
    | "send_automatic_email"
    | "send_automatic_whatsapp"
  >
>;

export type ZapsignRefuseInput = {
  doc_token: string;
  rejected_reason: string;
  notify_signer?: boolean;
};

export type ZapsignPlanInfo = {
  name?: string;
  number_of_credits?: number;
  status?: string;
  period?: string;
  current_period_end?: string;
  [extra: string]: unknown;
};

/**
 * Assinar em lote via API (add-on pago; desligado — decisão do dono em
 * 31/10/2026, plano §4.2). Fica tipado para ligar depois como configuração.
 */
export type ZapsignSignInBatchInput = {
  user_token: string;
  signer_tokens: string[];
  /** Só com `assinaturaTela`; selfie opcional. */
  selfie_photo?: string;
};

export type ZapsignWebhookEventType =
  | "doc_created"
  | "doc_signed"
  | "doc_refused"
  | "doc_deleted"
  | "doc_viewed"
  | "doc_read_confirmation"
  | "signature_notification_sent"
  | "email_bounce"
  | "signer_authentication_failed"
  | "doc_expired"
  | "doc_expiration_alert";

/** O corpo que a ZapSign manda ao webhook (o que nos interessa dele). */
export type ZapsignWebhookPayload = {
  event_type?: string;
  token?: string;
  open_id?: number;
  external_id?: string | null;
  status?: string;
  name?: string;
  signed_file?: string | null;
  original_file?: string | null;
  sandbox?: boolean;
  created_at?: string;
  last_update_at?: string;
  rejected_reason?: string | null;
  signer_who_signed?: ZapsignSigner | null;
  signers?: ZapsignSigner[];
  [extra: string]: unknown;
};
