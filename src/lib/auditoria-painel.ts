// PAINEL DE USO DO SISTEMA (0290) — a parte que pensa.
//
// O banco devolve uma linha por pessoa (o período, o período anterior e a vida
// inteira), uma por dia e uma por dia-da-semana × hora. Aqui isso vira o que o
// dono pediu: os rankings (quem mais entrou, quem ficou mais tempo, quem mais
// fez, quem menos interagiu, quem menos entrou, quem está há mais tempo sem
// entrar) e os PONTOS DE ATENÇÃO — as frases que um painel "inteligente" tem
// de dizer sozinho, em vez de deixar a pessoa caçar na tabela.
//
// ⚠️ TEMPO EM USO NÃO É PRODUTIVIDADE. O dentista que atende o dia inteiro
// quase não toca na tela; a recepção toca o tempo todo. Por isso o painel
// compara a pessoa com ELA MESMA (período anterior) e mostra a média POR
// FUNÇÃO — nunca um ranking só como veredito.
//
// Puro e testado (`auditoria-painel.test.ts`): nada de banco, nada de React.

import { duracao } from "@/lib/acesso";
import { addDaysIso, formatIsoDateBr, isoDateIn, weekdayOf } from "@/lib/dates";
import { ROLE_LABELS, USER_ROLES } from "@/lib/roles";

// ------------------------------------------------------------------ pessoas

export type FuncaoDaPessoa = { unidade: string; funcao: string };

export type PessoaDoPainel = {
  usuario: string;
  /** Com acesso ativo (pode entrar no sistema). */
  ativa: boolean;
  admin: boolean;
  criadaEm: string | null;
  /** Último login com senha (do cadastro de acesso). */
  ultimoLogin: string | null;
  primeiroAcesso: string | null;
  ultimoAcesso: string | null;
  ultimaAtividade: string | null;
  funcoes: FuncaoDaPessoa[];
  // o período
  diasComAcesso: number;
  acessos: number;
  emUsoS: number;
  totalS: number;
  porInatividade: number;
  acoes: number;
  consultas: number;
  exportacoes: number;
  cadastrou: number;
  alterou: number;
  excluiu: number;
  // o período anterior, do mesmo tamanho
  antDias: number;
  antEmUsoS: number;
  antEventos: number;
};

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const txt = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

/** `null` = não consegui ler (função ausente) — diferente de "ninguém". */
export function lerPessoasDoPainel(dados: unknown): PessoaDoPainel[] | null {
  if (!Array.isArray(dados)) return null;
  const pessoas: PessoaDoPainel[] = [];
  for (const d of dados) {
    const r = obj(d);
    const usuario = r && txt(r.user_id);
    if (!r || !usuario) return null;
    const funcoes: FuncaoDaPessoa[] = [];
    for (const f of Array.isArray(r.roles) ? r.roles : []) {
      const o = obj(f);
      const unidade = o && txt(o.c);
      const funcao = o && txt(o.r);
      if (unidade && funcao) funcoes.push({ unidade, funcao });
    }
    pessoas.push({
      usuario,
      ativa: r.is_active === true,
      admin: r.is_admin_master === true,
      criadaEm: txt(r.created_at),
      ultimoLogin: txt(r.last_sign_in_at),
      primeiroAcesso: txt(r.first_access_at),
      ultimoAcesso: txt(r.last_access_at),
      ultimaAtividade: txt(r.last_activity_at),
      funcoes,
      diasComAcesso: num(r.days_with_access),
      acessos: num(r.sessions),
      emUsoS: num(r.active_seconds),
      totalS: num(r.total_seconds),
      porInatividade: num(r.idle_logouts),
      acoes: num(r.actions),
      consultas: num(r.views),
      exportacoes: num(r.exports),
      cadastrou: num(r.inserts),
      alterou: num(r.updates),
      excluiu: num(r.deletes),
      antDias: num(r.prev_days_with_access),
      antEmUsoS: num(r.prev_active_seconds),
      antEventos: num(r.prev_events),
    });
  }
  return pessoas;
}

/** Tudo o que a pessoa FEZ: ações nas telas + inclusões, alterações e exclusões. */
export function eventosDe(
  p: Pick<PessoaDoPainel, "acoes" | "cadastrou" | "alterou" | "excluiu">
): number {
  return p.acoes + p.cadastrou + p.alterou + p.excluiu;
}

