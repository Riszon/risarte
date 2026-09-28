// Indica +Risos — regras PURAS das campanhas (IND4), espelho do que o banco
// impõe na 2007. A tela usa para mostrar e pré-conferir; quem decide é o banco
// (`mudar_campanha`, `campanha_protege_regras`, `_campanha_para`).

export const CAMPANHA_STATUS = ["rascunho", "agendada", "ativa", "pausada", "encerrada", "apurada"] as const;
export type CampanhaStatus = (typeof CAMPANHA_STATUS)[number];

export const CAMPANHA_STATUS_LABEL: Record<CampanhaStatus, string> = {
  rascunho: "Rascunho",
  agendada: "Agendada",
  ativa: "Ativa",
  pausada: "Pausada",
  encerrada: "Encerrada",
  apurada: "Apurada",
};

export const CAMPANHA_STATUS_COR: Record<CampanhaStatus, string> = {
  rascunho: "bg-muted text-muted-foreground",
  agendada: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  ativa: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  pausada: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  encerrada: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  apurada: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
};

export const ACOES_CAMPANHA = ["publicar", "pausar", "retomar", "encerrar", "apurar", "voltar_rascunho"] as const;
export type AcaoCampanha = (typeof ACOES_CAMPANHA)[number];

export const ACAO_CAMPANHA_LABEL: Record<AcaoCampanha, string> = {
  publicar: "Publicar",
  pausar: "Pausar",
  retomar: "Retomar",
  encerrar: "Encerrar",
  apurar: "Marcar como apurada",
  voltar_rascunho: "Voltar para rascunho",
};

/** Espelho de `indica.mudar_campanha`: o que cada situação deixa fazer. */
export function acoesDaCampanha(status: CampanhaStatus): AcaoCampanha[] {
  switch (status) {
    case "rascunho":
      return ["publicar"];
    case "agendada":
      return ["encerrar", "voltar_rascunho"];
    case "ativa":
      return ["pausar", "encerrar"];
    case "pausada":
      return ["retomar", "encerrar"];
    case "encerrada":
      return ["apurar"];
    case "apurada":
      return [];
  }
}

/** Depois de começar, só dá para AMPLIAR (o banco recusa o resto). */
export const campanhaComecou = (status: CampanhaStatus) =>
  status === "ativa" || status === "pausada" || status === "encerrada" || status === "apurada";

export const ETAPAS = ["registro", "comparecimento", "fechamento"] as const;
export type Etapa = (typeof ETAPAS)[number];
export const ETAPA_LABEL: Record<Etapa, string> = {
  registro: "registro",
  comparecimento: "comparecimento",
  fechamento: "fechamento",
};

export type Marco = { conversoes: number; bonus: number };
export type RegrasCampanha = {
  multiplicador?: number;
  pontos_extra?: Partial<Record<Etapa, number>>;
  marcos?: Marco[];
};
export type PublicoCampanha = {
  niveis?: string[];
  especialidades?: string[];
  empresas?: string[];
};
export type ModeloCampanha = {
  codigo: string;
  nome: string;
  descricao: string;
  dias: number;
  regras: RegrasCampanha;
};

const fmt = (n: number) => String(n).replace(".", ",");

/** As regras em frases curtas, para a lista e o detalhe. */
export function resumoRegras(r: RegrasCampanha | null | undefined): string[] {
  const linhas: string[] = [];
  const mult = Number(r?.multiplicador ?? 1);
  if (mult > 1) linhas.push(`Riso Coins ×${fmt(mult)} (não soma com o nível: vale o maior)`);
  for (const e of ETAPAS) {
    const extra = Number(r?.pontos_extra?.[e] ?? 0);
    if (extra > 0) linhas.push(`+${extra} Riso Coins no ${ETAPA_LABEL[e]}`);
  }
  for (const m of [...(r?.marcos ?? [])].sort((a, b) => a.conversoes - b.conversoes)) {
    linhas.push(`Bônus de ${m.bonus} na ${m.conversoes}ª conversão na campanha`);
  }
  return linhas.length > 0 ? linhas : ["Sem vantagem definida"];
}

