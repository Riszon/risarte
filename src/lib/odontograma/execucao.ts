// ODONTOGRAMA — A EXECUÇÃO (OD5, 0314, 20/10/2026). Puro — testável sem banco.
//
// A situação do dente continua CALCULADA: o diagnóstico definido + o efeito
// de cada procedimento FEITO. Esta é a mesma conta do banco
// (`_tooth_done_effects` e `_tooth_current_conditions`, 0314) — se mudar
// aqui, muda lá.
//   * H1: o item conta como feito quando TODAS as suas sessões (fora as
//     canceladas) estão concluídas; o dia é o da última.
//   * H2: o feito resolve o achado "a tratar" decidido ANTES dele, no mesmo
//     lugar: a mesma face; sem face, pelo alcance do efeito (dente inteiro →
//     tudo; coroa → face e coroa; raiz → raiz). Procedimento sem efeito não
//     resolve nada (uma radiografia não trata a cárie).

import type { MarcaNoDente } from "@/lib/odontograma/desenho";
import type { Achado, SituacaoDoDente } from "@/lib/odontograma/diagnostico";
import type { RegraDoPlano } from "@/lib/odontograma/plano";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";

/** Uma sessão com o lugar do item (`odontogram_sessions`, 0314). */
export type SessaoDoOdontograma = {
  sessionId: string;
  itemId: string | null;
  procedureId: string | null;
  status: string;
  doneAt: string | null;
  toothCode: string | null;
  faceCodes: string[];
  regionCode: string | null;
};

export type ProcedimentoFeito = {
  itemId: string;
  dente: string;
  faces: string[];
  /** A situação que o procedimento deixa no dente (já com a regra do ausente). */
  efeito: string;
  feitoEm: string;
};

/** H1: os itens com todas as sessões (não canceladas) concluídas, e o dia da última. */
export function itensFeitos(sessoes: SessaoDoOdontograma[]): Map<string, string> {
  const porItem = new Map<string, SessaoDoOdontograma[]>();
  for (const s of sessoes) {
    if (!s.itemId || s.status === "cancelled") continue;
    porItem.set(s.itemId, [...(porItem.get(s.itemId) ?? []), s]);
  }
  const feitos = new Map<string, string>();
  for (const [itemId, lista] of porItem) {
    if (lista.length === 0 || !lista.every((s) => s.status === "done" && s.doneAt)) continue;
    feitos.set(itemId, lista.map((s) => s.doneAt as string).sort().at(-1) as string);
  }
  return feitos;
}

/** O que foi FEITO em cada dente, com o efeito. Item sem dente ou procedimento
 *  sem efeito não entra (não muda o desenho). */
export function procedimentosFeitos(
  sessoes: SessaoDoOdontograma[],
  regras: Record<string, RegraDoPlano>,
  achados: Achado[]
): ProcedimentoFeito[] {
  const feitos = itensFeitos(sessoes);
  // Dente ausente no diagnóstico definido (marca "A" não retirada): a prótese
  // fixa vira pôntico em vez de pilar (0308).
  const retirados = new Set(
    achados.filter((a) => a.acao === "remove" && a.status === "defined").map((a) => a.retira)
  );
  const ausentes = new Set(
    achados
      .filter((a) => a.acao === "mark" && a.status === "defined" && a.situacao === "A" && !retirados.has(a.id))
      .map((a) => a.dente)
  );
  const ausenteDe = (dente: string) => ausentes.has(dente);
  const lista: ProcedimentoFeito[] = [];
  const vistos = new Set<string>();
  for (const s of sessoes) {
    if (!s.itemId || !s.toothCode || !s.procedureId || vistos.has(s.itemId)) continue;
    const feitoEm = feitos.get(s.itemId);
    if (!feitoEm) continue;
    vistos.add(s.itemId);
    const regra = regras[s.procedureId];
    const efeito = ausenteDe(s.toothCode) && regra?.efeitoSeAusente ? regra.efeitoSeAusente : regra?.efeito;
    if (!efeito) continue;
    lista.push({ itemId: s.itemId, dente: s.toothCode, faces: s.faceCodes, efeito, feitoEm });
  }
  return lista;
}

