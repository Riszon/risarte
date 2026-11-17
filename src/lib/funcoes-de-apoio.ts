// FUNÇÕES DE APOIO (plano aprovado em 16/11/2026, D1–D15:
// docs/equipe/FUNCOES-DE-APOIO-PLANO.md). Puro e testado: nada de banco, nada
// de React. A regra de verdade mora no banco (0414: `grant_role_coverage`,
// `_support_role_guard`); aqui fica o que a tela precisa para OFERECER só o que
// o banco aceitaria e para DIZER, na voz de quem opera, o que ele recusou.

import { ROLE_LABELS, rolesForClinicType, type ClinicType, type UserRole } from "@/lib/roles";
import { formatAnyDateBr } from "@/lib/dates";

export const TIPOS_DE_COBERTURA = ["temporaria", "fixa"] as const;
export type TipoDeCobertura = (typeof TIPOS_DE_COBERTURA)[number];

export const ROTULO_DO_TIPO: Record<TipoDeCobertura, string> = {
  temporaria: "Cobertura temporária",
  fixa: "Acúmulo fixo",
};

export const AJUDA_DO_TIPO: Record<TipoDeCobertura, string> = {
  temporaria:
    "Com início e fim (até 90 dias, contando as emendas). Libera o sistema real da função pelo período, sem missão.",
  fixa:
    "Sem data de fim, para a unidade que não tem quem faça a função. Passa pelo portão (missão) e é revisto a cada 90 dias.",
};

/** D15: motivo em lista fechada, mais o texto livre. */
export const MOTIVOS_DE_COBERTURA = [
  "ferias",
  "licenca",
  "falta",
  "desligamento",
  "sem_funcao",
  "outro",
] as const;
export type MotivoDeCobertura = (typeof MOTIVOS_DE_COBERTURA)[number];

export const ROTULO_DO_MOTIVO_DE_COBERTURA: Record<MotivoDeCobertura, string> = {
  ferias: "Férias",
  licenca: "Licença",
  falta: "Falta",
  desligamento: "Desligamento (vaga aberta)",
  sem_funcao: "Unidade sem a função",
  outro: "Outro",
};

export const ehTipoDeCobertura = (v: string): v is TipoDeCobertura =>
  (TIPOS_DE_COBERTURA as readonly string[]).includes(v);
export const ehMotivoDeCobertura = (v: string): v is MotivoDeCobertura =>
  (MOTIVOS_DE_COBERTURA as readonly string[]).includes(v);

/** D3: no máximo duas funções de apoio por pessoa, por unidade. */
export const MAXIMO_DE_APOIO = 2;

/** D4: espelho de `role_incompatibilities` (0414). */
export const COMBINACOES_PROIBIDAS: readonly (readonly [UserRole, UserRole])[] = [
  ["finance_franchisor", "purchaser"],
];

