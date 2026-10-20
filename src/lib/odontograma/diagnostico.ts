// ODONTOGRAMA — O DIAGNÓSTICO (OD2, 0310, 20/10/2026).
//
// O Coordenador SUGERE, o Planner DEFINE (aceita, ajusta ou rejeita) e
// FINALIZA. As marcas só se acrescentam: a situação de um dente é sempre
// CALCULADA a partir delas (marca definida menos a retirada definida), nunca
// guardada. Aqui: essa conta, a régua de "cabe neste dente" (a mesma do
// banco, para a tela avisar antes de gravar) e os recados em português.
//
// Puro e testado.

import type { Denticao, MarcaNoDente } from "@/lib/odontograma/desenho";

export type StatusDoAchado = "suggested" | "defined" | "rejected" | "adjusted" | "withdrawn";

export type Achado = {
  id: string;
  evaluationId: string | null;
  dente: string;
  faces: string[];
  situacao: string;
  acao: "mark" | "remove";
  retira: string | null;
  origem: "suggestion" | "direct" | "adjustment";
  adendo: boolean;
  motivoDoAdendo: string | null;
  status: StatusDoAchado;
  ajustadoDe: string | null;
  observacao: string | null;
  criadoPor: string | null;
  criadoEm: string;
  decididoPor: string | null;
  decididoEm: string | null;
  motivoDaDecisao: string | null;
};

export type SituacaoDoDente = {
  code: string;
  name: string;
  appliesTo: "face" | "crown" | "root" | "whole_tooth" | "between_teeth";
  usage: "finding" | "effect" | "both";
  symbol: string;
  isActive: boolean;
  sortOrder: number;
};

// -- A dentição: o banco fala inglês, a tela português ---------------------------
const DENTICAO_DO_BANCO: Record<string, Denticao> = {
  permanent: "permanente",
  deciduous: "decidua",
  mixed: "mista",
};
export function denticaoDoBanco(v: string | null | undefined): Denticao | null {
  return v ? (DENTICAO_DO_BANCO[v] ?? null) : null;
}
export function denticaoParaOBanco(d: Denticao): "permanent" | "deciduous" | "mixed" {
  return d === "permanente" ? "permanent" : d === "decidua" ? "deciduous" : "mixed";
}

// -- A situação atual -------------------------------------------------------------

/** As marcas que valem numa data (padrão: agora): definidas até a data e não
 *  retiradas por uma retirada definida até a data. */
export function marcasAtuais(achados: Achado[], ate?: string): Achado[] {
  const limite = ate ? new Date(ate).getTime() : Infinity;
  const ate_ = (a: Achado) => a.decididoEm !== null && new Date(a.decididoEm).getTime() <= limite;
  const retiradas = new Set(
    achados.filter((a) => a.acao === "remove" && a.status === "defined" && ate_(a)).map((a) => a.retira)
  );
  return achados.filter((a) => a.acao === "mark" && a.status === "defined" && ate_(a) && !retiradas.has(a.id));
}

export function pendentes(achados: Achado[]): Achado[] {
  return achados.filter((a) => a.status === "suggested");
}

export type FiltroDoDesenho = "todos" | "definidos" | "sugestoes";

export const ROTULO_DO_FILTRO: Record<FiltroDoDesenho, string> = {
  todos: "Todos",
  definidos: "Só definidos",
  sugestoes: "Só sugestões",
};

/** O que o desenho mostra: definidas como existentes; sugestões tracejadas.
 *  (O vermelho "a realizar" chega com o plano, na OD3.) */
export function marcasDoDesenho(
  achados: Achado[],
  situacoes: SituacaoDoDente[],
  filtro: FiltroDoDesenho = "todos"
): MarcaNoDente[] {
  const porCodigo = new Map(situacoes.map((s) => [s.code, s]));
  const marca = (a: Achado, situacao: MarcaNoDente["situacao"]): MarcaNoDente | null => {
    const s = porCodigo.get(a.situacao);
    if (!s) return null;
    return { dente: a.dente, faces: a.faces, local: s.appliesTo, situacao, codigo: s.code, simbolo: s.symbol, nome: s.name };
  };
  const lista: (MarcaNoDente | null)[] = [];
  if (filtro !== "sugestoes") lista.push(...marcasAtuais(achados).map((a) => marca(a, "existente")));
  if (filtro !== "definidos")
    lista.push(...pendentes(achados).filter((a) => a.acao === "mark").map((a) => marca(a, "sugerido")));
  return lista.filter((m): m is MarcaNoDente => m !== null);
}