/** H2: o achado "a tratar" que um procedimento feito resolveu (id → o feito). */
export function achadosTratados(
  atuais: Achado[],
  feitos: ProcedimentoFeito[],
  situacoes: SituacaoDoDente[]
): Map<string, ProcedimentoFeito> {
  const porCodigo = new Map(situacoes.map((s) => [s.code, s]));
  const tratados = new Map<string, ProcedimentoFeito>();
  for (const a of atuais) {
    const sa = porCodigo.get(a.situacao);
    if (!sa?.aTratar || !a.decididoEm) continue;
    const localDoAchado = a.faces.length > 0 ? "face" : sa.appliesTo;
    const quem = feitos.find((f) => {
      if (f.dente !== a.dente) return false;
      if (new Date(a.decididoEm as string).getTime() > new Date(f.feitoEm).getTime()) return false;
      if (f.faces.length > 0) return a.faces.some((x) => f.faces.includes(x));
      const alcance = porCodigo.get(f.efeito)?.appliesTo;
      return (
        alcance === "whole_tooth" ||
        (alcance === "root" && localDoAchado === "root") ||
        (alcance === "crown" && (localDoAchado === "face" || localDoAchado === "crown"))
      );
    });
    if (quem) tratados.set(a.id, quem);
  }
  return tratados;
}

const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE });

/** O feito no desenho: azul (existente), com o símbolo do efeito. */
export function marcasDosFeitos(feitos: ProcedimentoFeito[], situacoes: SituacaoDoDente[]): MarcaNoDente[] {
  const porCodigo = new Map(situacoes.map((s) => [s.code, s]));
  const marcas: MarcaNoDente[] = [];
  for (const f of feitos) {
    const s = porCodigo.get(f.efeito);
    if (!s) continue;
    const naFace = s.appliesTo === "face" && f.faces.length > 0;
    marcas.push({
      dente: f.dente,
      faces: naFace ? f.faces : [],
      local: naFace ? "face" : s.appliesTo === "face" ? "crown" : s.appliesTo,
      situacao: "existente",
      codigo: s.code,
      simbolo: s.symbol,
      nome: `${s.name} (feito em ${dia(f.feitoEm)})`,
      feito: true,
    });
  }
  return marcas;
}

// -- OD6 (J2): o odontograma de um dia do passado --------------------------------

/** A sessão com o histórico (`odontogram_session_history`, 0315): quando nasceu
 *  e as vezes em que o atendimento registrou que ela foi feita. */
export type SessaoComHistorico = SessaoDoOdontograma & {
  createdAt: string;
  /** Os registros de "feita" dos atendimentos — a refação apaga a data da
   *  sessão (0143), estes ficam. */
  registrosFeita: string[];
};

/**
 * As sessões como estavam no FIM de um instante: só as que já existiam; feita
 * se havia registro de feita (ou a data da sessão) até ali. Limite declarado:
 * entre uma refação e o novo "feita" a sessão ainda conta como feita (o banco
 * não guarda quando a refação a reabriu).
 */
export function sessoesNoDia(historico: SessaoComHistorico[], ate: string): SessaoDoOdontograma[] {
  const limite = new Date(ate).getTime();
  return historico
    .filter((s) => new Date(s.createdAt).getTime() <= limite)
    .map((s) => {
      const vezes = [...s.registrosFeita, ...(s.doneAt ? [s.doneAt] : [])]
        .filter((t) => new Date(t).getTime() <= limite)
        .sort();
      const feita = vezes.at(-1) ?? null;
      return {
        sessionId: s.sessionId,
        itemId: s.itemId,
        procedureId: s.procedureId,
        // cancelada continua cancelada; o resto é feita ou a fazer naquele dia
        status: s.status === "cancelled" ? "cancelled" : feita ? "done" : "pending",
        doneAt: feita,
        toothCode: s.toothCode,
        faceCodes: s.faceCodes,
        regionCode: s.regionCode,
      };
    });
}

/** Os achados como estavam até o instante (decididos até ali). */
export function achadosAte(achados: Achado[], ate: string): Achado[] {
  const limite = new Date(ate).getTime();
  return achados.filter((a) => a.decididoEm !== null && new Date(a.decididoEm).getTime() <= limite);
}

/** "16 (O)", "Dente 46", "Arcada superior" — o lugar da sessão (nulo = sem dente). */
export function localDaSessao(
  s: Pick<SessaoDoOdontograma, "toothCode" | "faceCodes" | "regionCode">,
  nomeDaRegiao?: (codigo: string) => string | undefined
): string | null {
  if (s.toothCode) return s.faceCodes.length ? `${s.toothCode} (${s.faceCodes.join(", ")})` : `Dente ${s.toothCode}`;
  if (s.regionCode) return nomeDaRegiao?.(s.regionCode) ?? `Região ${s.regionCode}`;
  return null;
}

/** "Implante — Dente 46 · Sessão 2 de 3": o nome da sessão com o lugar. */
export function rotuloDaSessao(base: string, local: string | null): string {
  if (!local) return base;
  const i = base.indexOf(" — ");
  return i < 0 ? `${base} — ${local}` : `${base.slice(0, i)} — ${local} · ${base.slice(i + 3)}`;
}
