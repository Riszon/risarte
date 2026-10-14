// QUEM ESTÁ ONLINE (0291, pedido do dono em 13/10/2026).
//
// O sistema já sabia quem estava online — a bolinha do Chat —, mas só mostrava
// dentro do Chat. Aqui ficam as regras puras do que a barra de cima e a
// Auditoria mostram ao Admin Master: como ler a resposta do banco, o nome de
// cada tela e as frases ("há 3 min", "entrou às 08:12").
//
// ⚠️ QUEM DECIDE SE ALGUÉM ESTÁ ONLINE É O BANCO (`presence_now`), com o
// relógio dele. Este arquivo não recalcula a situação a partir das horas: duas
// contas para a mesma pergunta acabariam respondendo diferente na barra e na
// Auditoria.

import { BRAZIL_TIME_ZONE } from "@/lib/dates";
import { ROLE_LABELS } from "@/lib/roles";

export const SITUACOES = ["online", "ausente", "saiu", "nao_entrou"] as const;
export type Situacao = (typeof SITUACOES)[number];

export const SITUACAO_ROTULO: Record<Situacao, string> = {
  online: "Online",
  ausente: "Ausente",
  saiu: "Saiu",
  nao_entrou: "Não entrou hoje",
};

/** O que cada grupo quer dizer — a mesma régua da migração 0291. */
export const SITUACAO_EXPLICA: Record<Situacao, string> = {
  online: "Com o sistema aberto e mexendo nele nos últimos 5 minutos.",
  ausente:
    "Com o sistema aberto, mas sem clicar nem digitar há mais de 5 minutos. Depois do tempo de inatividade da função, o acesso cai sozinho.",
  saiu: "Entrou hoje e não está conectado agora: saiu, ou caiu por inatividade.",
  nao_entrou: "Tem acesso ativo e ainda não entrou hoje.",
};

export type FuncaoNaUnidade = { unidade: string | null; funcao: string };

export type PessoaNaPresenca = {
  id: string;
  nome: string;
  admin: boolean;
  funcoes: FuncaoNaUnidade[];
  situacao: Situacao;
  /** Quando começou o acesso que está aberto agora. */
  conectadoDesde: string | null;
  /** A primeira entrada de hoje (pode ser anterior ao acesso de agora). */
  primeiraEntrada: string | null;
  ultimaAtividade: string | null;
  /** Até quando esteve aqui — só para quem saiu. */
  saiuEm: string | null;
  /** O módulo em que está ("agenda", "admin/auditoria"). Nunca um endereço. */
  tela: string | null;
  acessosAbertos: number;
  limiteMin: number | null;
};

const txt = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const obj = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

/**
 * A resposta de `presence_now`, conferida linha a linha.
 *
 * Devolve `null` quando a resposta não é uma lista — "não consegui ler" é
 * diferente de "ninguém online", e a tela precisa das duas respostas. Linha
 * com situação que este código não conhece é DESCARTADA em vez de virar
 * "online" por omissão.
 */
export function lerPresenca(dados: unknown): PessoaNaPresenca[] | null {
  if (!Array.isArray(dados)) return null;
  const pessoas: PessoaNaPresenca[] = [];
  for (const bruto of dados) {
    const l = obj(bruto);
    if (!l) continue;
    const id = txt(l.user_id);
    const situacao = txt(l.status);
    if (!id || !situacao || !SITUACOES.includes(situacao as Situacao)) continue;
    const funcoes: FuncaoNaUnidade[] = [];
    if (Array.isArray(l.roles)) {
      for (const r of l.roles) {
        const o = obj(r);
        const funcao = o ? txt(o.r) : null;
        if (funcao) funcoes.push({ unidade: o ? txt(o.n) : null, funcao });
      }
    }
    pessoas.push({
      id,
      nome: txt(l.full_name) ?? "—",
      admin: l.is_admin_master === true,
      funcoes,
      situacao: situacao as Situacao,
      conectadoDesde: txt(l.connected_since),
      primeiraEntrada: txt(l.first_today_at),
      ultimaAtividade: txt(l.last_activity_at),
      saiuEm: txt(l.left_at),
      tela: txt(l.current_screen),
      acessosAbertos: typeof l.open_sessions === "number" ? l.open_sessions : 0,
      limiteMin: typeof l.idle_limit_min === "number" ? l.idle_limit_min : null,
    });
  }
  return pessoas;
}

