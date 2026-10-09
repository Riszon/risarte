// RELATÓRIO DE ATIVIDADE (0289) — a parte que organiza e desenha.
//
// O banco devolve um número por pessoa e por dia (`audit_activity_report`):
// acessos, tempo em uso, ações nas telas, alterações. Aqui isso vira as duas
// leituras que o dono pediu — "o que cada pessoa fez no período" e "cada dia
// em que ela acessou" — e o MESMO modelo serve à tela e à planilha (lição do
// OC-00009: duas montagens da mesma informação divergem na primeira mudança).
//
// Puro e testado: nada de banco, nada de React, nada de ExcelJS.

import { duracao } from "@/lib/acesso";
import { BRAZIL_TIME_ZONE, addDaysIso, formatIsoDateBr } from "@/lib/dates";
import type {
  ColunaDoRelatorio,
  LinhaDoRelatorio,
  RelatorioPronto,
} from "@/lib/finance/relatorio";

/** Uma pessoa num dia. É o que o banco devolve, com nomes de gente. */
export type LinhaDeAtividade = {
  usuario: string;
  dia: string;
  acessos: number;
  primeiroAcesso: string | null;
  ultimaAtividade: string | null;
  emUsoS: number;
  totalS: number;
  porInatividade: number;
  porViradaDoDia: number;
  acoes: number;
  consultas: number;
  exportacoes: number;
  cadastrou: number;
  alterou: number;
  excluiu: number;
  registros: number;
};

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const txt = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * Lê a resposta do banco. `null` = não consegui ler (função ausente, erro) —
 * diferente de lista vazia, que é "ninguém fez nada". A tela trata os dois de
 * jeitos diferentes: um avisa, o outro informa.
 */
export function lerLinhasDeAtividade(dados: unknown): LinhaDeAtividade[] | null {
  if (!Array.isArray(dados)) return null;
  const linhas: LinhaDeAtividade[] = [];
  for (const d of dados) {
    if (typeof d !== "object" || d === null) return null;
    const r = d as Record<string, unknown>;
    const usuario = txt(r.user_id);
    const dia = txt(r.day);
    if (!usuario || !dia || !DATA.test(dia)) return null;
    linhas.push({
      usuario,
      dia,
      acessos: num(r.sessions),
      primeiroAcesso: txt(r.first_access),
      ultimaAtividade: txt(r.last_activity),
      emUsoS: num(r.active_seconds),
      totalS: num(r.total_seconds),
      porInatividade: num(r.idle_logouts),
      porViradaDoDia: num(r.day_change_logouts),
      acoes: num(r.actions),
      consultas: num(r.views),
      exportacoes: num(r.exports),
      cadastrou: num(r.inserts),
      alterou: num(r.updates),
      excluiu: num(r.deletes),
      registros: num(r.rows_touched),
    });
  }
  return linhas;
}

/** Tempo com a tela aberta e sem uso: o total do acesso menos o tempo em uso. */
export function paradoS(l: Pick<LinhaDeAtividade, "totalS" | "emUsoS">): number {
  return Math.max(0, l.totalS - l.emUsoS);
}

export function alteracoesDe(
  l: Pick<LinhaDeAtividade, "cadastrou" | "alterou" | "excluiu">
): number {
  return l.cadastrou + l.alterou + l.excluiu;
}

// ---------------------------------------------------------------- período

export const MAXIMO_DE_DIAS = 92;
export const DIAS_PADRAO = 7;

export type PeriodoDoRelatorio = {
  de: string;
  ate: string;
  dias: number;
  /** O período pedido era maior que o máximo e foi encurtado. */
  encurtado: boolean;
};

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000) + 1;
}

const dataValida = (v: unknown): v is string =>
  typeof v === "string" && DATA.test(v) && !Number.isNaN(Date.parse(v));

/**
 * O período do relatório, sempre válido: sem datas, os últimos 7 dias;
 * invertido, desinverte; no futuro, para em hoje; maior que 92 dias, fica com
 * os 92 MAIS RECENTES e avisa (cortar em silêncio seria mostrar um total que
 * não é o do período pedido).
 */
