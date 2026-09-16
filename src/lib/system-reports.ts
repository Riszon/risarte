// AS REGRAS DA TELA DE PROBLEMAS — puras e testadas (0256).
//
// Tudo o que a lista precisa decidir sem banco: de que módulo é uma tela, há
// quanto tempo um relato está parado e em que cor isso aparece, em que aba ele
// cai, se tem resposta que a pessoa ainda não leu, e se a busca o encontra.
//
// A regra de QUEM PODE continua no banco (0247/0256). Aqui só se organiza o que
// a pessoa já tem direito de ver.

export type TipoDeRelato = "erro" | "duvida" | "sugestao";
export type SituacaoDeRelato =
  | "aberto"
  | "em_analise"
  | "resolvido"
  | "nao_e_defeito";
export type GravidadeDeRelato = "baixa" | "media" | "alta";

export type TipoDeMensagem =
  | "resposta"
  | "complemento"
  | "situacao"
  | "reabertura";

export type MensagemDeRelato = {
  id: string;
  seq: number;
  kind: TipoDeMensagem;
  body: string | null;
  statusFrom: SituacaoDeRelato | null;
  statusTo: SituacaoDeRelato | null;
  createdAt: string;
  authorName: string;
  /** Escrita por quem relatou (complemento/reabertura) ou pelo suporte. */
  doRelator: boolean;
};

export type Relato = {
  id: string;
  code: string;
  kind: TipoDeRelato;
  severity: GravidadeDeRelato;
  title: string;
  whatHappened: string;
  expected: string | null;
  screen: string | null;
  module: ModuloDoSistema | null;
  appVersion: string | null;
  errorDigest: string | null;
  /** O navegador de quem relatou — só o Admin Master vê, no briefing. */
  userAgent: string | null;
  status: SituacaoDeRelato;
  answer: string | null;
  answeredAt: string | null;
  resolvedVersion: string | null;
  createdAt: string;
  statusChangedAt: string | null;
  closedAt: string | null;
  firstResponseAt: string | null;
  reopenedCount: number;
  reporterRole: string | null;
  reporterName: string;
  clinicId: string;
  clinicName: string;
  meu: boolean;
  /** Quem relatou já abriu depois da última resposta. */
  respostaLida: boolean;
  /** Quantas respostas do suporte a conversa tem. */
  respostas: number;
  /** A última fala da conversa (fora as linhas de situação) é de quem relatou. */
  ultimaFalaDoRelator: boolean;
};

export const TIPO_ROTULO: Record<TipoDeRelato, string> = {
  erro: "Algo deu errado",
  duvida: "Dúvida",
  sugestao: "Sugestão",
};

export const SITUACAO_ROTULO: Record<SituacaoDeRelato, string> = {
  aberto: "Aberto",
  em_analise: "Em análise",
  resolvido: "Resolvido",
  nao_e_defeito: "Não é defeito",
};

export const GRAVIDADE_ROTULO: Record<GravidadeDeRelato, string> = {
  baixa: "Atrapalha pouco",
  media: "Atrapalha o trabalho",
  alta: "Impede de trabalhar",
};

// -----------------------------------------------------------------------------
// Módulos — a MESMA lista do `check` da 0256
// -----------------------------------------------------------------------------

export const MODULOS = [
  { value: "agenda", label: "Agenda e Atendimento" },
  { value: "jornada", label: "Clientes e Jornada" },
  { value: "clinico", label: "Clínico e Prontuário" },
  { value: "planejamento", label: "Centro de Planejamento" },
  { value: "comercial", label: "Comercial" },
  { value: "financeiro", label: "Financeiro" },
  { value: "procedimentos", label: "Procedimentos e Preços" },
  { value: "estoque", label: "Estoque" },
  { value: "compras", label: "Compras" },
  { value: "ppr", label: "PPR+" },
  { value: "empresarial", label: "Risarte Empresarial" },
  { value: "administracao", label: "Administração e Relatórios" },
  { value: "geral", label: "Início, avisos e chat" },
  { value: "outros", label: "Outro" },
] as const;

export type ModuloDoSistema = (typeof MODULOS)[number]["value"];

export const MODULO_ROTULO = Object.fromEntries(
  MODULOS.map((m) => [m.value, m.label])
) as Record<ModuloDoSistema, string>;

export function ehModulo(v: unknown): v is ModuloDoSistema {
  return MODULOS.some((m) => m.value === v);
}

