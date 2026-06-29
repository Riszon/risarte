// Tipos e utilitários das fichas de anamnese configuráveis.
// Identificadores em inglês; rótulos em pt-BR. O preenchimento por cliente
// (respostas + alertas) entra na A3; aqui ficam os tipos do modelo e do builder.

export type QuestionKind =
  | "yes_no"
  | "yes_no_unknown"
  | "single_choice"
  | "multi_choice"
  | "short_text"
  | "long_text";

export const QUESTION_KINDS: QuestionKind[] = [
  "yes_no",
  "yes_no_unknown",
  "single_choice",
  "multi_choice",
  "short_text",
  "long_text",
];

export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  yes_no: "Sim / Não",
  yes_no_unknown: "Sim / Não / Não sei",
  single_choice: "Escolha única",
  multi_choice: "Marcar várias (lista)",
  short_text: "Texto curto",
  long_text: "Texto longo",
};

/** A pergunta tem caixa de detalhe ao marcar "Sim"? (yes_no / yes_no_unknown) */
export function kindSupportsDetail(kind: QuestionKind): boolean {
  return kind === "yes_no" || kind === "yes_no_unknown";
}

/** A pergunta usa lista de opções? (single_choice / multi_choice) */
export function kindUsesOptions(kind: QuestionKind): boolean {
  return kind === "single_choice" || kind === "multi_choice";
}

export const YES_NO_OPTIONS = [
  { value: "sim", label: "Sim" },
  { value: "nao", label: "Não" },
] as const;

export const YES_NO_UNKNOWN_OPTIONS = [
  { value: "sim", label: "Sim" },
  { value: "nao", label: "Não" },
  { value: "nao_sei", label: "Não sei" },
] as const;

export type AnamnesisQuestion = {
  id: string;
  templateId: string;
  clinicId: string | null; // null = pergunta da rede; preenchido = da unidade
  section: string | null;
  label: string;
  kind: QuestionKind;
  options: string[] | null;
  detailPrompt: string | null;
  required: boolean;
  sortOrder: number;
  alertWhen: AlertWhen | null;
  alertMessage: string | null;
};

export type AnamnesisTemplate = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
};

export type AnamnesisQuestionRow = {
  id: string;
  template_id: string;
  clinic_id: string | null;
  section: string | null;
  label: string;
  kind: QuestionKind;
  options: string[] | null;
  detail_prompt: string | null;
  required: boolean;
  sort_order: number;
  alert_when: AlertWhen | null;
  alert_message: string | null;
};

export type AnamnesisTemplateRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
};

export function mapQuestion(r: AnamnesisQuestionRow): AnamnesisQuestion {
  return {
    id: r.id,
    templateId: r.template_id,
    clinicId: r.clinic_id,
    section: r.section,
    label: r.label,
    kind: r.kind,
    options: r.options,
    detailPrompt: r.detail_prompt,
    required: r.required,
    sortOrder: r.sort_order,
    alertWhen: r.alert_when,
    alertMessage: r.alert_message,
  };
}

export function mapTemplate(r: AnamnesisTemplateRow): AnamnesisTemplate {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    isActive: r.is_active,
    isDefault: r.is_default,
    sortOrder: r.sort_order,
  };
}

// --- Alertas -------------------------------------------------------------
// Como uma resposta dispara o alerta do prontuário. Avaliado na A3.
export type AlertWhen =
  | { equals: string } // resposta de sim/não/escolha igual a este valor
  | { any_of: string[] }; // multi_choice: alerta se marcar qualquer um destes

/** Agrupa perguntas por seção, preservando a ordem. */
export function groupBySection(
  questions: AnamnesisQuestion[]
): { section: string; questions: AnamnesisQuestion[] }[] {
  const groups: { section: string; questions: AnamnesisQuestion[] }[] = [];
  for (const q of questions) {
    const name = q.section?.trim() || "Geral";
    let g = groups.find((x) => x.section === name);
    if (!g) {
      g = { section: name, questions: [] };
      groups.push(g);
    }
    g.questions.push(q);
  }
  return groups;
}

// --- Respostas (preenchimento — A3) -------------------------------------
export type AnswerValue = string | string[] | null;

export type FilledAnswer = {
  id: string;
  questionId: string | null;
  section: string | null;
  label: string;
  kind: QuestionKind;
  value: AnswerValue;
  detail: string | null;
  isAdhoc: boolean;
  sortOrder: number;
  alertWhen: AlertWhen | null;
  alertMessage: string | null;
};

export type AnamnesisAnswerRow = {
  id: string;
  question_id: string | null;
  section: string | null;
  label: string;
  kind: QuestionKind;
  value: AnswerValue;
  detail: string | null;
  is_adhoc: boolean;
  sort_order: number;
  alert_when: AlertWhen | null;
  alert_message: string | null;
};

export function mapAnswer(r: AnamnesisAnswerRow): FilledAnswer {
  return {
    id: r.id,
    questionId: r.question_id,
    section: r.section,
    label: r.label,
    kind: r.kind,
    value: r.value,
    detail: r.detail,
    isAdhoc: r.is_adhoc,
    sortOrder: r.sort_order,
    alertWhen: r.alert_when,
    alertMessage: r.alert_message,
  };
}

const YES_NO_LABEL: Record<string, string> = {
  sim: "Sim",
  nao: "Não",
  nao_sei: "Não sei",
};

/** Resposta legível para exibição na ficha. */
export function formatAnswer(value: AnswerValue, kind: QuestionKind): string {
  if (value == null || (Array.isArray(value) && value.length === 0)) return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (kind === "yes_no" || kind === "yes_no_unknown") {
    return YES_NO_LABEL[value] ?? value;
  }
  return value;
}

/** Uma resposta dispara o alerta configurado? */
export function isAnswerAlerting(
  value: AnswerValue,
  when: AlertWhen | null
): boolean {
  if (!when) return false;
  if ("equals" in when) {
    return value === when.equals;
  }
  if ("any_of" in when) {
    return Array.isArray(value) && value.some((v) => when.any_of.includes(v));
  }
  return false;
}

/** Lista os alertas disparados pelas respostas (mensagem + pergunta). */
export function evaluateAlerts(
  answers: FilledAnswer[]
): { label: string; message: string }[] {
  const out: { label: string; message: string }[] = [];
  for (const a of answers) {
    if (a.alertMessage && isAnswerAlerting(a.value, a.alertWhen)) {
      out.push({ label: a.label, message: a.alertMessage });
    }
  }
  return out;
}