export function lerPeriodoDoRelatorio(
  de: unknown,
  ate: unknown,
  hoje: string
): PeriodoDoRelatorio {
  let fim = dataValida(ate) ? ate : hoje;
  if (fim > hoje) fim = hoje;
  let inicio = dataValida(de) ? de : addDaysIso(fim, -(DIAS_PADRAO - 1));
  if (inicio > fim) [inicio, fim] = [fim, inicio > hoje ? hoje : inicio];
  let encurtado = false;
  if (diasEntre(inicio, fim) > MAXIMO_DE_DIAS) {
    inicio = addDaysIso(fim, -(MAXIMO_DE_DIAS - 1));
    encurtado = true;
  }
  return { de: inicio, ate: fim, dias: diasEntre(inicio, fim), encurtado };
}

export const MODOS = ["pessoa", "dia"] as const;
export type ModoDoRelatorio = (typeof MODOS)[number];

export const MODO_ROTULO: Record<ModoDoRelatorio, string> = {
  pessoa: "Resumo por pessoa",
  dia: "Dia a dia",
};

export function lerModo(v: unknown): ModoDoRelatorio {
  return v === "dia" ? "dia" : "pessoa";
}

// --------------------------------------------------------------- por pessoa

export type ResumoDaPessoa = {
  usuario: string;
  /** Dias em que ENTROU no sistema (o pedido do dono: "cada dia que fez o acesso"). */
  diasComAcesso: number;
  acessos: number;
  emUsoS: number;
  paradoS: number;
  porInatividade: number;
  acoes: number;
  consultas: number;
  exportacoes: number;
  cadastrou: number;
  alterou: number;
  excluiu: number;
  /** O dia mais recente com acesso ou atividade. */
  ultimoDia: string;
};

/** Soma o período de cada pessoa. Quem mais usou vem primeiro. */
export function resumirPorPessoa(linhas: LinhaDeAtividade[]): ResumoDaPessoa[] {
  const mapa = new Map<string, ResumoDaPessoa>();
  for (const l of linhas) {
    let r = mapa.get(l.usuario);
    if (!r) {
      r = {
        usuario: l.usuario,
        diasComAcesso: 0,
        acessos: 0,
        emUsoS: 0,
        paradoS: 0,
        porInatividade: 0,
        acoes: 0,
        consultas: 0,
        exportacoes: 0,
        cadastrou: 0,
        alterou: 0,
        excluiu: 0,
        ultimoDia: l.dia,
      };
      mapa.set(l.usuario, r);
    }
    if (l.acessos > 0) r.diasComAcesso++;
    r.acessos += l.acessos;
    r.emUsoS += l.emUsoS;
    r.paradoS += paradoS(l);
    r.porInatividade += l.porInatividade;
    r.acoes += l.acoes;
    r.consultas += l.consultas;
    r.exportacoes += l.exportacoes;
    r.cadastrou += l.cadastrou;
    r.alterou += l.alterou;
    r.excluiu += l.excluiu;
    if (l.dia > r.ultimoDia) r.ultimoDia = l.dia;
  }
  return [...mapa.values()].sort(
    (a, b) => b.emUsoS - a.emUsoS || b.acoes - a.acoes || a.usuario.localeCompare(b.usuario)
  );
}

/** Quem tem acesso ativo e NÃO apareceu no período — a inatividade de verdade. */
export function semAtividade(
  ativos: string[],
  linhas: Pick<LinhaDeAtividade, "usuario">[]
): string[] {
  const viu = new Set(linhas.map((l) => l.usuario));
  return ativos.filter((u) => !viu.has(u));
}

/**
 * A ordem do "dia a dia": o dia mais recente primeiro e, dentro do dia, as
 * pessoas em ordem alfabética — a mesma na tela e na planilha.
 */