/**
 * O primeiro pedaço do endereço → o módulo. A ordem importa só onde um nome é
 * prefixo de outro, e aqui nenhum é: casa-se o SEGMENTO inteiro.
 */
const MODULO_POR_SEGMENTO: Record<string, ModuloDoSistema> = {
  agenda: "agenda",
  "minha-agenda": "agenda",
  atendimento: "agenda",
  jornada: "jornada",
  clientes: "jornada",
  avaliacao: "clinico",
  prontuarios: "clinico",
  planos: "clinico",
  documentos: "clinico",
  planejamento: "planejamento",
  comercial: "comercial",
  apresentacao: "comercial",
  financeiro: "financeiro",
  renegociacoes: "financeiro",
  cancelamentos: "financeiro",
  procedimentos: "procedimentos",
  estoque: "estoque",
  compras: "compras",
  ppr: "ppr",
  empresarial: "empresarial",
  admin: "administracao",
  relatorios: "administracao",
  risartanos: "administracao",
  "": "geral",
  "meu-dia": "geral",
  notificacoes: "geral",
  alertas: "geral",
  chat: "geral",
  perfil: "geral",
  manual: "geral",
};

/**
 * Sugere o módulo pela tela de onde a pessoa veio. `null` quando não dá para
 * saber — a pessoa escolhe, em vez de o sistema chutar "Outro".
 */