/**
 * A última vez que a pessoa entrou: o maior entre o último acesso registrado
 * (0287, desde 09/10/2026) e o último login com senha (que existe desde
 * sempre). Sem nenhum dos dois, ela nunca entrou.
 */
export function ultimaEntrada(
  p: Pick<PessoaDoPainel, "ultimoAcesso" | "ultimoLogin">
): string | null {
  const a = p.ultimoAcesso ? Date.parse(p.ultimoAcesso) : NaN;
  const b = p.ultimoLogin ? Date.parse(p.ultimoLogin) : NaN;
  if (Number.isNaN(a) && Number.isNaN(b)) return null;
  if (Number.isNaN(b)) return p.ultimoAcesso;
  if (Number.isNaN(a)) return p.ultimoLogin;
  return a >= b ? p.ultimoAcesso : p.ultimoLogin;
}

function diasEntreDatas(de: string, ate: string): number {
  return Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000);
}

/**
 * Há quantos dias a pessoa não entra — em dias de CALENDÁRIO brasileiro
 * (entrou ontem às 23h e hoje é 1h: "1 dia", não "0"). `null` = nunca entrou.
 */
export function diasSemEntrar(
  p: Pick<PessoaDoPainel, "ultimoAcesso" | "ultimoLogin">,
  hoje: string
): number | null {
  const ultima = ultimaEntrada(p);
  if (!ultima) return null;
  return Math.max(0, diasEntreDatas(isoDateIn(new Date(ultima)), hoje));
}

// ------------------------------------------------------------------ período

export const PERIODOS_DO_PAINEL = [7, 30, 90] as const;
export type DiasDoPainel = (typeof PERIODOS_DO_PAINEL)[number];
export const PERIODO_PADRAO: DiasDoPainel = 30;

export type PeriodoDoPainel = { de: string; ate: string; dias: DiasDoPainel };

/** Os últimos 7, 30 ou 90 dias, contando hoje. */
export function lerPeriodoDoPainel(v: unknown, hoje: string): PeriodoDoPainel {
  const n = Number(Array.isArray(v) ? v[0] : v);
  const dias = (PERIODOS_DO_PAINEL as readonly number[]).includes(n)
    ? (n as DiasDoPainel)
    : PERIODO_PADRAO;
  return { de: addDaysIso(hoje, -(dias - 1)), ate: hoje, dias };
}

// ------------------------------------------------------------------ filtros

export const FUNCAO_ADMIN = "admin_master";

/** As funções do filtro: as do cadastro + a marca de Admin Master. */
export const FUNCOES_DO_FILTRO: { value: string; label: string }[] = [
  ...USER_ROLES.map((r) => ({ value: r as string, label: ROLE_LABELS[r] })),
  { value: FUNCAO_ADMIN, label: "Admin Master" },
].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

export function rotuloDaFuncao(funcao: string): string {
  if (funcao === FUNCAO_ADMIN) return "Admin Master";
  return (ROLE_LABELS as Record<string, string>)[funcao] ?? funcao;
}

/** Função vinda da URL só vale se existir — nunca vai texto solto ao banco. */
export function lerFuncao(v: unknown): string {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && FUNCOES_DO_FILTRO.some((f) => f.value === s)
    ? s
    : "";
}

/** Unidade vinda da URL só vale se for uma das unidades conhecidas. */
export function lerUnidade(v: unknown, conhecidas: Map<string, string>): string {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && conhecidas.has(s) ? s : "";
}

// ------------------------------------------------------------------- resumo

export type Variacao = {
  /** Diferença em pontos percentuais do valor anterior (+25 = subiu 25%). */
  porcento: number;
  sentido: "subiu" | "caiu" | "igual";
};

/**
 * Variação contra o período anterior. `null` quando não havia nada antes:
 * "subiu 100%" a partir do zero não é informação — é a falta de um passado.
 */
export function variacao(atual: number, anterior: number): Variacao | null {
  if (anterior <= 0) return null;
  const porcento = Math.round(((atual - anterior) / anterior) * 100);
  return {
    porcento,
    sentido: porcento > 0 ? "subiu" : porcento < 0 ? "caiu" : "igual",
  };
}

