// FUNÇÕES DE APOIO, F4 — o painel "Equipe e coberturas" (plano aprovado em
// 16/11/2026, docs/equipe/FUNCOES-DE-APOIO-PLANO.md, seção 10). Puro e testado:
// os números vêm do banco (0419: `coverage_panel_units`/`coverage_panel_people`,
// as MESMAS contas que a rotina usa para avisar); aqui só se lê, colore, diz em
// uma frase e ordena.
//
// ⚠️ Os limiares abaixo são os mesmos da rotina de avisos da 0419
// (`_coverage_network_notices`). Mudou um, muda o outro (a régua confere).

import { ROLE_LABELS, type UserRole } from "@/lib/roles";
import { formatAnyDateBr } from "@/lib/dates";
import type { Farol } from "@/lib/finance/network-areas";
import { ROTULO_DO_MOTIVO_DE_COBERTURA, ehMotivoDeCobertura } from "@/lib/funcoes-de-apoio";

/** 10.3: função feita só por apoio há mais de N dias. */
export const SEM_TITULAR_ALERTA_DIAS = 30;
/** 10.3: temporárias emendadas passando de N dias contínuos. */
export const EMENDA_ALERTA_DIAS = 60;
/** D14: revisão vencida há mais de N dias fica vermelha. */
export const REVISAO_VERMELHA_DIAS = 15;
/** 10.3: tempo ativo na cobertura N% acima do de antes. */
export const SOBRECARGA_PERCENTUAL = 30;
/** 10.3: acesso fora do horário em N dias ou mais no período. */
export const FORA_DO_HORARIO_DIAS = 5;
/** Precisa de alguns dias de cobertura para comparar o tempo. */
export const DIAS_MINIMOS_PARA_COMPARAR = 5;

export type FuncaoSemTitular = { role: UserRole; since: string; days: number };
export type DiasPorFuncao = { role: UserRole; days: number };

export type UnidadeDeCobertura = {
  clinicId: string;
  nome: string;
  equipe: number;
  pessoasEmApoio: number;
  ativas: number;
  agendadas: number;
  diasPessoa: number;
  diasDoPeriodo: number;
  semTitular: FuncaoSemTitular[];
  diasPorFuncao: DiasPorFuncao[];
  maiorEmenda: number;
  emendasAcima: number;
  revisoesVencidas: number;
  maiorAtrasoDeRevisao: number;
  previsoesVencidas: number;
  motivos: Record<string, number>;
  maxSimultaneas: number;
  maxPercentualEquipe: number;
  limitesTravam: boolean;
};

export type PessoaEmCobertura = {
  clinicId: string;
  userId: string;
  nome: string;
  funcoes: UserRole[];
  desde: string;
  apoiosAgora: number;
  antesSegundos: number | null;
  duranteSegundos: number | null;
  diasDurante: number;
  diasForaDoHorario: number;
};

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numOuNulo = (v: unknown) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const lista = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

/** Lê o que `coverage_panel_units` devolveu — sem confiar no formato. */
export function lerUnidadesDeCobertura(linhas: readonly Record<string, unknown>[]): UnidadeDeCobertura[] {
  return linhas.map((r) => ({
    clinicId: String(r.clinic_id),
    nome: String(r.clinic_name ?? ""),
    equipe: num(r.team_size),
    pessoasEmApoio: num(r.people_in_support),
    ativas: num(r.active_now),
    agendadas: num(r.scheduled),
    diasPessoa: num(r.person_days),
    diasDoPeriodo: num(r.days_in_period),
    semTitular: lista(r.uncovered_roles).map((x) => ({
      role: String(x.role) as UserRole,
      since: String(x.since ?? ""),
      days: num(x.days),
    })),
    diasPorFuncao: lista(r.role_days).map((x) => ({ role: String(x.role) as UserRole, days: num(x.days) })),
    maiorEmenda: num(r.longest_chain_days),
    emendasAcima: num(r.chains_over_60),
    revisoesVencidas: num(r.fixed_review_overdue),
    maiorAtrasoDeRevisao: num(r.max_review_overdue_days),
    previsoesVencidas: num(r.forecast_overdue),
    motivos:
      r.reasons && typeof r.reasons === "object" && !Array.isArray(r.reasons)
        ? Object.fromEntries(Object.entries(r.reasons as Record<string, unknown>).map(([k, v]) => [k, num(v)]))
        : {},
    maxSimultaneas: num(r.max_simultaneous),
    maxPercentualEquipe: num(r.max_team_percent),
    limitesTravam: r.enforce_limits === true,
  }));
}