/** O público em uma frase. Lista vazia/ausente = todos. */
export function resumoPublico(
  p: PublicoCampanha | null | undefined,
  nomes: { niveis?: Map<string, string>; empresas?: Map<string, string> } = {}
): string {
  const partes: string[] = [];
  if (p?.niveis?.length) partes.push(`níveis: ${p.niveis.map((n) => nomes.niveis?.get(n) ?? n).join(", ")}`);
  if (p?.especialidades?.length) partes.push(`tratamento em: ${p.especialidades.join(", ")}`);
  if (p?.empresas?.length) {
    partes.push(`empresas: ${p.empresas.map((e) => nomes.empresas?.get(e) ?? "empresa").join(", ")}`);
  }
  return partes.length > 0 ? partes.join(" · ") : "Todos os Embaixadores";
}

type Lido<T> = { ok: true; valor: T } | { ok: false; error: string };

const inteiroNaoNegativo = (s: string) => {
  const t = s.trim();
  if (t === "") return 0;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/**
 * Lê o formulário das regras. Marcos em texto: "3:300, 5:600" (conversões:bônus).
 */
export function lerRegras(campos: {
  multiplicador: string;
  registro: string;
  comparecimento: string;
  fechamento: string;
  marcos: string;
}): Lido<RegrasCampanha> {
  const multTxt = campos.multiplicador.trim().replace(",", ".");
  const mult = multTxt === "" ? 1 : Number(multTxt);
  if (!Number.isFinite(mult) || mult < 1) {
    return { ok: false, error: "Multiplicador: 1 ou mais (campanha só amplia, nunca reduz)." };
  }
  const extra: Partial<Record<Etapa, number>> = {};
  for (const e of ETAPAS) {
    const n = inteiroNaoNegativo(campos[e]);
    if (n === null) return { ok: false, error: `Pontos extras no ${ETAPA_LABEL[e]}: número inteiro (0 ou mais).` };
    if (n > 0) extra[e] = n;
  }
  const marcos: Marco[] = [];
  const texto = campos.marcos.trim();
  if (texto) {
    for (const parte of texto.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean)) {
      const m = /^(\d+)\s*[:=]\s*(\d+)$/.exec(parte);
      if (!m) return { ok: false, error: `Marco "${parte}": use conversões:bônus (ex.: 3:300).` };
      const conversoes = Number(m[1]);
      const bonus = Number(m[2]);
      if (conversoes < 1 || bonus < 1) return { ok: false, error: "Marco: conversões e bônus maiores que zero." };
      if (marcos.some((x) => x.conversoes === conversoes)) {
        return { ok: false, error: `Marco repetido para ${conversoes} conversões.` };
      }
      marcos.push({ conversoes, bonus });
    }
    marcos.sort((a, b) => a.conversoes - b.conversoes);
  }
  const regras: RegrasCampanha = {};
  if (mult > 1) regras.multiplicador = mult;
  if (Object.keys(extra).length > 0) regras.pontos_extra = extra;
  if (marcos.length > 0) regras.marcos = marcos;
  if (Object.keys(regras).length === 0) {
    return { ok: false, error: "Defina alguma vantagem: multiplicador, pontos extras ou marcos." };
  }
  return { ok: true, valor: regras };
}

/** Marcos em texto para o formulário ("3:300, 5:600"). */
export const marcosEmTexto = (m: Marco[] | undefined) =>
  (m ?? []).map((x) => `${x.conversoes}:${x.bonus}`).join(", ");

/**
 * Espelho de `campanha_protege_regras`: depois de começar, as regras não
 * podem diminuir. Devolve a primeira redução achada (ou null).
 */
export function reducaoDeRegras(antes: RegrasCampanha, depois: RegrasCampanha): string | null {
  if (Number(depois.multiplicador ?? 1) < Number(antes.multiplicador ?? 1)) return "o multiplicador";
  for (const e of ETAPAS) {
    if (Number(depois.pontos_extra?.[e] ?? 0) < Number(antes.pontos_extra?.[e] ?? 0)) {
      return `os pontos extras no ${ETAPA_LABEL[e]}`;
    }
  }
  return null;
}

export type SituacaoOrcamento = "sem_orcamento" | "ok" | "alerta" | "esgotado";

/** Farol do orçamento: alerta a partir do % configurado; esgotado em 100%. */
export function situacaoOrcamento(percentual: number | null | undefined, alertaPercentual: number): SituacaoOrcamento {
  if (percentual === null || percentual === undefined) return "sem_orcamento";
  if (percentual >= 100) return "esgotado";
  if (percentual >= alertaPercentual) return "alerta";
  return "ok";
}
