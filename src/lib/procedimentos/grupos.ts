// GRUPOS DE PROCEDIMENTOS (0324; plano e decisões GP1–GP3 em
// docs/procedimentos/GRUPOS-PLANO.md).
//
// O grupo é um ATALHO de lançamento, não um procedimento: não tem preço,
// repasse, kit nem regra de dente. Ao usar o grupo, cada procedimento vira um
// item normal do plano — preço do catálogo, sessões do protocolo e a mesma
// régua do dente (`odontograma/plano.ts` = 0311). Esta peça só MONTA as
// linhas; quem confere é o banco, como num lançamento à mão.

import {
  conflitosDeSituacao,
  ehPorDente,
  ehPorRegiao,
  itensPorDente,
  previstosNoDente,
  textoDoConflito,
  type DenteDaReferencia,
  type RegraDoPlano,
} from "@/lib/odontograma/plano";

export const MINIMO_NO_GRUPO = 2;
export const MAXIMO_NO_GRUPO = 30;
export const QUANTIDADE_MAXIMA = 20;

export type ItemDoGrupo = {
  procedureId: string;
  /** Vale para procedimento SEM dente; o de dente entra uma vez por dente. */
  quantidade: number;
  /** Nome no catálogo (lido junto — para nomear até o que saiu dele). */
  nome: string;
  /** O procedimento ainda está ativo no catálogo? */
  ativo: boolean;
};

export type GrupoDeProcedimentos = {
  id: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  /** Na ordem de lançar — a ordem importa (implante antes da prótese). */
  itens: ItemDoGrupo[];
};

/** A mesma régua de `save_procedure_group` (0324), para avisar antes de gravar. */
export function validarGrupo(
  nome: string,
  itens: { procedureId: string; quantidade: number }[]
): string | null {
  if (nome.trim().length < 3) return "Dê um nome ao grupo (pelo menos 3 letras).";
  if (itens.length < MINIMO_NO_GRUPO) return "Um grupo junta pelo menos 2 procedimentos.";
  if (itens.length > MAXIMO_NO_GRUPO) return `Um grupo tem no máximo ${MAXIMO_NO_GRUPO} procedimentos.`;
  const vistos = new Set<string>();
  for (const i of itens) {
    if (!i.procedureId) return "Escolha o procedimento de cada linha.";
    if (vistos.has(i.procedureId)) return "O mesmo procedimento está duas vezes — use a quantidade.";
    vistos.add(i.procedureId);
    if (!Number.isInteger(i.quantidade) || i.quantidade < 1 || i.quantidade > QUANTIDADE_MAXIMA) {
      return `A quantidade vai de 1 a ${QUANTIDADE_MAXIMA}.`;
    }
  }
  return null;
}

/** Os códigos das funções da 0324 em pt-BR. Nulo = erro que não é delas. */
export function mensagemDoGrupo(erro: string): string | null {
  // Função ou tabela que não existe = o banco ainda não recebeu a 0324.
  if (/could not find the function|schema cache|procedure_group\w* does not exist/i.test(erro)) {
    return "O banco ainda não recebeu a atualização 0324 (grupos de procedimentos).";
  }
  const m: [string, string][] = [
    ["NOT_ALLOWED", "Só o Admin Master e o Planner mexem nos grupos."],
    ["NAME_REQUIRED", "Dê um nome ao grupo (pelo menos 3 letras)."],
    ["GROUP_NEEDS_TWO", "Um grupo junta pelo menos 2 procedimentos."],
    ["GROUP_TOO_BIG", `Um grupo tem no máximo ${MAXIMO_NO_GRUPO} procedimentos.`],
    ["GROUP_NAME_TAKEN", "Já existe um grupo com esse nome (talvez inativo)."],
    ["PROCEDURE_NOT_ACTIVE", "Um dos procedimentos está inativo no catálogo — tire-o do grupo."],
    ["PROCEDURE_REPEATED", "O mesmo procedimento está duas vezes — use a quantidade."],
    ["INVALID_QUANTITY", `A quantidade vai de 1 a ${QUANTIDADE_MAXIMA}.`],
    ["GROUP_NOT_FOUND", "Grupo não encontrado (alguém pode tê-lo excluído)."],
    ["GROUP_IN_USE", "Este grupo já foi usado em planos: inative em vez de excluir."],
  ];
  return m.find(([codigo]) => erro.includes(codigo))?.[1] ?? null;
}

/**
 * O que entra no plano: só o que está no catálogo da unidade (ativo, com
 * preço). O resto é NOMEADO — pular em silêncio faria o Planner achar que
 * lançou o grupo inteiro.
 */
export function oQueEntra<P extends { id: string }>(
  grupo: GrupoDeProcedimentos,
  catalogo: P[]
): { entram: (ItemDoGrupo & { procedimento: P })[]; ficamDeFora: string[] } {
  const porId = new Map(catalogo.map((p) => [p.id, p]));
  const entram: (ItemDoGrupo & { procedimento: P })[] = [];
  const ficamDeFora: string[] = [];
  for (const i of grupo.itens) {
    const p = i.ativo ? porId.get(i.procedureId) : undefined;
    if (p) entram.push({ ...i, procedimento: p });
    else ficamDeFora.push(i.nome);
  }
  return { entram, ficamDeFora };
}