/** Lê o que `coverage_panel_people` devolveu. */
export function lerPessoasEmCobertura(linhas: readonly Record<string, unknown>[]): PessoaEmCobertura[] {
  return linhas.map((r) => ({
    clinicId: String(r.clinic_id),
    userId: String(r.user_id),
    nome: String(r.full_name ?? ""),
    funcoes: (Array.isArray(r.roles) ? r.roles : []).map((x) => String(x) as UserRole),
    desde: String(r.first_start ?? ""),
    apoiosAgora: num(r.support_now),
    antesSegundos: numOuNulo(r.before_avg_seconds),
    duranteSegundos: numOuNulo(r.during_avg_seconds),
    diasDurante: num(r.during_days),
    diasForaDoHorario: num(r.after_hours_days),
  }));
}

const rotulo = (r: UserRole) => ROLE_LABELS[r] ?? r;

/** % da equipe com função de apoio (null sem equipe). */
export function percentualEmAcumulo(u: Pick<UnidadeDeCobertura, "equipe" | "pessoasEmApoio">): number | null {
  return u.equipe > 0 ? Math.round((u.pessoasEmApoio * 100) / u.equipe) : null;
}

export function acimaDasSimultaneas(u: UnidadeDeCobertura): boolean {
  return u.ativas > u.maxSimultaneas;
}

export function acimaDoPercentual(u: UnidadeDeCobertura): boolean {
  return u.equipe > 0 && u.pessoasEmApoio * 100 > u.maxPercentualEquipe * u.equipe;
}

/**
 * A cor da unidade e a frase que explica a cor — a mais grave primeiro.
 * Vermelho: vaga crônica, emenda longa, revisão esquecida, limite passado ou
 * previsão de contratação vencida. Amarelo: há cobertura em andamento (ou
 * função sem titular há pouco). Verde: ninguém cobrindo ninguém.
 */
export function farolDaCobertura(u: UnidadeDeCobertura): { farol: Farol; motivo: string } {
  const cronica = u.semTitular.find((s) => s.days > SEM_TITULAR_ALERTA_DIAS);
  if (cronica) {
    return { farol: "vermelho", motivo: `${rotulo(cronica.role)} sem titular há ${cronica.days} dias` };
  }
  if (u.emendasAcima > 0) {
    return { farol: "vermelho", motivo: `Cobertura emendada há ${u.maiorEmenda} dias seguidos` };
  }
  if (u.revisoesVencidas > 0 && u.maiorAtrasoDeRevisao > REVISAO_VERMELHA_DIAS) {
    return { farol: "vermelho", motivo: `Acúmulo fixo sem revisão há ${u.maiorAtrasoDeRevisao} dias` };
  }
  if (acimaDasSimultaneas(u)) {
    return { farol: "vermelho", motivo: `${u.ativas} coberturas ao mesmo tempo (limite ${u.maxSimultaneas})` };
  }
  if (acimaDoPercentual(u)) {
    return {
      farol: "vermelho",
      motivo: `${percentualEmAcumulo(u)}% da equipe em acúmulo (limite ${u.maxPercentualEquipe}%)`,
    };
  }
  if (u.previsoesVencidas > 0) {
    return { farol: "vermelho", motivo: "Previsão de contratação vencida" };
  }
  if (u.revisoesVencidas > 0) {
    return { farol: "amarelo", motivo: "Acúmulo fixo com a revisão vencida" };
  }
  if (u.semTitular.length > 0) {
    const s = u.semTitular[0];
    return { farol: "amarelo", motivo: `${rotulo(s.role)} feita só por apoio há ${s.days} dia(s)` };
  }
  if (u.ativas > 0) {
    return {
      farol: "amarelo",
      motivo: `${u.ativas} cobertura(s) em andamento · ${u.diasPessoa} dia(s)-pessoa no mês`,
    };
  }
  if (u.equipe === 0) return { farol: "sem_dado", motivo: "Sem equipe com função principal" };
  return { farol: "verde", motivo: u.diasPessoa > 0 ? `${u.diasPessoa} dia(s)-pessoa no mês, nada em andamento` : "Ninguém cobrindo" };
}

