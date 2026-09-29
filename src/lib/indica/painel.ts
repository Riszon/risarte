// Indica +Risos — peças PURAS do painel, dos relatórios e da auditoria (IND5).

/** O que o banco devolve em `indica._indicadores` (via painel e relatórios). */
export type Indicadores = {
  registradas: number;
  compareceram: number;
  fecharam: number;
  convertidas_coorte: number;
  conversoes: number;
  receita_centavos: number;
  taxa_comparecimento: number | null;
  taxa_fechamento: number | null;
  clientes_novos: number;
  clientes_novos_indicacao: number;
  percentual_novos_indicacao: number | null;
  riso_coins_gerados: number;
  premios_equipe_centavos: number;
  custo_gerado_centavos: number;
  custo_realizado_centavos: number | null;
  cac_gerado_centavos: number | null;
  cac_realizado_centavos: number | null;
  roi_gerado: number | null;
  roi_realizado: number | null;
};

/**
 * Variação entre o período e o anterior. `menorEhMelhor` para custo: custo
 * caindo é melhora. Sem base (anterior nulo ou zero) não há percentual —
 * "+100%" sobre zero seria número inventado.
 */
export function variacao(
  atual: number | null | undefined,
  anterior: number | null | undefined,
  menorEhMelhor = false
): { percentual: number | null; melhorou: boolean | null } {
  if (atual === null || atual === undefined || anterior === null || anterior === undefined) {
    return { percentual: null, melhorou: null };
  }
  if (atual === anterior) return { percentual: anterior === 0 ? null : 0, melhorou: null };
  const subiu = atual > anterior;
  return {
    percentual: anterior === 0 ? null : Math.round(((atual - anterior) / Math.abs(anterior)) * 1000) / 10,
    melhorou: menorEhMelhor ? !subiu : subiu,
  };
}

/**
 * Retorno sobre o custo em %: (receita − custo) ÷ custo. −100% = gastou e a
 * receita ainda não veio; +300% = cada R$ 1 voltou como R$ 4.
 */
export function retornoPct(roi: number | null | undefined): string {
  if (roi === null || roi === undefined) return "—";
  const v = Math.round(roi * 100);
  return `${v > 0 ? "+" : ""}${v}%`;
}

/** Perda entre etapas do funil (em %), ou null sem base. */
export function perdaEntre(de: number, para: number): number | null {
  if (de <= 0) return null;
  return Math.round(((de - para) / de) * 1000) / 10;
}

export const REGRA_FRAUDE_LABEL: Record<string, string> = {
  volume: "Volume atípico",
  contato_embaixador: "Mesmo contato do Embaixador",
  contato_repetido: "Telefone de outra indicação",
  registro_tardio: "Registro depois do atendimento",
  conluio: "Concentração num Risartano",
  ciclo_fechado: "Ciclo fechado",
  ajustes: "Ajustes manuais em excesso",
};

export const SEVERIDADE_LABEL: Record<string, string> = { baixa: "Baixa", media: "Média", alta: "Alta" };
export const SEVERIDADE_COR: Record<string, string> = {
  baixa: "bg-muted text-muted-foreground",
  media: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  alta: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

export const ALERTA_STATUS_LABEL: Record<string, string> = {
  aberto: "Aberto",
  em_analise: "Em análise",
  procedente: "Procedente",
  improcedente: "Improcedente",
};

/** Explica o alerta em uma frase, a partir dos detalhes gravados pela regra. */
export function descreverAlerta(regra: string, d: Record<string, unknown>): string {
  const n = (k: string) => (d[k] === undefined || d[k] === null ? "?" : String(d[k]));
  switch (regra) {
    case "volume":
      return `${n("indicacoes")} indicações em ${n("janela_dias")} dias (limite ${n("limite")}).`;
    case "contato_embaixador":
      return `${n("codigo")}: o ${n("campo")} do indicado é o mesmo do Embaixador.`;
    case "contato_repetido": {
      const outras = Array.isArray(d.outras) ? (d.outras as string[]).join(", ") : "?";
      return `${n("codigo")}: telefone igual ao de ${outras}, de outro Embaixador.`;
    }
    case "registro_tardio":
      return `${n("codigo")}: o indicado já tinha sido atendido antes de a indicação ser registrada.`;
    case "conluio":
      return `${n("indicacoes_do_risartano")} de ${n("indicacoes_do_embaixador")} indicações (${n("percentual")}%) registradas pela mesma pessoa (limite ${n("limite")}%).`;
    case "ciclo_fechado":
      return `${n("codigo")}: o indicado em ${n("indicacao_de_ida")} virou Embaixador e indicou de volta quem o indicou.`;
    case "ajustes":
      return `${n("ajustes")} ajustes manuais em ${n("mes")} (limite ${n("limite")}), somando ${n("riso_coins")} Riso Coins.`;
    default:
      return "";
  }
}

/**
 * Monta um CSV para o Excel brasileiro: separador ";", vírgula decimal já
 * formatada por quem chama, BOM para os acentos e aspas quando preciso.
 * Protege contra fórmula injetada (célula começando com = + - @).
 */
export function paraCsv(cabecalho: string[], linhas: (string | number | null | undefined)[][]): string {
  const celula = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (typeof v === "string" && /^[=+\-@]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [cabecalho, ...linhas].map((l) => l.map(celula).join(";")).join("\r\n") + "\r\n";
}

/** Reais com vírgula, sem símbolo (a planilha soma). */
export const reaisCsv = (centavos: number | null | undefined) =>
  centavos === null || centavos === undefined ? "" : (centavos / 100).toFixed(2).replace(".", ",");

export const numeroCsv = (n: number | null | undefined) =>
  n === null || n === undefined ? "" : String(n).replace(".", ",");