/** Uma linha do lançamento = um item do plano. */
export type LinhaDoGrupo = {
  procedureId: string;
  quantidade: number;
  tooth: string | null;
  faces: string[];
  regionCode: string | null;
};

export type LugarDoGrupo = {
  /** Os dentes, escolhidos UMA vez para todos os procedimentos de dente. */
  dentes: string[];
  /** Faces de cada procedimento de face (o mesmo para todos os dentes). */
  facesPorProcedimento: Record<string, string[]>;
  /** Região/arcada de cada procedimento de região. */
  regiaoPorProcedimento: Record<string, string>;
};

/**
 * Monta as linhas do lançamento, na ordem do grupo. Os procedimentos de dente
 * saem DENTE A DENTE ("36: implante, prótese; 46: implante, prótese"): a régua
 * do dente aceita a prótese porque o implante do MESMO dente entrou antes, na
 * mesma gravação (provado no ensaio da 0324).
 *
 * `regras` nulo = o odontograma não carregou: tudo entra sem lugar, e o envio
 * para aprovação vai pedir (o mesmo recado do lançamento à mão).
 */
export function montarLancamento(p: {
  itens: { procedureId: string; quantidade: number; nome: string }[];
  regras: Record<string, RegraDoPlano> | null;
  lugar: LugarDoGrupo;
  referencia: Record<string, DenteDaReferencia>;
  facesPorDente: Record<string, string[]>;
  atuaisPorDente: Record<string, string[]>;
  itensDaOpcao: { id: string; procedureId: string | null; toothCode: string | null }[];
  nomeDaSituacao: (codigo: string) => string;
}): { linhas: LinhaDoGrupo[]; problemas: string[]; conflitos: string[]; pedeDente: boolean } {
  const regras = p.regras;
  const linhas: LinhaDoGrupo[] = [];
  const problemas: string[] = [];
  const conflitos: string[] = [];
  const deDente = regras ? p.itens.filter((i) => ehPorDente(regras[i.procedureId])) : [];
  const pedeDente = deDente.length > 0;
  let blocoDosDentesFeito = false;

  for (const i of p.itens) {
    const regra = regras?.[i.procedureId] ?? null;
    if (regras && ehPorDente(regra)) {
      if (blocoDosDentesFeito) continue;
      blocoDosDentesFeito = true;
      if (p.lugar.dentes.length === 0) {
        problemas.push("Escolha o(s) dente(s) no desenho.");
        continue;
      }
      // Cada dente com os seus, na ordem do grupo.
      const porProcedimento = new Map(
        deDente.map((d) => {
          const r = regras[d.procedureId];
          const m = itensPorDente(r, p.lugar.dentes, p.lugar.facesPorProcedimento[d.procedureId] ?? [], p.referencia, p.facesPorDente);
          for (const x of new Set(m.problemas)) problemas.push(`${d.nome}: ${x}`);
          return [d.procedureId, new Map(m.itens.map((it) => [it.tooth, it.faces]))] as const;
        })
      );
      const jaNaOpcao = [...p.itensDaOpcao];
      for (const dente of p.lugar.dentes) {
        for (const d of deDente) {
          const faces = porProcedimento.get(d.procedureId)?.get(dente);
          if (!faces) continue; // forma recusada: já está nos problemas
          const c = conflitosDeSituacao(regras[d.procedureId], p.atuaisPorDente[dente] ?? [], previstosNoDente(jaNaOpcao, regras, dente));
          const texto = textoDoConflito(dente, c, p.nomeDaSituacao);
          if (texto) conflitos.push(`${d.nome} — ${texto}`);
          linhas.push({ procedureId: d.procedureId, quantidade: 1, tooth: dente, faces, regionCode: null });
          // O que acabou de entrar conta para o próximo do mesmo dente.
          jaNaOpcao.push({ id: `grupo-${linhas.length}`, procedureId: d.procedureId, toothCode: dente });
        }
      }
      continue;
    }
    if (regras && ehPorRegiao(regra)) {
      const regiao = p.lugar.regiaoPorProcedimento[i.procedureId] ?? "";
      if (!regiao) {
        problemas.push(`${i.nome}: escolha ${regra?.nivel === "arch" ? "a arcada" : "a região"}.`);
        continue;
      }
      linhas.push({ procedureId: i.procedureId, quantidade: 1, tooth: null, faces: [], regionCode: regiao });
      continue;
    }
    // Sem marcação no dente (ou sem odontograma): a quantidade do grupo.
    linhas.push({ procedureId: i.procedureId, quantidade: i.quantidade, tooth: null, faces: [], regionCode: null });
  }
  return { linhas, problemas, conflitos, pedeDente };
}

/** Sessões e tempo sugeridos de cada linha: a base do protocolo × a quantidade. */
export function baseDaLinha(
  linha: LinhaDoGrupo,
  protocolo: { count: number; minutes: number } | null
): { sessoes: number | null; minutos: number | null } {
  if (!protocolo) return { sessoes: null, minutos: null };
  return { sessoes: protocolo.count * linha.quantidade || null, minutos: protocolo.minutes * linha.quantidade || null };
}

/** O total que o lançamento soma, pelo preço do catálogo de hoje (referência). */
export function totalDoLancamento(linhas: LinhaDoGrupo[], precoDe: (procedureId: string) => number): number {
  return linhas.reduce((soma, l) => soma + precoDe(l.procedureId) * l.quantidade, 0);
}
