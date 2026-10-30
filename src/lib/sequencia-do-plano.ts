import { gutScore, type GutInput } from "@/lib/gut";
import type { ProjectedSession, TreatmentPlan } from "@/lib/planning";
import { repartirTempo } from "@/lib/planning";

/**
 * ATENDIMENTOS E SEQUÊNCIA (OC-00005, OC-00009, OC-00010; 0337).
 *
 * A lista "plana" de sessões é o estado da tela; os atendimentos saem dela. Cada
 * movimento devolve uma lista nova — sem ir ao servidor. Só a gravação (uma, com
 * a lista inteira) vai para lá.
 */

export type LinhaDaSequencia = {
  itemId: string;
  sessionIndex: number;
  groupNo: number | null;
  blockOrder: number;
  minutes: number | null;
  providerId: string | null;
};

export type Atendimento = {
  key: string;
  groupNo: number | null;
  sessions: ProjectedSession[];
  minutes: number;
};

export const chaveDaSessao = (s: { itemId: string; sessionIndex: number }) =>
  `${s.itemId}:${s.sessionIndex}`;

/** Sessões do mesmo grupo formam um atendimento, na posição da primeira. */
export function montarAtendimentos(sessions: readonly ProjectedSession[]): Atendimento[] {
  const lista: Atendimento[] = [];
  const porChave = new Map<string, Atendimento>();
  for (const s of sessions) {
    const key = s.groupNo != null ? `g:${s.groupNo}` : `s:${chaveDaSessao(s)}`;
    let a = porChave.get(key);
    if (!a) {
      a = { key, groupNo: s.groupNo, sessions: [], minutes: 0 };
      porChave.set(key, a);
      lista.push(a);
    }
    a.sessions.push(s);
    a.minutes += s.plannedMinutes ?? 0;
  }
  return lista;
}

/** Volta à lista plana, com a posição de cada atendimento gravada nas sessões. */
function achatar(atendimentos: readonly Atendimento[]): ProjectedSession[] {
  return atendimentos.flatMap((a, i) => a.sessions.map((s) => ({ ...s, blockOrder: i })));
}

/** Grupo de uma sessão só não é atendimento conjunto. */
function semGrupoDeUm(sessions: readonly ProjectedSession[]): ProjectedSession[] {
  const conta = new Map<number, number>();
  for (const s of sessions) {
    if (s.groupNo != null) conta.set(s.groupNo, (conta.get(s.groupNo) ?? 0) + 1);
  }
  return sessions.map((s) =>
    s.groupNo != null && conta.get(s.groupNo) === 1 ? { ...s, groupNo: null } : s
  );
}

/** Tira o atendimento da posição `de` e o põe na posição `para` (a partir de 0). */
export function moverAtendimento(
  sessions: readonly ProjectedSession[],
  de: number,
  para: number
): ProjectedSession[] {
  const lista = montarAtendimentos(sessions);
  if (de < 0 || de >= lista.length) return [...sessions];
  const destino = Math.min(Math.max(para, 0), lista.length - 1);
  if (destino === de) return [...sessions];
  const [movido] = lista.splice(de, 1);
  lista.splice(destino, 0, movido);
  return achatar(lista);
}

/**
 * Junta as sessões marcadas num atendimento só, na posição da primeira delas. Se
 * alguma já está num atendimento conjunto, as outras entram nele.
 */
export function juntarSessoes(
  sessions: readonly ProjectedSession[],
  marcadas: ReadonlySet<string>
): ProjectedSession[] {
  if (marcadas.size < 2) return [...sessions];
  const escolhidas = sessions.filter((s) => marcadas.has(chaveDaSessao(s)));
  if (escolhidas.length < 2) return [...sessions];
  const existente = escolhidas.find((s) => s.groupNo != null)?.groupNo ?? null;
  const usados = sessions.map((s) => s.groupNo).filter((g): g is number => g != null);
  const grupo = existente ?? (usados.length ? Math.max(...usados) + 1 : 1);

  const entraNoGrupo = (s: ProjectedSession) =>
    marcadas.has(chaveDaSessao(s)) || s.groupNo === grupo;
  const inicio = sessions.findIndex(entraNoGrupo);
  const juntas = sessions.filter(entraNoGrupo).map((s) => ({ ...s, groupNo: grupo }));
  const antes = sessions.slice(0, inicio).filter((s) => !entraNoGrupo(s));
  const depois = sessions.slice(inicio).filter((s) => !entraNoGrupo(s));
  return achatar(montarAtendimentos(semGrupoDeUm([...antes, ...juntas, ...depois])));
}