export function ordenarDiaADia(
  linhas: LinhaDeAtividade[],
  nomes: Map<string, string>
): LinhaDeAtividade[] {
  const nome = (id: string) => nomes.get(id) ?? "";
  return [...linhas].sort(
    (a, b) =>
      b.dia.localeCompare(a.dia) ||
      nome(a.usuario).localeCompare(nome(b.usuario), "pt-BR") ||
      a.usuario.localeCompare(b.usuario)
  );
}

// ------------------------------------------------------- o modelo (tela + planilha)

/** "08:42" no relógio de Brasília; vazio quando não houve acesso no dia. */
export function horaBr(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", {
    timeZone: BRAZIL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

const minutos = (s: number) => Math.round(s / 60);

export type QuemEQuem = {
  /** id → nome. */
  nomes: Map<string, string>;
  /** id → código do Risartano. */
  codigos: Map<string, string>;
};

const COLUNAS_COMUNS: ColunaDoRelatorio[] = [
  { chave: "acessos", titulo: "Acessos (logins)", tipo: "numero", somar: true, largura: 10 },
  { chave: "emUsoMin", titulo: "Em uso (min)", tipo: "numero", somar: true, largura: 10 },
  { chave: "paradoMin", titulo: "Parado (min)", tipo: "numero", somar: true, largura: 10 },
  { chave: "porInatividade", titulo: "Desconexões por inatividade", tipo: "numero", somar: true, largura: 13 },
  { chave: "acoes", titulo: "Ações nas telas", tipo: "numero", somar: true, largura: 10 },
  { chave: "consultas", titulo: "das quais: consultas", tipo: "numero", somar: true, largura: 11 },
  { chave: "exportacoes", titulo: "das quais: exportações", tipo: "numero", somar: true, largura: 12 },
  { chave: "cadastrou", titulo: "Cadastrou", tipo: "numero", somar: true, largura: 10 },
  { chave: "alterou", titulo: "Alterou", tipo: "numero", somar: true, largura: 9 },
  { chave: "excluiu", titulo: "Excluiu", tipo: "numero", somar: true, largura: 9 },
];

/**
 * O relatório pronto para a planilha (e para qualquer outra saída que leia o
 * mesmo modelo). Tempo vai em MINUTOS, como número, para o Excel somar e
 * ordenar — "1h 20min" em texto não soma.
 */
export function relatorioDeAtividade(a: {
  linhas: LinhaDeAtividade[];
  modo: ModoDoRelatorio;
  periodo: PeriodoDoRelatorio;
  quem: QuemEQuem;
  /** Nome da pessoa filtrada, quando o relatório é de uma só. */
  filtroPessoa: string | null;
  /** Quem tem acesso ativo e não apareceu (só no relatório de todos). */
  semAcesso: string[];
  geradoPor: string | null;
  /** "09/10/2026 17:40" — já no relógio de Brasília. */
  geradoEm: string;
}): RelatorioPronto {
  const nome = (id: string) => a.quem.nomes.get(id) ?? "Usuário removido";
  const codigo = (id: string) => a.quem.codigos.get(id) ?? "";

  const colunas: ColunaDoRelatorio[] =
    a.modo === "pessoa"
      ? [
          { chave: "pessoa", titulo: "Pessoa", tipo: "texto", largura: 34 },
          { chave: "codigo", titulo: "Código", tipo: "texto", largura: 13 },
          { chave: "diasComAcesso", titulo: "Dias com acesso", tipo: "numero", largura: 9 },
          { chave: "ultimoDia", titulo: "Último dia", tipo: "data", largura: 12 },
          ...COLUNAS_COMUNS,
        ]
      : [
          { chave: "dia", titulo: "Dia", tipo: "data", largura: 12 },
          { chave: "pessoa", titulo: "Pessoa", tipo: "texto", largura: 34 },
          { chave: "codigo", titulo: "Código", tipo: "texto", largura: 13 },
          { chave: "entrou", titulo: "Entrou", tipo: "texto", largura: 8 },
          { chave: "ultimaAtividade", titulo: "Última atividade", tipo: "texto", largura: 10 },
          ...COLUNAS_COMUNS,
          { chave: "registros", titulo: "Registros mexidos", tipo: "numero", largura: 10 },
        ];

  const linhas: LinhaDoRelatorio[] =
    a.modo === "pessoa"
      ? resumirPorPessoa(a.linhas).map((r) => ({
          pessoa: nome(r.usuario),
          codigo: codigo(r.usuario),
          diasComAcesso: r.diasComAcesso,
          ultimoDia: r.ultimoDia,
          acessos: r.acessos,
          emUsoMin: minutos(r.emUsoS),
          paradoMin: minutos(r.paradoS),
          porInatividade: r.porInatividade,
          acoes: r.acoes,
          consultas: r.consultas,
          exportacoes: r.exportacoes,
          cadastrou: r.cadastrou,
          alterou: r.alterou,
          excluiu: r.excluiu,
        }))
      : ordenarDiaADia(a.linhas, a.quem.nomes).map((l) => ({
          dia: l.dia,
          pessoa: nome(l.usuario),
          codigo: codigo(l.usuario),
          entrou: horaBr(l.primeiroAcesso),
          ultimaAtividade: horaBr(l.ultimaAtividade),
          acessos: l.acessos,
          emUsoMin: minutos(l.emUsoS),
          paradoMin: minutos(paradoS(l)),
          porInatividade: l.porInatividade,
          acoes: l.acoes,
          consultas: l.consultas,
          exportacoes: l.exportacoes,
          cadastrou: l.cadastrou,
          alterou: l.alterou,
          excluiu: l.excluiu,
          registros: l.registros,
        }));

  const pessoas = new Set(a.linhas.map((l) => l.usuario)).size;
  const emUso = a.linhas.reduce((s, l) => s + l.emUsoS, 0);
  const parado = a.linhas.reduce((s, l) => s + paradoS(l), 0);
  const periodoTexto = `${formatIsoDateBr(a.periodo.de)} a ${formatIsoDateBr(a.periodo.ate)} (${a.periodo.dias} dia${a.periodo.dias === 1 ? "" : "s"})`;

  const notas = [
    "Em uso: tempo em que a pessoa esteve clicando ou digitando. Parado: o resto do acesso, com a tela aberta e sem uso.",
    "Acesso ainda aberto conta até a última atividade registrada, não até a hora em que o relatório foi gerado.",
    "O tempo está em minutos, arredondado linha a linha: a soma pode diferir em 1 ou 2 minutos do total mostrado na tela.",
    "Ações nas telas: consultas, cadastros, exportações e demais atos registrados pelas telas (entrar e sair não contam aqui).",
    "Cadastrou / Alterou / Excluiu: registrados pelo banco a partir de 09/10/2026. Antes dessa data essas colunas ficam em zero.",
  ];
  if (a.periodo.encurtado) {
    notas.unshift(
      `O período pedido passava de ${MAXIMO_DE_DIAS} dias: o relatório traz os ${MAXIMO_DE_DIAS} dias mais recentes.`
    );
  }
  if (a.semAcesso.length > 0) {
    notas.push(
      `Com acesso ativo e SEM nenhum acesso no período (${a.semAcesso.length}): ${a.semAcesso.map(nome).join(", ")}.`
    );
  }

  return {
    titulo: "Relatório de atividade no sistema",
    subtitulo: MODO_ROTULO[a.modo],
    metadados: [
      { rotulo: "Período", valor: periodoTexto },
      { rotulo: "Pessoa", valor: a.filtroPessoa ?? "Todas" },
      { rotulo: "Gerado por", valor: a.geradoPor ?? "—" },
      { rotulo: "Gerado em", valor: a.geradoEm },
    ],
    resumo: [
      { rotulo: "Pessoas com acesso ou atividade", valor: String(pessoas) },
      { rotulo: "Tempo em uso (soma)", valor: duracao(emUso) },
      { rotulo: "Tempo parado (soma)", valor: duracao(parado) },
    ],
    situacao: null,
    colunas,
    linhas,
    notas,
    nomeDoArquivo: `atividade-${a.modo === "pessoa" ? "por-pessoa" : "dia-a-dia"}-${a.periodo.de}-a-${a.periodo.ate}`,
  };
}