export type ResumoDoPainel = {
  /** Pessoas com acesso ativo no recorte. */
  ativas: number;
  /** Das ativas, quantas entraram ao menos uma vez no período. */
  entraram: number;
  /** Percentual das ativas que entrou (0–100). `null` sem ninguém ativo. */
  adesao: number | null;
  naoEntraram: number;
  /** Das ativas, quantas NUNCA entraram na vida. */
  nuncaEntraram: number;
  emUsoS: number;
  totalS: number;
  eventos: number;
  /** Média de dias com acesso entre quem entrou. */
  mediaDeDias: number | null;
  /** Havia algum uso no período anterior (senão não há com o que comparar). */
  temAnterior: boolean;
  entraramAntes: number;
  varPessoas: Variacao | null;
  varEmUso: Variacao | null;
  varEventos: Variacao | null;
};

export function resumoDoPainel(pessoas: PessoaDoPainel[]): ResumoDoPainel {
  const ativas = pessoas.filter((p) => p.ativa);
  const entraram = ativas.filter((p) => p.diasComAcesso > 0);
  // Os totais somam TODO MUNDO (quem foi desativado no meio do período também
  // usou o sistema); as taxas olham só quem pode entrar hoje.
  const emUsoS = pessoas.reduce((s, p) => s + p.emUsoS, 0);
  const totalS = pessoas.reduce((s, p) => s + p.totalS, 0);
  const eventos = pessoas.reduce((s, p) => s + eventosDe(p), 0);
  const antEmUso = pessoas.reduce((s, p) => s + p.antEmUsoS, 0);
  const antEventos = pessoas.reduce((s, p) => s + p.antEventos, 0);
  const entraramAntes = ativas.filter((p) => p.antDias > 0).length;
  const temAnterior = pessoas.some((p) => p.antDias > 0 || p.antEventos > 0);
  return {
    ativas: ativas.length,
    entraram: entraram.length,
    adesao: ativas.length ? Math.round((entraram.length / ativas.length) * 100) : null,
    naoEntraram: ativas.length - entraram.length,
    nuncaEntraram: ativas.filter((p) => ultimaEntrada(p) === null).length,
    emUsoS,
    totalS,
    eventos,
    mediaDeDias: entraram.length
      ? Math.round((entraram.reduce((s, p) => s + p.diasComAcesso, 0) / entraram.length) * 10) / 10
      : null,
    temAnterior,
    entraramAntes,
    varPessoas: temAnterior ? variacao(entraram.length, entraramAntes) : null,
    varEmUso: temAnterior ? variacao(emUsoS, antEmUso) : null,
    varEventos: temAnterior ? variacao(eventos, antEventos) : null,
  };
}

// ----------------------------------------------------------------- rankings

export type LinhaDoRanking = {
  usuario: string;
  /** O número que ordena (e que define o tamanho da barra). */
  valor: number;
  /** O que a pessoa lê à direita: "12 de 30 dias", "4h 10min", "há 23 dias". */
  texto: string;
  /** Uma segunda informação, menor, embaixo do nome. */
  nota?: string;
};

export type Ranking = {
  id:
    | "mais_acessaram"
    | "mais_tempo"
    | "mais_ativos"
    | "menos_interagiram"
    | "menos_acessaram"
    | "sem_entrar";
  titulo: string;
  explica: string;
  linhas: LinhaDoRanking[];
  /** Quantas pessoas disputam este ranking (a lista mostra só as primeiras). */
  total: number;
};

export const TAMANHO_DO_RANKING = 5;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Os seis rankings pedidos pelo dono.
 *
 * QUEM ENTRA EM CADA UM:
 *  - os "mais" contam todo mundo que apareceu no período;
 *  - os "menos" e o "sem entrar" contam só quem tem ACESSO ATIVO — listar como
 *    "quem menos entrou" alguém que foi desligado seria ruído;
 *  - "menos interagiu" e "menos dias" olham quem ENTROU ao menos uma vez: quem
 *    não entrou nenhuma vez está no "há mais tempo sem entrar", que é a lista
 *    certa para ele (senão os três rankings mostrariam as mesmas pessoas).
 */
