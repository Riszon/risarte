// O PAINEL DE RELATOS (0258) — as regras da tela, puras e testadas.
//
// A CONTA mora no banco (`system_reports_dashboard`); aqui fica o que a tela
// decide sozinha: qual período abrir, como ler um período vindo do endereço,
// como escrever taxa e duração sem mentir quando não há base, e quem enxerga o
// link do painel (espelho da regra do banco — quem decide de verdade é ele).

import { addDaysIso, monthRangeOf } from "@/lib/dates";
import type { ModuloDoSistema, SituacaoDeRelato, TipoDeRelato } from "@/lib/system-reports";

export type PainelDeRelatos = {
  escopo: {
    rede: boolean;
    grao: "week" | "month";
    unidades: { id: string; nome: string }[];
  };
  totais: {
    relatos: number;
    erros: number;
    erros_resolvidos: number;
    erros_nao_defeito: number;
    duvidas: number;
    duvidas_respondidas: number;
    sugestoes: number;
    sugestoes_implantadas: number;
    sugestoes_recusadas: number;
    em_aberto: number;
    sem_resposta: number;
    reabertos: number;
  };
  respostas_enviadas: number;
  tempos: {
    resposta_media_h: number | null;
    resposta_mediana_h: number | null;
    respondidos: number;
    conclusao_media_h: number | null;
    conclusao_mediana_h: number | null;
    concluidos: number;
    concluidos_sem_data: number;
  };
  por_modulo: {
    modulo: ModuloDoSistema | "sem";
    relatos: number;
    sugestoes: number;
    implantadas: number;
    erros: number;
    erros_resolvidos: number;
    duvidas: number;
  }[];
  por_unidade: {
    clinic_id: string;
    nome: string;
    relatos: number;
    aproveitados: number;
    sugestoes: number;
    implantadas: number;
    pessoas: number;
  }[];
  /** `null` fora da rede: unidade não vê ranking de pessoas (decisão do dono). */
  por_pessoa:
    | {
        reporter_id: string;
        nome: string;
        papel: string | null;
        unidades: string;
        relatos: number;
        aproveitados: number;
        sugestoes: number;
        implantadas: number;
      }[]
    | null;
  parados: {
    code: string;
    kind: TipoDeRelato;
    status: SituacaoDeRelato;
    modulo: ModuloDoSistema | "sem";
    unidade: string;
    criado_em: string;
    sem_resposta: boolean;
    reopened_count: number;
  }[];
  serie: { inicio: string; relatados: number; concluidos: number }[];
};

// -----------------------------------------------------------------------------
// Período
// -----------------------------------------------------------------------------

export const PERIODOS = [
  { value: "30d", label: "Últimos 30 dias" },
  { value: "90d", label: "Últimos 90 dias" },
  { value: "mes", label: "Este mês" },
  { value: "ano", label: "Este ano" },
] as const;

export type PeriodoPronto = (typeof PERIODOS)[number]["value"];

/**
 * O padrão é 90 dias: relato é coisa rara (uma operação de ~15 pessoas), e
 * num mês só os indicadores quase sempre dariam "sem base".
 */
export const PERIODO_PADRAO: PeriodoPronto = "90d";

export type Periodo = { de: string; ate: string; pronto: PeriodoPronto | null };

function ehData(v: string | undefined | null): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [a, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  // "2026-02-31" vira março no Date — só vale se voltar igual.
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function periodoPronto(p: PeriodoPronto, hoje: string): Periodo {
  switch (p) {
    case "30d":
      return { de: addDaysIso(hoje, -29), ate: hoje, pronto: p };
    case "90d":
      return { de: addDaysIso(hoje, -89), ate: hoje, pronto: p };
    case "mes":
      return { de: monthRangeOf(hoje).from, ate: hoje, pronto: p };
    case "ano":
      return { de: `${hoje.slice(0, 4)}-01-01`, ate: hoje, pronto: p };
  }
}

/**
 * Lê o período do endereço. Data personalizada ganha do pronto; data que não
 * dá para ler é ignorada (cai no padrão) em vez de derrubar a tela — a lição do
 * filtro de Recebíveis (OC-00009). Período invertido é desvirado.
 */
export function lerPeriodo(
  params: { periodo?: string | null; de?: string | null; ate?: string | null },
  hoje: string
): Periodo {
  const de = ehData(params.de) ? params.de : null;
  const ate = ehData(params.ate) ? params.ate : null;
  if (de || ate) {
    const inicio = de ?? addDaysIso(ate!, -89);
    const fim = ate ?? hoje;
    return inicio <= fim
      ? { de: inicio, ate: fim, pronto: null }
      : { de: fim, ate: inicio, pronto: null };
  }
  const pronto = PERIODOS.find((p) => p.value === params.periodo)?.value ?? PERIODO_PADRAO;
  return periodoPronto(pronto, hoje);
}

// -----------------------------------------------------------------------------
// Números
// -----------------------------------------------------------------------------

/** Percentual inteiro, ou `null` sem base — "0%" de zero relatos não é 0%. */
export function taxa(parte: number, total: number): number | null {
  if (!total) return null;
  return Math.round((parte / total) * 100);
}

/**
 * Duração em horas escrita para gente: "40 min", "5,5 h", "3,2 dias".
 * `null` = ninguém chegou lá ainda — a tela escreve "sem dado", nunca "0 h".
 */
export function rotuloDeHoras(horas: number | null | undefined): string | null {
  if (horas === null || horas === undefined || Number.isNaN(Number(horas))) return null;
  const h = Math.max(0, Number(horas));
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${formatar(h)} h`;
  return `${formatar(h / 24)} dias`;
}

function formatar(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

/** A maior contagem de uma lista — base das barras. Nunca zero (divisão). */
export function maiorDe(valores: number[]): number {
  return Math.max(1, ...valores);
}

/** "Semana de 14/09" ou "set/26". */
export function rotuloDoPonto(inicio: string, grao: "week" | "month"): string {
  const [a, m, d] = inicio.split("-");
  if (grao === "month") {
    const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    return `${meses[Number(m) - 1]}/${a.slice(2)}`;
  }
  return `${d}/${m}`;
}

// -----------------------------------------------------------------------------
// Quem vê o link
// -----------------------------------------------------------------------------

/**
 * Espelho da regra do banco, para esconder o link de quem não pode abrir.
 * Admin; qualquer papel na Franqueadora; Gerente ou Franqueado de unidade.
 */
export function podeVerPainelDeRelatos(s: {
  isAdminMaster: boolean;
  clinics: { id: string; type?: string | null }[];
  rolesByClinic: Record<string, string[]>;
}): boolean {
  if (s.isAdminMaster) return true;
  return Object.entries(s.rolesByClinic).some(([clinicId, papeis]) => {
    if (papeis.length === 0) return false;
    const clinica = s.clinics.find((c) => c.id === clinicId);
    if (clinica?.type === "franchisor") return true;
    return papeis.includes("unit_manager") || papeis.includes("franchisee");
  });
}