function proibida(a: UserRole, b: UserRole): boolean {
  return COMBINACOES_PROIBIDAS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/**
 * As funções que dá para OFERECER como apoio numa unidade: as do tipo da
 * unidade, menos as que a pessoa já tem (ou tem agendadas) lá e menos as
 * combinações proibidas. Vazio quando já há o máximo de apoio.
 */
export function funcoesDeApoioPossiveis(entrada: {
  tipoDaUnidade: ClinicType;
  /** Todas as funções da pessoa na unidade (principal + apoio), e as agendadas. */
  jaTem: readonly UserRole[];
  apoiosNaUnidade: number;
}): UserRole[] {
  if (entrada.apoiosNaUnidade >= MAXIMO_DE_APOIO) return [];
  return rolesForClinicType(entrada.tipoDaUnidade).filter(
    (r) => !entrada.jaTem.includes(r) && !entrada.jaTem.some((t) => proibida(t, r))
  );
}

/** O que o banco recusou, dito para quem opera (`grant_role_coverage`). */
export function recusaDaCobertura(mensagem: string): string {
  const m = mensagem ?? "";
  if (m.includes("NOT_ALLOWED")) return "Só o Admin Master dá função de apoio.";
  if (m.includes("REASON_REQUIRED")) return "Escreva o motivo.";
  if (m.includes("START_IN_THE_PAST")) return "A cobertura não pode começar antes de hoje.";
  if (m.includes("END_REQUIRED")) return "A cobertura temporária precisa da data de fim (depois do início).";
  if (m.includes("HIRING_FORECAST_REQUIRED"))
    return "Para \"Desligamento (vaga aberta)\", informe a previsão de contratação.";
  if (m.includes("PERSON_INACTIVE")) return "Esta pessoa está desativada.";
  if (m.includes("NO_PRINCIPAL_ROLE"))
    return "A pessoa precisa ter uma função principal nesta unidade para receber uma de apoio.";
  if (m.includes("ALREADY_HAS_ROLE")) return "A pessoa já tem (ou vai ter) esta função nesta unidade.";
  if (m.includes("TEMPORARY_TOO_LONG"))
    return "A cobertura temporária passa de 90 dias (contando as emendadas). Para mais tempo, use Acúmulo fixo.";
  if (m.includes("TOO_MANY_SUPPORT_ROLES"))
    return "A pessoa já tem duas funções de apoio nesta unidade (o máximo).";
  if (m.includes("ROLE_COMBINATION_NOT_ALLOWED"))
    return "Esta combinação de funções não é permitida (quem compra não é quem paga).";
  if (m.includes("UNIT_COVERAGE_LIMIT"))
    return "A unidade já está no limite de coberturas ao mesmo tempo.";
  if (m.includes("UNIT_TEAM_PERCENT_LIMIT"))
    return "A unidade já está no limite de pessoas da equipe em acúmulo.";
  if (m.includes("NOT_ACTIVE")) return "Esta cobertura não está ativa.";
  if (m.includes("NOT_SCHEDULED")) return "Esta cobertura não está agendada.";
  if (m.includes("NOT_REVIEWABLE")) return "Só o acúmulo fixo em andamento é revisado.";
  if (m.includes("grant_role_coverage") || m.includes("PGRST202"))
    return "Este banco ainda não recebeu a atualização das funções de apoio (0414).";
  return "Não foi possível agora. Nada foi alterado.";
}

export type CoberturaNaTela = {
  id: string;
  code: string | null;
  clinicId: string;
  clinicName: string;
  role: UserRole;
  kind: TipoDeCobertura;
  startsOn: string;
  endsOn: string | null;
  reasonCategory: MotivoDeCobertura;
  reason: string;
  status: "agendada" | "ativa";
  reviewDueOn: string | null;
  hiringForecast: string | null;
};

/** "Recepção · até 29/11/2026 · Férias" — a linha da cobertura na ficha. */
export function textoDaCobertura(c: CoberturaNaTela): string {
  const quando =
    c.kind === "fixa"
      ? "acúmulo fixo"
      : c.status === "agendada"
        ? `de ${formatAnyDateBr(c.startsOn)} a ${formatAnyDateBr(c.endsOn ?? c.startsOn)}`
        : `até ${formatAnyDateBr(c.endsOn ?? c.startsOn)}`;
  return `${ROLE_LABELS[c.role] ?? c.role} · ${quando} · ${ROTULO_DO_MOTIVO_DE_COBERTURA[c.reasonCategory] ?? c.reasonCategory}`;
}

/** D14: a revisão do acúmulo fixo venceu? */
export function revisaoVencida(c: CoberturaNaTela, hoje: string): boolean {
  return c.kind === "fixa" && !!c.reviewDueOn && c.reviewDueOn < hoje;
}

/** Lê as coberturas do banco — sem confiar no formato. */
export function lerCoberturas(
  linhas: readonly Record<string, unknown>[],
  nomeDaUnidade: (id: string) => string
): CoberturaNaTela[] {
  const out: CoberturaNaTela[] = [];
  for (const r of linhas) {
    const kind = String(r.kind ?? "");
    const cat = String(r.reason_category ?? "");
    const status = String(r.status ?? "");
    if (!ehTipoDeCobertura(kind) || !ehMotivoDeCobertura(cat)) continue;
    if (status !== "agendada" && status !== "ativa") continue;
    out.push({
      id: String(r.id),
      code: r.code ? String(r.code) : null,
      clinicId: String(r.clinic_id),
      clinicName: nomeDaUnidade(String(r.clinic_id)),
      role: r.role as UserRole,
      kind,
      startsOn: String(r.starts_on),
      endsOn: r.ends_on ? String(r.ends_on) : null,
      reasonCategory: cat,
      reason: String(r.reason ?? ""),
      status,
      reviewDueOn: r.review_due_on ? String(r.review_due_on) : null,
      hiringForecast: r.hiring_forecast ? String(r.hiring_forecast) : null,
    });
  }
  return out;
}

/** Para o Início e o menu: "Você está cobrindo Recepção em Cambé até 29/11". */
export function fraseDeCobertura(entrada: {
  role: UserRole;
  unidade: string;
  endsAt: string | null;
}): string {
  const funcao = ROLE_LABELS[entrada.role] ?? entrada.role;
  if (!entrada.endsAt) return `Você também faz ${funcao} em ${entrada.unidade} (acúmulo fixo).`;
  // `ends_at` é a meia-noite SEGUINTE ao último dia (0414): o último dia é o anterior.
  const fim = new Date(new Date(entrada.endsAt).getTime() - 1);
  return `Você está cobrindo ${funcao} em ${entrada.unidade} até ${formatAnyDateBr(fim.toISOString())}.`;
}