export function rankings(
  pessoas: PessoaDoPainel[],
  periodo: Pick<PeriodoDoPainel, "dias">,
  hoje: string,
  tamanho = TAMANHO_DO_RANKING
): Ranking[] {
  const ativas = pessoas.filter((p) => p.ativa);
  const entraram = pessoas.filter((p) => p.diasComAcesso > 0);
  const ativasQueEntraram = ativas.filter((p) => p.diasComAcesso > 0);
  const diasTexto = (p: PessoaDoPainel) => `${p.diasComAcesso} de ${periodo.dias} dias`;
  const eventosTexto = (p: PessoaDoPainel) =>
    plural(eventosDe(p), "ação", "ações");
  const eventosNota = (p: PessoaDoPainel) =>
    `consultou ${p.consultas} · cadastrou ${p.cadastrou} · alterou ${p.alterou} · excluiu ${p.excluiu}`;

  const maisAcessaram = [...entraram].sort(
    (a, b) => b.diasComAcesso - a.diasComAcesso || b.acessos - a.acessos || a.usuario.localeCompare(b.usuario)
  );
  const maisTempo = entraram
    .filter((p) => p.totalS > 0)
    .sort((a, b) => b.totalS - a.totalS || a.usuario.localeCompare(b.usuario));
  const maisAtivos = pessoas
    .filter((p) => eventosDe(p) > 0)
    .sort((a, b) => eventosDe(b) - eventosDe(a) || a.usuario.localeCompare(b.usuario));
  const menosInteragiram = [...ativasQueEntraram].sort(
    (a, b) => eventosDe(a) - eventosDe(b) || b.totalS - a.totalS || a.usuario.localeCompare(b.usuario)
  );
  const menosAcessaram = [...ativasQueEntraram].sort(
    (a, b) => a.diasComAcesso - b.diasComAcesso || a.acessos - b.acessos || a.usuario.localeCompare(b.usuario)
  );
  // Nunca entrou vem primeiro (é o caso mais grave); depois, o maior tempo.
  const semEntrar = ativas
    .map((p) => ({ p, dias: diasSemEntrar(p, hoje) }))
    .filter((x) => x.dias === null || x.dias > 0)
    .sort(
      (a, b) =>
        (a.dias === null ? 1 : 0) === (b.dias === null ? 1 : 0)
          ? (b.dias ?? 0) - (a.dias ?? 0) || a.p.usuario.localeCompare(b.p.usuario)
          : a.dias === null
            ? -1
            : 1
    );
  const maiorEspera = Math.max(1, ...semEntrar.map((x) => x.dias ?? 0));

  return [
    {
      id: "mais_acessaram",
      titulo: "Quem mais acessou",
      explica: "Em quantos dias do período a pessoa entrou no sistema.",
      total: maisAcessaram.length,
      linhas: maisAcessaram.slice(0, tamanho).map((p) => ({
        usuario: p.usuario,
        valor: p.diasComAcesso,
        texto: diasTexto(p),
        nota: plural(p.acessos, "acesso", "acessos"),
      })),
    },
    {
      id: "mais_tempo",
      titulo: "Quem ficou mais tempo conectado",
      explica: "Tempo com o sistema aberto. Ao lado, quanto disso foi em uso de verdade.",
      total: maisTempo.length,
      linhas: maisTempo.slice(0, tamanho).map((p) => ({
        usuario: p.usuario,
        valor: p.totalS,
        texto: duracao(p.totalS),
        nota: `em uso ${duracao(p.emUsoS)} · parado ${duracao(Math.max(0, p.totalS - p.emUsoS))}`,
      })),
    },
    {
      id: "mais_ativos",
      titulo: "Quem mais teve atividade",
      explica: "Ações nas telas mais inclusões, alterações e exclusões.",
      total: maisAtivos.length,
      linhas: maisAtivos.slice(0, tamanho).map((p) => ({
        usuario: p.usuario,
        valor: eventosDe(p),
        texto: eventosTexto(p),
        nota: eventosNota(p),
      })),
    },
    {
      id: "menos_interagiram",
      titulo: "Quem menos interagiu",
      explica: "Entre quem entrou no período: quem fez menos coisas no sistema.",
      total: menosInteragiram.length,
      linhas: menosInteragiram.slice(0, tamanho).map((p) => ({
        usuario: p.usuario,
        valor: eventosDe(p),
        texto: eventosTexto(p),
        nota: `${diasTexto(p)} · conectado ${duracao(p.totalS)}`,
      })),
    },
    {
      id: "menos_acessaram",
      titulo: "Quem menos acessou",
      explica: "Entre quem entrou ao menos uma vez: quem entrou em menos dias.",
      total: menosAcessaram.length,
      linhas: menosAcessaram.slice(0, tamanho).map((p) => ({
        usuario: p.usuario,
        valor: p.diasComAcesso,
        texto: diasTexto(p),
        nota: plural(p.acessos, "acesso", "acessos"),
      })),
    },
    {
      id: "sem_entrar",
      titulo: "Há mais tempo sem entrar",
      explica: "Quem tem acesso ativo e está há mais dias sem entrar. Quem nunca entrou vem primeiro.",
      total: semEntrar.length,
      linhas: semEntrar.slice(0, tamanho).map(({ p, dias }) => ({
        usuario: p.usuario,
        // Nunca entrou ocupa a barra inteira: é o topo da lista.
        valor: dias === null ? maiorEspera : dias,
        texto: dias === null ? "nunca entrou" : `há ${plural(dias, "dia", "dias")}`,
        nota: quandoFoi(p, dias),
      })),
    },
  ];
}