export function moduloDaTela(tela: string | null | undefined): ModuloDoSistema | null {
  if (tela == null) return null;
  const limpo = tela.trim();
  // Só endereço. Texto livre ("Agenda · sábado") não é caminho, e adivinhar
  // por palavra seria o chute que a lista fechada existe para evitar.
  if (!limpo.startsWith("/")) return null;
  const caminho = limpo.split(/[?#]/)[0];
  const primeiro = caminho.split("/").filter(Boolean)[0] ?? "";
  return MODULO_POR_SEGMENTO[primeiro] ?? null;
}

// -----------------------------------------------------------------------------
// O relógio
// -----------------------------------------------------------------------------

const HORA = 3_600_000;
const DIA = 24 * HORA;

/** "há 5 h", "há 1 dia", "há 12 dias". Nunca negativo. */
export function rotuloDeDuracao(ms: number): string {
  const seguro = Math.max(0, ms);
  if (seguro < HORA) return "menos de 1 h";
  if (seguro < DIA) return `${Math.floor(seguro / HORA)} h`;
  const dias = Math.floor(seguro / DIA);
  return dias === 1 ? "1 dia" : `${dias} dias`;
}

export type FaixaDeIdade = "recente" | "atencao" | "atrasado";

/**
 * A cor da idade de um relato em aberto (combinado com o dono, 16/09/2026):
 * até 2 dias é normal, de 3 a 7 pede atenção, acima de 7 está atrasado.
 *
 * Conta DIAS INTEIROS: 2 dias e 23 horas ainda é "recente". Arredondar para
 * cima acenderia o amarelo um dia antes do combinado.
 */
export function faixaDeIdade(ms: number): FaixaDeIdade {
  const dias = Math.floor(Math.max(0, ms) / DIA);
  if (dias <= 2) return "recente";
  if (dias <= 7) return "atencao";
  return "atrasado";
}

export function estaEncerrado(s: SituacaoDeRelato): boolean {
  return s === "resolvido" || s === "nao_e_defeito";
}

export type Relogio = {
  /** A frase principal: "aberto há 3 dias" ou "resolvido em 2 dias". */
  principal: string;
  /** Só quando está em análise: "em análise há 5 h". */
  secundario: string | null;
  /** Encerrado não tem cor de atraso: já terminou. */
  faixa: FaixaDeIdade | null;
};

export function relogioDoRelato(
  r: Pick<Relato, "status" | "createdAt" | "statusChangedAt" | "closedAt">,
  agora: number
): Relogio {
  const criado = Date.parse(r.createdAt);

  if (estaEncerrado(r.status)) {
    // Relato antigo, de antes da 0256, pode estar encerrado sem data de
    // conclusão. Sem ela não há duração honesta a mostrar.
    if (!r.closedAt) {
      return { principal: "encerrado", secundario: null, faixa: null };
    }
    const duracao = Date.parse(r.closedAt) - criado;
    const verbo = r.status === "resolvido" ? "resolvido" : "encerrado";
    return {
      principal: `${verbo} em ${rotuloDeDuracao(duracao)}`,
      secundario: null,
      faixa: null,
    };
  }

  const aberto = agora - criado;
  const secundario =
    r.status === "em_analise" && r.statusChangedAt
      ? `em análise há ${rotuloDeDuracao(agora - Date.parse(r.statusChangedAt))}`
      : null;

  return {
    principal: `aberto há ${rotuloDeDuracao(aberto)}`,
    secundario,
    // A cor segue o tempo TOTAL, não o da situação atual: mudar para "em
    // análise" não pode zerar o atraso de quem esperou dez dias.
    faixa: faixaDeIdade(aberto),
  };
}

// -----------------------------------------------------------------------------
// Abas
// -----------------------------------------------------------------------------

export const ABAS = [
  { value: "fila", label: "Fila" },
  { value: "meus", label: "Os meus" },
  { value: "respondidos", label: "Respondidos" },
  { value: "encerrados", label: "Encerrados" },
  { value: "todos", label: "Todos" },
] as const;

export type Aba = (typeof ABAS)[number]["value"];

export function ehAba(v: unknown): v is Aba {
  return ABAS.some((a) => a.value === v);
}

export function naAba(r: Relato, aba: Aba): boolean {
  switch (aba) {
    case "fila":
      return !estaEncerrado(r.status);
    case "meus":
      return r.meu;
    case "respondidos":
      return r.respostas > 0;
    case "encerrados":
      return estaEncerrado(r.status);
    case "todos":
      return true;
  }
}

export function contarAbas(relatos: Relato[]): Record<Aba, number> {
  const conta = { fila: 0, meus: 0, respondidos: 0, encerrados: 0, todos: 0 };
  for (const r of relatos) {
    for (const a of ABAS) if (naAba(r, a.value)) conta[a.value]++;
  }
  return conta;
}

/**
 * A aba em que a tela abre. O Admin Master trabalha a fila. Para o resto, se
 * há resposta que ainda não leu, abre onde ela está — é o que a pessoa veio
 * buscar quando a boia acendeu.
 */
export function abaInicial(relatos: Relato[], isAdminMaster: boolean): Aba {
  if (isAdminMaster) return "fila";
  if (relatos.some(temRespostaNova)) return "meus";
  if (relatos.some((r) => r.meu)) return "meus";
  return "fila";
}

/** Resposta que quem relatou ainda não abriu. */
export function temRespostaNova(r: Relato): boolean {
  return r.meu && r.respostas > 0 && !r.respostaLida;
}

/**
 * Para o suporte: a última palavra é de quem relatou (complementou ou
 * reabriu) e o relato está aberto — alguém está esperando.
 */
export function aguardaSuporte(r: Relato): boolean {
  return !estaEncerrado(r.status) && (r.respostas === 0 || r.ultimaFalaDoRelator);
}

/**
 * A ordem da fila: quem espera há mais tempo primeiro. Nas outras abas, o mais
 * recente primeiro — é o que se procura quando se procura "o que respondeu".
 */
export function ordenar(relatos: Relato[], aba: Aba): Relato[] {
  const copia = [...relatos];
  if (aba === "fila") {
    return copia.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }
  if (aba === "respondidos") {
    return copia.sort(
      (a, b) =>
        Date.parse(b.answeredAt ?? b.createdAt) -
        Date.parse(a.answeredAt ?? a.createdAt)
    );
  }
  return copia.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

// -----------------------------------------------------------------------------
// Busca
// -----------------------------------------------------------------------------

/** Sem acento, sem caixa: "Não" acha "nao", "sábado" acha "SABADO". */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Busca pelo código (com ou sem o "OC-" e os zeros), pelo título, pelo texto,
 * pela tela e por quem relatou. Todas as palavras precisam aparecer, em
 * qualquer ordem: "agenda sabado" acha "no sábado a agenda travou".
 */
export function casaBusca(r: Relato, busca: string): boolean {
  const termo = normalizar(busca);
  if (!termo) return true;

  // "9", "00009", "oc-9" e "OC-00009" são o mesmo relato.
  const numero = /^(?:oc-?)?0*(\d+)$/.exec(termo);
  if (numero) {
    const doRelato = /(\d+)$/.exec(r.code)?.[1];
    if (doRelato && Number(doRelato) === Number(numero[1])) return true;
  }

  const onde = normalizar(
    [r.code, r.title, r.whatHappened, r.expected, r.screen, r.reporterName]
      .filter(Boolean)
      .join(" ")
  );
  return termo.split(/\s+/).every((palavra) => onde.includes(palavra));
}