export type ResumoDaPresenca = {
  online: number;
  ausentes: number;
  sairam: number;
  naoEntraram: number;
};

/** A resposta de `presence_summary`. `null` = não é Admin, ou a função ainda não existe. */
export function lerResumo(dados: unknown): ResumoDaPresenca | null {
  const o = obj(dados);
  if (!o) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const online = n(o.online);
  const ausentes = n(o.ausentes);
  const sairam = n(o.sairam);
  const naoEntraram = n(o.nao_entraram);
  if (online === null || ausentes === null || sairam === null || naoEntraram === null) {
    return null;
  }
  return { online, ausentes, sairam, naoEntraram };
}

export function porSituacao(
  pessoas: readonly PessoaNaPresenca[]
): Record<Situacao, PessoaNaPresenca[]> {
  const grupos: Record<Situacao, PessoaNaPresenca[]> = {
    online: [],
    ausente: [],
    saiu: [],
    nao_entrou: [],
  };
  for (const p of pessoas) grupos[p.situacao].push(p);
  return grupos;
}

/**
 * "Recepcionista · Cambé" — as funções da pessoa, uma por unidade.
 *
 * Função que este código não conhece aparece com o nome técnico, à vista: é
 * melhor que sumir com ela, e é sinal de função nova sem rótulo.
 */
export function rotuloDasFuncoes(p: Pick<PessoaNaPresenca, "admin" | "funcoes">): string {
  const partes = p.funcoes.map((f) => {
    const nome = (ROLE_LABELS as Record<string, string>)[f.funcao] ?? f.funcao;
    return f.unidade ? `${nome} · ${f.unidade}` : nome;
  });
  const unicas = [...new Set(partes)];
  if (p.admin) unicas.unshift("Admin Master");
  return unicas.length ? unicas.join("; ") : "sem função cadastrada";
}

// ------------------------------------------------------------------ a tela

/**
 * O QUE VAI PARA O BANCO quando a pessoa muda de tela: o MÓDULO, nunca o
 * endereço.
 *
 * ⚠️ O endereço de um prontuário leva o identificador do paciente. Guardar
 * "fulano está em /prontuarios/<id>" numa coluna de presença seria registrar
 * quem olha a ficha de quem — isso já tem lugar certo (a trilha de ações, com
 * as regras dela). Daqui sai só "prontuarios", "admin/auditoria".
 *
 * Só passam pedaços de letras minúsculas e hífen. Um pedaço com número ou
 * maiúscula é identificador ou código: ele e tudo depois dele ficam de fora.
 * O banco repete a mesma regra (`access_session_screen`) — a de lá é a que
 * vale; esta existe para não mandar o que seria recusado.
 */