/** A data que explica a espera: quando entrou pela última vez, ou quando o acesso foi criado. */
function quandoFoi(p: PessoaDoPainel, dias: number | null): string | undefined {
  const dataBr = (iso: string) => formatIsoDateBr(isoDateIn(new Date(iso)));
  if (dias === null) return p.criadaEm ? `acesso criado em ${dataBr(p.criadaEm)}` : undefined;
  const ultima = ultimaEntrada(p);
  return ultima ? `última vez em ${dataBr(ultima)}` : undefined;
}

// --------------------------------------------------------- pontos de atenção

/** Os limites dos avisos. Num lugar só, com nome, para ajustar sem caçar. */
export const LIMITES = {
  /** Dias sem entrar para ser considerado "sumido". */
  sumidoDias: 15,
  /** Cadastro mais velho que isto e nunca entrou = vale avisar. */
  nuncaEntrouDias: 3,
  /** Queda de atividade: precisava ter ao menos isto antes… */
  quedaMinimoAntes: 10,
  /** …e ter caído para menos desta fração. */
  quedaFracao: 0.5,
  /** Vezes desconectada por inatividade no período. */
  quedasPorInatividade: 3,
  /** Conectada ao menos isto (segundos)… */
  paradoMinimoS: 2 * 3600,
  /** …usando menos desta fração do tempo. */
  paradoFracao: 0.1,
  /** Entrou em ao menos estes dias e não fez nada. */
  semAcaoDias: 3,
  exclusoes: 5,
  exportacoes: 5,
} as const;

export type Atencao = {
  id: string;
  /** `alerta` = olhe hoje; `aviso` = acompanhe; `info` = bom saber. */
  nivel: "alerta" | "aviso" | "info";
  titulo: string;
  /** A explicação: o que significa e o que fazer. */
  texto: string;
  /** As pessoas envolvidas, já com o número de cada uma. */
  pessoas: { usuario: string; detalhe: string }[];
};

/**
 * O que o painel diz SOZINHO. Cada aviso responde três coisas: o que foi
 * visto, por que importa, e quem. Aviso sem ninguém não aparece — lista vazia
 * com título assustador ensina a ignorar a lista.
 */
