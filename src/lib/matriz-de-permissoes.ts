// A TELA DE PERMISSÕES, SEM A TELA (relato OC-00002, 14/10/2026).
//
// O dono pediu: "tornar padrão" o que aparece como fora do padrão; ver UMA
// função por vez; ver UMA permissão e quais funções têm e não têm; e uma tela
// mais fácil. Toda conta dessas perguntas mora aqui, pura e com teste — o
// componente só desenha.
//
// DOIS "PADRÕES", e a diferença importa:
//   - o de FÁBRICA, escrito no código (`Capability.padrao`): o comportamento
//     de antes da matriz existir;
//   - o FIXADO pelo dono no banco (`permission_defaults`, 0292), pelo botão
//     "Tornar padrão".
// O padrão que vale (o "efetivo") é o fixado, quando existe; senão, o de
// fábrica. É contra ele que o selo "fora do padrão" compara, e é para ele que
// "voltar ao padrão" volta.

import type { Capability, MatrizPermissoes } from "@/lib/permissions";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";

export type PadraoFixado = { roles: UserRole[]; updatedAt: string | null };

/** O padrão que vale: o fixado pelo dono quando existe, senão o de fábrica. */
export function padraoEfetivo(
  fabrica: MatrizPermissoes,
  fixados: Readonly<Record<string, PadraoFixado>>
): MatrizPermissoes {
  const saida: MatrizPermissoes = {};
  for (const [cap, roles] of Object.entries(fabrica)) {
    saida[cap] = [...(fixados[cap]?.roles ?? roles)];
  }
  return saida;
}

/** De onde veio o padrão desta permissão. */
export function origemDoPadrao(
  capacidade: string,
  fixados: Readonly<Record<string, PadraoFixado>>
): "fixado" | "fabrica" {
  return fixados[capacidade] ? "fixado" : "fabrica";
}

/** Mesmo conjunto de funções, sem olhar a ordem nem repetição. */
export function mesmoConjunto(a: readonly string[], b: readonly string[]): boolean {
  const x = new Set(a);
  const y = new Set(b);
  if (x.size !== y.size) return false;
  for (const v of x) if (!y.has(v)) return false;
  return true;
}

export function temAcesso(matriz: MatrizPermissoes, capacidade: string, papel: UserRole): boolean {
  return (matriz[capacidade] ?? []).includes(papel);
}

/** A permissão inteira difere do padrão? */
export function foraDoPadrao(
  matriz: MatrizPermissoes,
  padrao: MatrizPermissoes,
  capacidade: string
): boolean {
  return !mesmoConjunto(matriz[capacidade] ?? [], padrao[capacidade] ?? []);
}

/** Só a casinha desta função difere do padrão? (vista "por função") */
export function casaForaDoPadrao(
  matriz: MatrizPermissoes,
  padrao: MatrizPermissoes,
  capacidade: string,
  papel: UserRole
): boolean {
  return temAcesso(matriz, capacidade, papel) !== temAcesso(padrao, capacidade, papel);
}

/** Liga ou desliga UMA função numa permissão — devolve a matriz nova, sem mexer na velha. */
export function alternar(
  matriz: MatrizPermissoes,
  capacidade: string,
  papel: UserRole
): MatrizPermissoes {
  const atuais = matriz[capacidade] ?? [];
  return {
    ...matriz,
    [capacidade]: atuais.includes(papel) ? atuais.filter((p) => p !== papel) : [...atuais, papel],
  };
}

/** Põe no rascunho o padrão desta permissão (o salvar continua sendo da barra). */
export function voltarAoPadrao(
  matriz: MatrizPermissoes,
  padrao: MatrizPermissoes,
  capacidade: string
): MatrizPermissoes {
  return { ...matriz, [capacidade]: [...(padrao[capacidade] ?? [])] };
}

export type Mudanca = {
  capacidade: string;
  papel: UserRole;
  passa: "ganha" | "perde";
};

/**
 * O que o rascunho muda em relação ao gravado — uma linha por casinha, na
 * ordem da tela (catálogo, depois funções). É o que a barra de alterações
 * lista antes de salvar.
 */