export function telaParaRegistrar(caminho: string | null | undefined): string | null {
  if (!caminho) return null;
  const limpo = caminho.split(/[?#]/)[0];
  if (!limpo.startsWith("/")) return null;
  const pedacos = limpo.split("/").filter(Boolean);
  if (pedacos.length === 0) return "inicio";
  const bons: string[] = [];
  for (const p of pedacos.slice(0, 2)) {
    if (!/^[a-z][a-z-]{0,39}$/.test(p)) break;
    bons.push(p);
  }
  return bons.length ? bons.join("/") : null;
}

/** O nome de cada tela, como está no menu. A chave é o primeiro pedaço do endereço. */
export const NOME_DA_TELA: Record<string, string> = {
  inicio: "Início",
  admin: "Administração",
  agenda: "Agenda",
  alertas: "Alertas do sistema",
  apresentacao: "Apresentação comercial",
  atendimento: "Atendimento",
  avaliacao: "Avaliação",
  chat: "Chat Hub",
  comercial: "Comercial",
  compras: "Compras",
  empresarial: "Empresarial",
  estoque: "Estoque",
  financeiro: "Financeiro",
  "guia-indica": "Guia do Indica +Risos",
  "indica-mais-risos": "Indica +Risos",
  jornada: "Jornada",
  manual: "Manual de treinamento",
  "meu-dia": "Meu Dia",
  "minha-agenda": "Minha Agenda",
  notificacoes: "Notificações",
  novidades: "Novidades do sistema",
  perfil: "Meu perfil",
  planejamento: "Centro de Planejamento",
  planos: "Planos de Tratamento",
  ppr: "PPR+ (Prevenção)",
  problemas: "Relatos de problema",
  procedimentos: "Procedimentos",
  prontuarios: "Prontuários",
  relatorios: "Relatórios",
  risartanos: "Risartanos",
  sistema: "Sistema",
};

/** As telas da Administração — o segundo pedaço do endereço. */
export const NOME_NA_ADMINISTRACAO: Record<string, string> = {
  "agenda-comercial": "Agenda do Comercial",
  agenda: "Config. Agenda",
  ambientes: "Ambientes",
  anamnese: "Fichas de Anamnese",
  auditoria: "Auditoria",
  certificacao: "Certificação",
  chat: "Chat (contatos)",
  clinicas: "Clínicas",
  documentos: "Modelos de Documentos",
  orientacoes: "Orientações",
  permissoes: "Permissões",
  "regras-comerciais": "Regras Comerciais",
  sessao: "Sessão e inatividade",
  sla: "Prazos (SLA)",
};

/**
 * O nome da tela, para a lista. Tela que este código não conhece vira "Outra
 * tela" — NUNCA o texto gravado: o que não foi reconhecido não é mostrado como
 * se fosse nome de coisa.
 */
export function nomeDaTela(tela: string | null | undefined): string | null {
  if (!tela) return null;
  const [primeiro, segundo] = tela.split("/");
  const nome = NOME_DA_TELA[primeiro];
  if (!nome) return "Outra tela";
  if (primeiro === "admin" && segundo && NOME_NA_ADMINISTRACAO[segundo]) {
    return `${nome} › ${NOME_NA_ADMINISTRACAO[segundo]}`;
  }
  return nome;
}

// ---------------------------------------------------------------- as frases

/** "08:12" no relógio de Brasília. */
export function horaDe(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("pt-BR", {
    timeZone: BRAZIL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "agora", "há 3 min", "há 1h 20min". Nunca negativo. */
export function haQuanto(iso: string | null | undefined, agoraMs: number): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const min = Math.floor(Math.max(0, agoraMs - t) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `há ${h}h ${String(m).padStart(2, "0")}min` : `há ${h}h`;
}

/**
 * A linha de detalhe de cada pessoa, pela situação dela.
 *
 * Cada situação diz o que SE SABE: quem está conectado tem hora de entrada e
 * última atividade; quem saiu tem até quando esteve; quem não entrou não tem
 * hora nenhuma — e a frase não inventa uma.
 */
export function detalheDaPessoa(p: PessoaNaPresenca, agoraMs: number): string {
  if (p.situacao === "nao_entrou") return "ainda não entrou hoje";
  if (p.situacao === "saiu") {
    const entrou = horaDe(p.primeiraEntrada);
    const ate = horaDe(p.saiuEm);
    return [entrou && `entrou às ${entrou}`, ate && `esteve até ${ate}`]
      .filter(Boolean)
      .join(" · ") || "entrou hoje";
  }
  const entrou = horaDe(p.conectadoDesde);
  const primeira = horaDe(p.primeiraEntrada);
  const atividade = haQuanto(p.ultimaAtividade, agoraMs);
  return [
    entrou && `entrou às ${entrou}`,
    // Quem saiu e voltou tem duas horas — a de agora e a primeira do dia.
    primeira && entrou && primeira !== entrou && `primeira entrada às ${primeira}`,
    atividade && (atividade === "agora" ? "mexeu agora" : `última atividade ${atividade}`),
    p.acessosAbertos > 1 && `${p.acessosAbertos} acessos abertos`,
  ]
    .filter(Boolean)
    .join(" · ");
}