export function pontosDeAtencao(
  pessoas: PessoaDoPainel[],
  periodo: Pick<PeriodoDoPainel, "dias">,
  hoje: string
): Atencao[] {
  const ativas = pessoas.filter((p) => p.ativa);
  const avisos: Atencao[] = [];
  const por = <T,>(lista: T[], n: (x: T) => number) => [...lista].sort((a, b) => n(b) - n(a));

  const nunca = ativas
    .filter((p) => ultimaEntrada(p) === null)
    .map((p) => ({
      p,
      idade: p.criadaEm ? diasEntreDatas(isoDateIn(new Date(p.criadaEm)), hoje) : 0,
    }))
    .filter((x) => x.idade >= LIMITES.nuncaEntrouDias);
  if (nunca.length) {
    avisos.push({
      id: "nunca_entraram",
      nivel: "alerta",
      titulo: `${plural(nunca.length, "pessoa tem", "pessoas têm")} acesso e nunca entrou`,
      texto:
        "O acesso foi criado e a pessoa nunca entrou no sistema. Ou ela ainda não recebeu os dados de acesso, ou o acesso não é mais necessário — e acesso sem dono é porta aberta.",
      pessoas: por(nunca, (x) => x.idade).map((x) => ({
        usuario: x.p.usuario,
        detalhe: `acesso criado há ${plural(x.idade, "dia", "dias")}`,
      })),
    });
  }

  const sumidos = ativas
    .map((p) => ({ p, dias: diasSemEntrar(p, hoje) }))
    .filter((x): x is { p: PessoaDoPainel; dias: number } => x.dias !== null && x.dias >= LIMITES.sumidoDias);
  if (sumidos.length) {
    avisos.push({
      id: "sumidos",
      nivel: "aviso",
      titulo: `${plural(sumidos.length, "pessoa não entra", "pessoas não entram")} há ${LIMITES.sumidoDias} dias ou mais`,
      texto:
        "Já usaram o sistema e pararam. Vale confirmar se estão de férias ou afastadas, se mudaram de função, ou se voltaram para a planilha.",
      pessoas: por(sumidos, (x) => x.dias).map((x) => ({
        usuario: x.p.usuario,
        detalhe: `há ${plural(x.dias, "dia", "dias")}`,
      })),
    });
  }

  const quedas = ativas.filter(
    (p) =>
      p.antEventos >= LIMITES.quedaMinimoAntes &&
      eventosDe(p) < p.antEventos * LIMITES.quedaFracao
  );
  if (quedas.length) {
    avisos.push({
      id: "queda_de_uso",
      nivel: "aviso",
      titulo: `${plural(quedas.length, "pessoa caiu", "pessoas caíram")} pela metade (ou mais) no uso`,
      texto: `Comparando com os ${periodo.dias} dias anteriores. A pessoa é comparada com ela mesma, então a diferença não vem da função — vem de alguma mudança na rotina dela.`,
      pessoas: por(quedas, (p) => p.antEventos - eventosDe(p)).map((p) => ({
        usuario: p.usuario,
        detalhe: `de ${p.antEventos} para ${eventosDe(p)} ações`,
      })),
    });
  }

  const telaAberta = pessoas.filter((p) => p.porInatividade >= LIMITES.quedasPorInatividade);
  if (telaAberta.length) {
    avisos.push({
      id: "tela_aberta",
      nivel: "aviso",
      titulo: `${plural(telaAberta.length, "pessoa deixa", "pessoas deixam")} o sistema aberto e sai`,
      texto:
        "Foram desconectadas por inatividade várias vezes. Tela aberta e sem ninguém na frente é como qualquer um usa o sistema no nome dela: vale orientar a clicar em Sair.",
      pessoas: por(telaAberta, (p) => p.porInatividade).map((p) => ({
        usuario: p.usuario,
        detalhe: `${p.porInatividade} vezes`,
      })),
    });
  }

  const parados = pessoas.filter(
    (p) => p.totalS >= LIMITES.paradoMinimoS && p.emUsoS < p.totalS * LIMITES.paradoFracao
  );
  if (parados.length) {
    avisos.push({
      id: "conectado_sem_usar",
      nivel: "info",
      titulo: `${plural(parados.length, "pessoa fica", "pessoas ficam")} conectada quase sem usar`,
      texto:
        "Passaram horas com o sistema aberto e usaram menos de 10% desse tempo. Em algumas funções isso é normal (quem atende na cadeira); em outras, mostra que o sistema fica aberto e o trabalho acontece em outro lugar.",
      pessoas: por(parados, (p) => p.totalS).map((p) => ({
        usuario: p.usuario,
        detalhe: `conectada ${duracao(p.totalS)}, em uso ${duracao(p.emUsoS)}`,
      })),
    });
  }

  const semAcao = ativas.filter(
    (p) => p.diasComAcesso >= LIMITES.semAcaoDias && eventosDe(p) === 0
  );
  if (semAcao.length) {
    avisos.push({
      id: "entra_e_nao_faz",
      nivel: "info",
      titulo: `${plural(semAcao.length, "pessoa entra", "pessoas entram")} e não registra nada`,
      texto:
        "Entraram em vários dias e não consultaram, cadastraram nem alteraram nenhum registro. Pode ser alguém que só olha painéis — ou alguém que entra por obrigação e trabalha por fora.",
      pessoas: por(semAcao, (p) => p.diasComAcesso).map((p) => ({
        usuario: p.usuario,
        detalhe: `${p.diasComAcesso} dias com acesso`,
      })),
    });
  }

  const excluem = pessoas.filter((p) => p.excluiu >= LIMITES.exclusoes);
  if (excluem.length) {
    avisos.push({
      id: "muitas_exclusoes",
      nivel: "aviso",
      titulo: `${plural(excluem.length, "pessoa excluiu", "pessoas excluíram")} ${LIMITES.exclusoes} registros ou mais`,
      texto:
        "Excluir é raro no dia a dia. Não é sinal de erro por si só, mas vale abrir a aba Alterações e ver o que foi excluído.",
      pessoas: por(excluem, (p) => p.excluiu).map((p) => ({
        usuario: p.usuario,
        detalhe: `${p.excluiu} exclusões`,
      })),
    });
  }

  const exportam = pessoas.filter((p) => p.exportacoes >= LIMITES.exportacoes);
  if (exportam.length) {
    avisos.push({
      id: "muitas_exportacoes",
      nivel: "aviso",
      titulo: `${plural(exportam.length, "pessoa exportou", "pessoas exportaram")} ${LIMITES.exportacoes} vezes ou mais`,
      texto:
        "Exportar é quando o dado sai do sistema (planilha, PDF, relatório). É o ponto a acompanhar em proteção de dados: confira na aba Ações o que foi exportado.",
      pessoas: por(exportam, (p) => p.exportacoes).map((p) => ({
        usuario: p.usuario,
        detalhe: `${p.exportacoes} exportações`,
      })),
    });
  }

  const ordem = { alerta: 0, aviso: 1, info: 2 } as const;
  return avisos.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);
}