// -- O que cabe -------------------------------------------------------------------

/** As situações que dá para marcar como ACHADO: com faces escolhidas, as de
 *  face; sem faces, as do dente, coroa, raiz ou entre dentes. */
export function situacoesQueCabem(situacoes: SituacaoDoDente[], comFaces: boolean): SituacaoDoDente[] {
  return situacoes
    .filter((s) => s.isActive && s.usage !== "effect" && (s.appliesTo === "face") === comFaces)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export type ItemDoDiagnostico = { tooth: string; faces: string[]; condition: string; note?: string };

/**
 * Monta o que vai ao banco para vários dentes de uma vez. Numa situação de
 * face, cada dente fica com as faces escolhidas QUE ELE TEM (o 11 não tem
 * Oclusal; o 36 não tem Palatina); dente que não fica com nenhuma vira
 * problema, e nada é gravado sem a pessoa ver.
 */
export function montarItens(
  dentes: string[],
  facesEscolhidas: string[],
  situacao: SituacaoDoDente,
  facesPorDente: Record<string, string[]>,
  observacao?: string
): { itens: ItemDoDiagnostico[]; problemas: string[] } {
  const itens: ItemDoDiagnostico[] = [];
  const problemas: string[] = [];
  const note = observacao?.trim() || undefined;
  if (dentes.length === 0) return { itens, problemas: ["Escolha pelo menos um dente."] };
  for (const dente of dentes) {
    if (situacao.appliesTo !== "face") {
      itens.push({ tooth: dente, faces: [], condition: situacao.code, note });
      continue;
    }
    const tem = facesPorDente[dente] ?? [];
    const faces = facesEscolhidas.filter((f) => tem.includes(f));
    if (faces.length === 0) {
      problemas.push(
        facesEscolhidas.length === 0
          ? `${situacao.name} se marca na face: escolha a face.`
          : `O dente ${dente} não tem a face ${facesEscolhidas.join(", ")}.`
      );
      continue;
    }
    itens.push({ tooth: dente, faces, condition: situacao.code, note });
  }
  return { itens, problemas };
}

// -- Quem faz o quê na tela (espelho das réguas da 0310) ---------------------------

type QuemEsta = { isOwner?: boolean; rolesByClinic: Record<string, readonly string[]> };

/** Sugere: o Coordenador de uma das unidades do cliente, ou o titular. O
 *  Admin Master que não é o titular NÃO (D6) — é ato clínico, com nome. */
export function podeSugerirOdontograma(s: QuemEsta, unidadesDoCliente: (string | null | undefined)[]): boolean {
  if (s.isOwner) return true;
  return unidadesDoCliente.some((c) => Boolean(c) && (s.rolesByClinic[c as string] ?? []).includes("clinical_coordinator"));
}

/** Define, ajusta, rejeita e finaliza: o Planner, ou o titular. */
export function podeDefinirOdontograma(s: QuemEsta, ehPlanner: boolean): boolean {
  return Boolean(s.isOwner) || ehPlanner;
}

// -- O aviso do plano (E2) ---------------------------------------------------------

export type RodadaDoDiagnostico = {
  id: string;
  finalizadoEm: string | null;
};

/** "Diagnóstico a definir": há sugestão pendente, ou nenhuma rodada foi
 *  finalizada ainda. Na OD2 é aviso; a trava entra na OD3 (decisão E2). */
export function diagnosticoADefinir(achados: Achado[], rodadas: RodadaDoDiagnostico[]) {
  const n = pendentes(achados).length;
  const algumFinalizado = rodadas.some((r) => r.finalizadoEm !== null);
  return { pendentes: n, algumFinalizado, aDefinir: n > 0 || !algumFinalizado };
}

/** Uma rodada só finaliza sem sugestão pendente nela. */
export function podeFinalizar(achados: Achado[], rodada: RodadaDoDiagnostico): boolean {
  return rodada.finalizadoEm === null && !achados.some((a) => a.evaluationId === rodada.id && a.status === "suggested");
}

// -- Rótulos --------------------------------------------------------------------------

export const ROTULO_DO_STATUS: Record<StatusDoAchado, string> = {
  suggested: "sugestão pendente",
  defined: "definido",
  rejected: "rejeitado",
  adjusted: "ajustado",
  withdrawn: "desfeito",
};

export function descricaoDoAchado(a: Achado, nomeDaSituacao: string): string {
  const faces = a.faces.length ? ` (${a.faces.join(", ")})` : "";
  const retirar = a.acao === "remove" ? "Retirar: " : "";
  return `${a.dente} · ${retirar}${nomeDaSituacao}${faces}`;
}

/** Os recados do banco, em português. Desconhecido → nulo (nunca chuta). */
export function mensagemDoDiagnostico(erro: string): string | null {
  const mapa: [string, string][] = [
    ["PENDING_SUGGESTIONS", "Ainda há sugestões pendentes nesta rodada: decida todas antes de finalizar."],
    ["ROUND_FINALIZED", "Esta rodada já teve o diagnóstico finalizado: o que foi registrado nela não muda. Para corrigir, use o adendo (com motivo)."],
    ["ADDENDUM_REASON_REQUIRED", "O diagnóstico já foi finalizado: escreva o motivo do adendo (mínimo de 5 letras)."],
    ["FINDING_ALREADY_DECIDED", "Esta sugestão já foi decidida (ou desfeita). Atualize a tela."],
    ["FINDING_NOT_FOUND", "Marca não encontrada. Atualize a tela."],
    ["FINDING_LOCKED", "Marca registrada não muda."],
    ["FINDING_NOT_DELETABLE", "Marca registrada não se apaga — retire com uma marca nova."],
    ["FINDING_FACES_REQUIRED", "Esta situação se marca na face: escolha a face."],
    ["FACE_NOT_ON_TOOTH", "Há uma face que o dente não tem (ex.: Oclusal num incisivo, Palatina num dente de baixo)."],
    ["FACES_NOT_ALLOWED", "Esta situação é do dente inteiro (ou da raiz): não leva face."],
    ["CONDITION_NOT_A_FINDING", "Esta situação é efeito de procedimento, não achado do exame."],
    ["CONDITION_INACTIVE", "Esta situação está desativada."],
    ["UNKNOWN_CONDITION", "Há uma situação que não existe na lista."],
    ["REMOVE_TARGET_INVALID", "Só se retira uma marca que está definida."],
    ["ALREADY_REMOVED", "Esta marca já foi retirada."],
    ["ADJUST_NOT_ALLOWED", "Uma retirada não se ajusta: aceite ou rejeite."],
    ["NO_EVALUATION", "O cliente ainda não tem avaliação aberta: o Coordenador abre a avaliação primeiro."],
    ["EVALUATION_NOT_FOUND", "Rodada não encontrada. Atualize a tela."],
    ["EVALUATION_MISMATCH", "A marca não é desta rodada."],
    ["INVALID_DENTITION", "Dentição inválida."],
    ["INVALID_DECISION", "Decisão inválida."],
    ["EMPTY_ITEMS", "Nada para gravar."],
    ["NOT_ALLOWED", "A sua função não faz isso no odontograma: o Coordenador sugere; o Planner define e finaliza."],
  ];
  for (const [k, v] of mapa) if (erro.includes(k)) return v;
  return null;
}

/** O que a linha do banco vira na tela. */
export function achadoDaLinha(r: {
  id: string;
  evaluation_id: string | null;
  tooth_code: string;
  face_codes: string[] | null;
  condition_code: string;
  action: string;
  removes_finding_id: string | null;
  origin: string;
  is_addendum: boolean;
  addendum_reason: string | null;
  status: string;
  adjusted_from: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
}): Achado {
  return {
    id: r.id,
    evaluationId: r.evaluation_id,
    dente: r.tooth_code,
    faces: r.face_codes ?? [],
    situacao: r.condition_code,
    acao: r.action === "remove" ? "remove" : "mark",
    retira: r.removes_finding_id,
    origem: r.origin as Achado["origem"],
    adendo: r.is_addendum,
    motivoDoAdendo: r.addendum_reason,
    status: r.status as StatusDoAchado,
    ajustadoDe: r.adjusted_from,
    observacao: r.note,
    criadoPor: r.created_by,
    criadoEm: r.created_at,
    decididoPor: r.decided_by,
    decididoEm: r.decided_at,
    motivoDaDecisao: r.decision_reason,
  };
}

export const COLUNAS_DO_ACHADO =
  "id, evaluation_id, tooth_code, face_codes, condition_code, action, removes_finding_id, origin, is_addendum, addendum_reason, status, adjusted_from, note, created_by, created_at, decided_by, decided_at, decision_reason";
