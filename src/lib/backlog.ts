/**
 * O BACKLOG NA TELA (BK2) — regras puras: rótulos, cores, ordem, filtro e
 * contagem. A tela Administração → Backlog e o detalhe do item usam as mesmas,
 * para a mesma situação nunca ter duas cores nem duas contas.
 *
 * O banco é a 0366 (`backlog_items`, `backlog_categories`,
 * `backlog_item_events`); o comando das sessões é `scripts/backlog.mjs`.
 * Teste: `backlog.test.ts`.
 */
import { atendeABusca } from "@/lib/busca";

export const PRIORIDADES = ["urgente", "alta", "media", "baixa"] as const;
export type Prioridade = (typeof PRIORIDADES)[number];

export const SITUACOES = ["aberto", "aguardando_dono", "em_andamento", "resolvido", "descartado"] as const;
export type SituacaoDoItem = (typeof SITUACOES)[number];

export const PRIORIDADE_ROTULO: Record<Prioridade, string> = {
  urgente: "Urgente",
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

export const PRIORIDADE_EXPLICA: Record<Prioridade, string> = {
  urgente: "Impede o trabalho, ou é risco de segurança ou LGPD",
  alta: "Atrapalha o trabalho ou pode dar dado errado",
  media: "Incomoda, tem contorno",
  baixa: "Quando der",
};

export const SITUACAO_ROTULO: Record<SituacaoDoItem, string> = {
  aberto: "Aberto",
  aguardando_dono: "Aguardando você",
  em_andamento: "Em andamento",
  resolvido: "Resolvido",
  descartado: "Descartado",
};

export const COR_DA_PRIORIDADE: Record<Prioridade, string> = {
  urgente: "bg-red-500/15 text-red-700 dark:text-red-400",
  alta: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  media: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  baixa: "bg-muted text-muted-foreground",
};

export const COR_DA_SITUACAO: Record<SituacaoDoItem, string> = {
  aberto: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  aguardando_dono: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  em_andamento: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
  resolvido: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  descartado: "bg-muted text-muted-foreground",
};

export type ItemDoBacklog = {
  code: string;
  title: string;
  category: string;
  categoryId: string;
  module: string | null;
  priority: Prioridade;
  status: SituacaoDoItem;
  origin: string;
  foundOn: string;
  resolvedAt: string | null;
  resolvedVersion: string | null;
  updatedAt: string;
};

export type CategoriaDoBacklog = {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
};

export function estaFechado(status: SituacaoDoItem): boolean {
  return status === "resolvido" || status === "descartado";
}

/** O número do código (AP56 → 56) — a ordem natural, não a do texto. */
export function numeroDoCodigo(code: string): number {
  const n = Number(code.replace(/^AP/i, ""));
  return Number.isFinite(n) ? n : 0;
}

export type Aba = "abertos" | "resolvidos" | "todos";

export type Filtro = {
  aba: Aba;
  categoria: string | null;
  prioridade: Prioridade | null;
  modulo: string | null;
  situacao: SituacaoDoItem | null;
  busca: string;
};

export const FILTRO_INICIAL: Filtro = {
  aba: "abertos",
  categoria: null,
  prioridade: null,
  modulo: null,
  situacao: null,
  busca: "",
};

export function filtrar(itens: ItemDoBacklog[], f: Filtro): ItemDoBacklog[] {
  return itens.filter((i) => {
    if (f.aba === "abertos" && estaFechado(i.status)) return false;
    if (f.aba === "resolvidos" && !estaFechado(i.status)) return false;
    if (f.categoria && i.categoryId !== f.categoria) return false;
    if (f.prioridade && i.priority !== f.prioridade) return false;
    if (f.modulo && (i.module ?? "") !== f.modulo) return false;
    if (f.situacao && i.status !== f.situacao) return false;
    if (f.busca.trim() && !atendeABusca(`${i.code} ${i.title} ${i.category}`, f.busca)) return false;
    return true;
  });
}

/**
 * Abertos: a prioridade manda (Urgente primeiro), depois o mais antigo.
 * Resolvidos: o fechado mais recentemente primeiro.
 */
export function ordenar(itens: ItemDoBacklog[]): ItemDoBacklog[] {
  return [...itens].sort((a, b) => {
    const fa = estaFechado(a.status);
    const fb = estaFechado(b.status);
    if (fa !== fb) return fa ? 1 : -1;
    if (!fa) {
      const p = PRIORIDADES.indexOf(a.priority) - PRIORIDADES.indexOf(b.priority);
      if (p !== 0) return p;
      return numeroDoCodigo(a.code) - numeroDoCodigo(b.code);
    }
    const ra = a.resolvedAt ?? "";
    const rb = b.resolvedAt ?? "";
    if (ra !== rb) return ra < rb ? 1 : -1;
    return numeroDoCodigo(b.code) - numeroDoCodigo(a.code);
  });
}

export type Contagem = {
  abertos: number;
  resolvidos: number;
  todos: number;
  aguardandoDono: number;
  porPrioridade: Record<Prioridade, number>;
};

/** Os números do topo — sempre sobre a lista INTEIRA, nunca a filtrada. */
export function contar(itens: ItemDoBacklog[]): Contagem {
  const porPrioridade: Record<Prioridade, number> = { urgente: 0, alta: 0, media: 0, baixa: 0 };
  let abertos = 0;
  let aguardandoDono = 0;
  for (const i of itens) {
    if (estaFechado(i.status)) continue;
    abertos++;
    porPrioridade[i.priority]++;
    if (i.status === "aguardando_dono") aguardandoDono++;
  }
  return { abertos, resolvidos: itens.length - abertos, todos: itens.length, aguardandoDono, porPrioridade };
}

/** Rótulo de cada tipo de evento da linha do tempo. */
export const EVENTO_ROTULO: Record<string, string> = {
  criado: "Registrado",
  importado: "Importado do arquivo antigo",
  titulo: "Título mudou",
  detalhe: "Detalhe reescrito",
  categoria: "Categoria mudou",
  modulo: "Módulo mudou",
  prioridade: "Prioridade mudou",
  situacao: "Situação mudou",
  nota: "Nota",
  relato: "Relato ligado",
};

/** De/para legível: prioridade e situação viram os rótulos da tela. */
export function valorDoEvento(kind: string, valor: string | null): string | null {
  if (valor == null) return null;
  if (kind === "prioridade" && valor in PRIORIDADE_ROTULO) return PRIORIDADE_ROTULO[valor as Prioridade];
  if ((kind === "situacao" || kind === "importado") && valor in SITUACAO_ROTULO) {
    return SITUACAO_ROTULO[valor as SituacaoDoItem];
  }
  return valor;
}

/** A mensagem do banco → a frase da tela. */
export function mensagemDoErro(msg: string): string {
  if (/NOT_ALLOWED|permission denied/.test(msg)) return "Só o Admin Master mexe no backlog.";
  if (/ITEM_NOT_FOUND/.test(msg)) return "Este item não existe mais.";
  if (/CATEGORY_NOT_FOUND/.test(msg)) return "Essa categoria não existe.";
  if (/CATEGORY_EXISTS/.test(msg)) return "Já existe uma categoria com esse nome.";
  if (/NAME_REQUIRED/.test(msg)) return "Escreva o nome da categoria.";
  if (/STATUS_NOT_FOR_NEW_ITEM/.test(msg)) return "Item novo não nasce resolvido.";
  if (/backlog_items_title_ok/.test(msg)) return "O título é obrigatório (até 300 letras).";
  return "Não foi possível gravar. Tente de novo.";
}