// ------------------------------------------------------- por função / unidade

export type LinhaDoGrupo = {
  chave: string;
  /** Pessoas com acesso ativo no grupo. */
  pessoas: number;
  entraram: number;
  /** Percentual que entrou (0–100). */
  adesao: number;
  /** Média de dias com acesso, entre TODAS as ativas do grupo. */
  mediaDeDias: number;
  /** Média de tempo em uso por pessoa que entrou, em segundos. */
  mediaEmUsoS: number;
  /** Média de ações por pessoa que entrou. */
  mediaDeEventos: number;
};

function agrupar(
  pessoas: PessoaDoPainel[],
  chavesDe: (p: PessoaDoPainel) => string[]
): LinhaDoGrupo[] {
  const grupos = new Map<string, PessoaDoPainel[]>();
  for (const p of pessoas) {
    if (!p.ativa) continue;
    for (const k of new Set(chavesDe(p))) {
      const g = grupos.get(k);
      if (g) g.push(p);
      else grupos.set(k, [p]);
    }
  }
  const linhas: LinhaDoGrupo[] = [];
  for (const [chave, g] of grupos) {
    const entraram = g.filter((p) => p.diasComAcesso > 0);
    const n = entraram.length || 1;
    linhas.push({
      chave,
      pessoas: g.length,
      entraram: entraram.length,
      adesao: Math.round((entraram.length / g.length) * 100),
      mediaDeDias: Math.round((g.reduce((s, p) => s + p.diasComAcesso, 0) / g.length) * 10) / 10,
      mediaEmUsoS: Math.round(entraram.reduce((s, p) => s + p.emUsoS, 0) / n),
      mediaDeEventos: Math.round(entraram.reduce((s, p) => s + eventosDe(p), 0) / n),
    });
  }
  return linhas.sort((a, b) => b.pessoas - a.pessoas || a.chave.localeCompare(b.chave));
}

/**
 * O uso POR FUNÇÃO — a régua justa. Quem tem duas funções conta nas duas; o
 * Admin Master é um grupo próprio (não é função de unidade).
 */
export function porFuncao(pessoas: PessoaDoPainel[]): LinhaDoGrupo[] {
  return agrupar(pessoas, (p) => [
    ...p.funcoes.map((f) => f.funcao),
    ...(p.admin ? [FUNCAO_ADMIN] : []),
  ]);
}

/** O uso POR UNIDADE. Quem tem função em duas unidades conta nas duas. */
export function porUnidade(pessoas: PessoaDoPainel[]): LinhaDoGrupo[] {
  return agrupar(pessoas, (p) => p.funcoes.map((f) => f.unidade));
}