export function mudancas(
  gravado: MatrizPermissoes,
  rascunho: MatrizPermissoes,
  capacidades: readonly Capability[],
  papeis: readonly UserRole[]
): Mudanca[] {
  const saida: Mudanca[] = [];
  for (const c of capacidades) {
    for (const p of papeis) {
      const antes = temAcesso(gravado, c.id, p);
      const depois = temAcesso(rascunho, c.id, p);
      if (antes !== depois) saida.push({ capacidade: c.id, papel: p, passa: depois ? "ganha" : "perde" });
    }
  }
  return saida;
}

/** As permissões que precisam ser gravadas, cada uma com o conjunto INTEIRO de funções. */
export function permissoesParaSalvar(
  gravado: MatrizPermissoes,
  rascunho: MatrizPermissoes,
  capacidades: readonly Capability[]
): { capacidade: string; papeis: UserRole[] }[] {
  return capacidades
    .filter((c) => !mesmoConjunto(gravado[c.id] ?? [], rascunho[c.id] ?? []))
    .map((c) => ({ capacidade: c.id, papeis: [...(rascunho[c.id] ?? [])] }));
}

/** A frase de uma mudança, para quem vai salvar. */
export function fraseDaMudanca(m: Mudanca, capacidades: readonly Capability[]): string {
  const cap = capacidades.find((c) => c.id === m.capacidade);
  const nome = cap?.rotulo ?? m.capacidade;
  return m.passa === "ganha"
    ? `${ROLE_LABELS[m.papel]} passa a ter “${nome}”`
    : `${ROLE_LABELS[m.papel]} perde “${nome}”`;
}

/** Sem acento e sem caixa: "relatorio" acha "Relatórios". */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export type FiltroDePermissoes = {
  busca?: string;
  /** Nome do grupo; vazio = todos. */
  grupo?: string;
  /** Só as permissões que diferem do padrão. */
  soForaDoPadrao?: boolean;
};

/** As permissões que a tela mostra com os filtros escolhidos, na ordem do catálogo. */
export function filtrarPermissoes(
  capacidades: readonly Capability[],
  filtro: FiltroDePermissoes,
  matriz: MatrizPermissoes,
  padrao: MatrizPermissoes
): Capability[] {
  const termos = normalizar(filtro.busca ?? "").split(/\s+/).filter(Boolean);
  return capacidades.filter((c) => {
    if (filtro.grupo && c.grupo !== filtro.grupo) return false;
    if (filtro.soForaDoPadrao && !foraDoPadrao(matriz, padrao, c.id)) return false;
    if (termos.length === 0) return true;
    const texto = normalizar(`${c.rotulo} ${c.descricao} ${c.grupo}`);
    return termos.every((t) => texto.includes(t));
  });
}

/** Quantas permissões cada função tem. */
export function quantasPorFuncao(
  matriz: MatrizPermissoes,
  capacidades: readonly Capability[],
  papeis: readonly UserRole[]
): Record<UserRole, number> {
  const saida = Object.fromEntries(papeis.map((p) => [p, 0])) as Record<UserRole, number>;
  for (const c of capacidades) for (const p of papeis) if (temAcesso(matriz, c.id, p)) saida[p] += 1;
  return saida;
}

/** Quem tem e quem não tem uma permissão (vista "por permissão"), na ordem das funções. */
export function quemTem(
  matriz: MatrizPermissoes,
  capacidade: string,
  papeis: readonly UserRole[]
): { com: UserRole[]; sem: UserRole[] } {
  const com: UserRole[] = [];
  const sem: UserRole[] = [];
  for (const p of papeis) (temAcesso(matriz, capacidade, p) ? com : sem).push(p);
  return { com, sem };
}

/** As permissões que diferem do padrão — o que "Tornar tudo padrão" fixaria. */
export function todasForaDoPadrao(
  matriz: MatrizPermissoes,
  padrao: MatrizPermissoes,
  capacidades: readonly Capability[]
): string[] {
  return capacidades.filter((c) => foraDoPadrao(matriz, padrao, c.id)).map((c) => c.id);
}