/** A sessão sai do atendimento conjunto e vira um atendimento logo depois dele. */
export function separarSessao(
  sessions: readonly ProjectedSession[],
  chave: string
): ProjectedSession[] {
  const alvo = sessions.find((s) => chaveDaSessao(s) === chave);
  if (!alvo || alvo.groupNo == null) return [...sessions];
  const resto = sessions.filter((s) => chaveDaSessao(s) !== chave);
  let ultimo = -1;
  resto.forEach((s, i) => {
    if (s.groupNo === alvo.groupNo) ultimo = i;
  });
  const lista = [...resto];
  lista.splice(ultimo + 1, 0, { ...alvo, groupNo: null });
  return achatar(montarAtendimentos(semGrupoDeUm(lista)));
}

/**
 * Sugere a ordem pela prioridade GUT: vale a maior nota do atendimento, sem nota
 * vai para o fim e o empate mantém a ordem de hoje.
 */
export function ordenarPorPrioridade(
  sessions: readonly ProjectedSession[],
  itens: ReadonlyMap<string, GutInput>
): ProjectedSession[] {
  const nota = (a: Atendimento) =>
    Math.max(-1, ...a.sessions.map((s) => gutScore(itens.get(s.itemId) ?? {}) ?? -1));
  const lista = montarAtendimentos(sessions)
    .map((a, i) => ({ a, i, n: nota(a) }))
    .sort((x, y) => y.n - x.n || x.i - y.i)
    .map((x) => x.a);
  return achatar(lista);
}

/** Reparte o tempo do atendimento entre as sessões dele; null = total inválido. */
export function repartirTempoDoAtendimento(
  sessions: readonly ProjectedSession[],
  atendimento: Atendimento,
  total: number
): ProjectedSession[] | null {
  const partes = repartirTempo(total, atendimento.sessions.map((s) => s.plannedMinutes));
  if (!partes) return null;
  const novo = new Map(atendimento.sessions.map((s, i) => [chaveDaSessao(s), partes[i]]));
  return sessions.map((s) => {
    const m = novo.get(chaveDaSessao(s));
    return m === undefined ? s : { ...s, plannedMinutes: m };
  });
}

/** O que se grava: a lista inteira, com a posição de cada atendimento. */
export function linhasParaGravar(sessions: readonly ProjectedSession[]): LinhaDaSequencia[] {
  return montarAtendimentos(sessions).flatMap((a, i) =>
    a.sessions.map((s) => ({
      itemId: s.itemId,
      sessionIndex: s.sessionIndex,
      groupNo: a.sessions.length > 1 ? a.groupNo : null,
      blockOrder: i,
      minutes: s.plannedMinutes,
      providerId: s.providerId,
    }))
  );
}

/**
 * Configurada = o Planner confirmou. O plano já enviado antes da 0337 não tem a
 * confirmação e não pode mais recebê-la: nele, vale ter a ordem gravada.
 */
export function opcaoConfigurada(
  opcao: { confirmadaEm: string | null; sessions: readonly ProjectedSession[] },
  editavel: boolean
): boolean {
  if (opcao.confirmadaEm) return true;
  return !editavel && opcao.sessions.length > 0 && opcao.sessions.every((s) => s.blockOrder != null);
}

/** O plano que a tela abre: o editável que vale; senão o que vale; senão o mais novo. */
export function planoQueAbre<P extends Pick<TreatmentPlan, "status" | "supersededAt">>(
  plans: readonly P[]
): P | null {
  return (
    plans.find((p) => (p.status === "draft" || p.status === "returned") && !p.supersededAt) ??
    plans.find((p) => !p.supersededAt) ??
    plans[0] ??
    null
  );
}

export const planoEditavel = (p: Pick<TreatmentPlan, "status" | "supersededAt">) =>
  (p.status === "draft" || p.status === "returned") && !p.supersededAt;