const PESO: Record<Farol, number> = { vermelho: 0, amarelo: 1, verde: 2, sem_dado: 3 };

/** Comparativo da rede: pela cor, depois pelos dias-pessoa por pessoa da equipe. */
export function porAtencaoDeCobertura(a: UnidadeDeCobertura, b: UnidadeDeCobertura): number {
  const fa = PESO[farolDaCobertura(a).farol];
  const fb = PESO[farolDaCobertura(b).farol];
  if (fa !== fb) return fa - fb;
  const ra = a.equipe > 0 ? a.diasPessoa / a.equipe : 0;
  const rb = b.equipe > 0 ? b.diasPessoa / b.equipe : 0;
  if (ra !== rb) return rb - ra;
  return a.nome.localeCompare(b.nome, "pt-BR");
}

/** "Recepcionista: 22 de 30 dias por cobertura" */
export function frasesDoMesPorFuncao(u: UnidadeDeCobertura): string[] {
  return u.diasPorFuncao.map((f) => `${rotulo(f.role)}: ${f.days} de ${u.diasDoPeriodo} dias por cobertura`);
}

/** "Férias 2 · Unidade sem a função 1" */
export function fraseDosMotivos(motivos: Record<string, number>): string {
  const partes = Object.entries(motivos)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${ehMotivoDeCobertura(k) ? ROTULO_DO_MOTIVO_DE_COBERTURA[k] : k} ${n}`);
  return partes.length ? partes.join(" · ") : "—";
}

/** "7h40" (segundos por dia). Nulo → "—". */
export function horasPorDia(segundos: number | null): string {
  if (segundos === null || segundos <= 0) return "—";
  const min = Math.round(segundos / 60);
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}

/** Os sinais de sobrecarga da pessoa (10.2/10.3), em frases. */
export function sinaisDeSobrecarga(p: PessoaEmCobertura): { sobrecarga: boolean; frases: string[] } {
  const frases: string[] = [];
  let sobrecarga = false;
  if (
    p.antesSegundos &&
    p.antesSegundos > 0 &&
    p.duranteSegundos !== null &&
    p.diasDurante >= DIAS_MINIMOS_PARA_COMPARAR &&
    p.duranteSegundos * 100 > p.antesSegundos * (100 + SOBRECARGA_PERCENTUAL)
  ) {
    sobrecarga = true;
    frases.push(
      `Tempo no sistema subiu de ${horasPorDia(p.antesSegundos)} para ${horasPorDia(p.duranteSegundos)} por dia`
    );
  }
  if (p.diasForaDoHorario >= FORA_DO_HORARIO_DIAS) {
    sobrecarga = true;
    frases.push(`${p.diasForaDoHorario} dias com acesso fora do horário da unidade`);
  }
  if (p.apoiosAgora >= 2) frases.push("Com duas funções de apoio ao mesmo tempo");
  return { sobrecarga, frases };
}

export function textoDoDesde(p: PessoaEmCobertura): string {
  return p.desde ? `desde ${formatAnyDateBr(p.desde)}` : "";
}

/** O que o banco recusou ao ler o painel. */
export function erroDoPainelDeCoberturas(mensagem: string): string {
  const m = mensagem ?? "";
  if (m.includes("coverage_panel") || m.includes("PGRST202"))
    return "Este banco ainda não recebeu a atualização do painel de coberturas (0419).";
  if (m.includes("NOT_ALLOWED")) return "Entre de novo para ver o painel.";
  if (m.includes("INVALID_PERIOD")) return "Período inválido.";
  return "Não foi possível ler as coberturas agora.";
}