// --------------------------------------------------------------- dia a dia

export type DiaDoPainel = {
  dia: string;
  pessoas: number;
  acessos: number;
  emUsoS: number;
  eventos: number;
  /** 0 = domingo … 6 = sábado. */
  semana: number;
};

/**
 * A série do período, com TODOS os dias — o banco devolve só os dias com
 * movimento, e um gráfico sem os dias vazios esconderia justamente o fim de
 * semana e o feriado.
 */
export function serieDiaria(
  dados: unknown,
  periodo: Pick<PeriodoDoPainel, "de" | "ate">
): DiaDoPainel[] | null {
  if (!Array.isArray(dados)) return null;
  const porDia = new Map<string, Omit<DiaDoPainel, "dia" | "semana">>();
  for (const d of dados) {
    const r = obj(d);
    const dia = r && txt(r.day);
    if (!r || !dia) return null;
    porDia.set(dia.slice(0, 10), {
      pessoas: num(r.people),
      acessos: num(r.sessions),
      emUsoS: num(r.active_seconds),
      eventos: num(r.actions) + num(r.changes),
    });
  }
  const serie: DiaDoPainel[] = [];
  for (let dia = periodo.de; dia <= periodo.ate; dia = addDaysIso(dia, 1)) {
    const v = porDia.get(dia) ?? { pessoas: 0, acessos: 0, emUsoS: 0, eventos: 0 };
    serie.push({ dia, ...v, semana: weekdayOf(dia) });
    if (serie.length > 400) break; // régua de segurança contra data torta
  }
  return serie;
}

// ----------------------------------------------------- dia da semana × hora

export const DIAS_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;
export const DIAS_DA_SEMANA_LONGO = [
  "domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado",
] as const;
/** A ordem em que a semana é desenhada: segunda primeiro, domingo por último. */
export const ORDEM_DA_SEMANA = [1, 2, 3, 4, 5, 6, 0] as const;

export type GradeDeHoras = {
  /** `celulas[diaDaSemana][hora]` = eventos (ações + alterações). */
  celulas: number[][];
  maximo: number;
  total: number;
  /** A primeira e a última hora a desenhar (sempre cobre ao menos 7h–19h). */
  horaInicial: number;
  horaFinal: number;
  /** O momento de maior movimento, ou `null` sem movimento nenhum. */
  pico: { semana: number; hora: number; eventos: number } | null;
  /** Percentual do movimento fora de segunda a sexta, 7h–19h. */
  foraDoExpediente: number | null;
};

export function gradeDeHoras(dados: unknown): GradeDeHoras | null {
  if (!Array.isArray(dados)) return null;
  const celulas = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  let maximo = 0;
  let total = 0;
  let fora = 0;
  let pico: GradeDeHoras["pico"] = null;
  let menor = 7;
  let maior = 19;
  for (const d of dados) {
    const r = obj(d);
    if (!r) return null;
    const semana = Number(r.dow);
    const hora = Number(r.hour);
    if (!Number.isInteger(semana) || semana < 0 || semana > 6) return null;
    if (!Number.isInteger(hora) || hora < 0 || hora > 23) return null;
    const eventos = num(r.events);
    if (eventos === 0) continue;
    celulas[semana][hora] += eventos;
    total += eventos;
    if (semana === 0 || semana === 6 || hora < 7 || hora >= 19) fora += eventos;
    if (hora < menor) menor = hora;
    if (hora > maior) maior = hora;
    if (celulas[semana][hora] > maximo) {
      maximo = celulas[semana][hora];
      pico = { semana, hora, eventos: maximo };
    }
  }
  return {
    celulas,
    maximo,
    total,
    horaInicial: menor,
    horaFinal: maior,
    pico,
    foraDoExpediente: total ? Math.round((fora / total) * 100) : null,
  };
}

/**
 * A intensidade da casa, em 5 degraus (0 = vazia, 4 = o pico). Um tom só, do
 * claro ao escuro: mais movimento é mais escuro, sem arco-íris.
 */
export function degrau(valor: number, maximo: number): 0 | 1 | 2 | 3 | 4 {
  if (valor <= 0 || maximo <= 0) return 0;
  const f = valor / maximo;
  return f > 0.75 ? 4 : f > 0.5 ? 3 : f > 0.25 ? 2 : 1;
}
