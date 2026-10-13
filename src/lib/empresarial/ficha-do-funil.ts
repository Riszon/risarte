// Risarte Empresarial — O QUE A FICHA DA EMPRESA DIZ DE SI (OC-00083, 3ª volta).
//
// A ficha já tinha abas e trilha de passos. O que faltava, olhando a tela em
// 13/10/2026:
//
//   1. o cabeçalho trazia uma frase FIXA de ajuda, igual para todas as
//      empresas — nada sobre aquela empresa, nem o que fazer com ela agora;
//   2. os dados (CNPJ, contato, consultor, próxima ação) e o HISTÓRICO
//      (tentativas, reuniões, envios, mudanças de fase) só existiam na
//      janelinha do cartão, no quadro do funil;
//   3. a aba Fechamento abria EM BRANCO para toda empresa que ainda não tinha
//      fechado — e também para a que tinha sido PERDIDA, que abre justamente
//      nela.
//
// Aqui ficam as regras puras que a tela consome: o que cada fase significa,
// qual é o PRÓXIMO PASSO, o que falta para fechar, e a linha do tempo.

import {
  CONTACT_CHANNEL_LABELS,
  CONTACT_OUTCOME_LABELS,
  DISPATCH_CHANNEL_LABELS,
  DISPATCH_ITEM_LABELS,
  LEAD_STAGE_LABELS,
  MEETING_MODE_LABELS,
  MEETING_STATUS_LABELS,
  type ContactChannel,
  type ContactOutcome,
  type DispatchChannel,
  type DispatchItem,
  type LeadStage,
  type MeetingMode,
  type MeetingStatus,
} from "./constants";
import type { EtapaDaFicha } from "./etapas-do-funil";
import { rotuloDeDuracao } from "./funnel";

/** As abas da ficha: as cinco etapas do trabalho + o histórico. */
export type AbaDaFichaId = EtapaDaFicha | "historico";

/** O que cada fase quer dizer — a mesma tabela da especificação do dono (14/09/2026). */
export const FASE_SIGNIFICA: Record<LeadStage, string> = {
  CAPTURE: "Empresa na lista de potenciais clientes: ainda não foi abordada.",
  CONTACT: "Tentando falar com a empresa. Ainda não há reunião marcada.",
  MEETING_SCHEDULED: "A apresentação está marcada.",
  PRESENTED: "O programa já foi apresentado. Agora é levantar os dados e montar a proposta.",
  PROPOSAL_SENT: "A proposta e o contrato foram para a empresa.",
  FOLLOW_UP: "Em negociação: falta a assinatura do contrato e o pagamento da implantação.",
  CLOSED_WON: "Negócio fechado: contrato assinado e implantação paga.",
  CLOSED_LOST: "Negócio perdido.",
  IMPLEMENTATION: "Em implantação: cadastro dos titulares, boas-vindas e primeiros agendamentos.",
};

// ----------------------------------------------------------- próximo passo

export type DadosDoProximoPasso = {
  stage: LeadStage;
  /** O motivo registrado, quando a empresa foi perdida. */
  motivoDaPerda: string | null;
  temLevantamento: boolean;
  /**
   * Quantos campos faltam na aba Proposta — A MESMA conta do selo da aba
   * (proposta + contrato, sem repetir). Duas contas diferentes na mesma tela
   * ("falta 6" na aba, "faltam 3" no alto) fazem a pessoa duvidar das duas.
   */
  faltaProposta: number;
  propostaEnviada: boolean;
  contratoAssinado: boolean;
  implantacaoPaga: boolean;
  /** A conferência de fechamento foi confirmada. */
  conferido: boolean;
  /** O cadastro da empresa já foi criado (o lead virou empresa). */
  empresaCriada: boolean;
  /** Pela régua `progressoDaImplantacao` (o que conta, não as linhas gravadas). */
  passosFeitos: number;
  passosTotal: number;
  tentativasDeContato: number;
  /** A reunião marcada mais próxima que ainda não aconteceu (ISO), se houver. */
  proximaReuniao: string | null;
};

export type ProximoPasso = {
  /**
   * `agir` = há um passo claro a dar; `alerta` = há um buraco no caminho (a
   * empresa andou e algo ficou para trás); `ok` = nada pendente;
   * `encerrado` = não há próximo passo.
   */
  tom: "agir" | "alerta" | "ok" | "encerrado";
  /** O que fazer, em uma frase curta e no imperativo. */
  titulo: string;
  /** Por quê, ou o detalhe que ajuda a fazer. */
  detalhe: string;
  /** A aba onde isso se resolve. */
  aba: AbaDaFichaId;
};

const plural = (n: number, um: string, muitos: string) =>
  n === 1 ? `1 ${um}` : `${n} ${muitos}`;

/** Fases em que o programa já foi apresentado e a negociação está viva. */
const DEPOIS_DE_APRESENTAR: readonly LeadStage[] = [
  "PRESENTED",
  "PROPOSAL_SENT",
  "FOLLOW_UP",
];

/**
 * O PRÓXIMO PASSO — a frase que o cabeçalho da ficha diz.
 *
 * ⚠️ É UMA RESPOSTA SÓ. A ficha já tem o "o que falta" de cada aba; aqui a
 * pergunta é outra: de tudo o que falta, o que se faz AGORA. Lista de cinco
 * pendências no alto da tela é a mesma confusão de antes, só que resumida.
 *
 * ⚠️ O BURACO VEM ANTES DO ROTEIRO. Empresa que já foi apresentada e não tem
 * levantamento não deve ouvir "complete a proposta": sem o que a empresa
 * contou, a proposta é chute. Por isso o alerta ganha da fase.
 */
export function proximoPasso(d: DadosDoProximoPasso): ProximoPasso {
  if (d.stage === "CLOSED_LOST") {
    return {
      tom: "encerrado",
      titulo: "Negócio perdido",
      detalhe: d.motivoDaPerda
        ? `Motivo registrado: ${d.motivoDaPerda}`
        : "Nenhum motivo foi registrado.",
      aba: "fechamento",
    };
  }

  if (DEPOIS_DE_APRESENTAR.includes(d.stage) && !d.temLevantamento) {
    return {
      tom: "alerta",
      titulo: "Registrar o levantamento",
      detalhe: `A empresa já está em ${LEAD_STAGE_LABELS[d.stage]} e o levantamento não começou. Sem o que ela contou, a proposta sai sem base de comparação.`,
      aba: "levantamento",
    };
  }

  switch (d.stage) {
    case "CAPTURE":
      return {
        tom: "agir",
        titulo: "Fazer o primeiro contato",
        detalhe: "Registre cada tentativa: é o que mostra depois quantas foram precisas até marcar a reunião.",
        aba: "historico",
      };
    case "CONTACT":
      return {
        tom: "agir",
        titulo: "Conseguir a reunião de apresentação",
        detalhe:
          d.tentativasDeContato > 0
            ? `${plural(d.tentativasDeContato, "tentativa registrada", "tentativas registradas")} até agora. Marque a reunião assim que a empresa aceitar.`
            : "Nenhuma tentativa de contato registrada ainda.",
        aba: "historico",
      };
    case "MEETING_SCHEDULED":
      return {
        tom: "agir",
        titulo: "Preparar a apresentação",
        detalhe: d.proximaReuniao
          ? "Há reunião marcada. Confira se a apresentação está como você quer mostrar."
          : "A fase diz que há reunião, mas nenhuma reunião futura está marcada. Confira no histórico.",
        aba: d.proximaReuniao ? "apresentacao" : "historico",
      };
    case "PRESENTED":
      if (d.faltaProposta > 0) {
        return {
          tom: "agir",
          titulo: "Completar a proposta",
          detalhe: `${plural(d.faltaProposta, "campo falta", "campos faltam")} para a proposta e o contrato ficarem completos.`,
          aba: "proposta",
        };
      }
      return {
        tom: "agir",
        titulo: "Enviar a proposta",
        detalhe: "A proposta está pronta. Registre o envio para a empresa seguir no funil.",
        aba: "envio",
      };
    case "PROPOSAL_SENT":
    case "FOLLOW_UP":
      if (!d.propostaEnviada) {
        return {
          tom: "alerta",
          titulo: "Registrar o envio da proposta",
          detalhe: `A empresa está em ${LEAD_STAGE_LABELS[d.stage]}, mas não há envio de proposta registrado.`,
          aba: "envio",
        };
      }
      if (!d.contratoAssinado) {
        return {
          tom: "agir",
          titulo: "Conseguir a assinatura do contrato",
          detalhe: d.implantacaoPaga
            ? "A implantação já foi paga; falta só o contrato assinado."
            : "Faltam o contrato assinado e o pagamento da implantação. Só é ganho com os dois.",
          aba: "envio",
        };
      }
      return {
        tom: "agir",
        titulo: "Confirmar o pagamento da implantação",
        detalhe: "O contrato já foi assinado; falta o boleto da implantação pago.",
        aba: "envio",
      };
    case "CLOSED_WON":
      // A empresa vem ANTES da conferência: a conferência recusa sem ela (a
      // implantação cadastra os titulares no cadastro da empresa).
      // Ganha SEM os dois selos só existe em empresa anterior à regra (1028).
      // O cadastro não é criado assim — então o passo é o selo, não o botão
      // que vai recusar.
      if (!d.empresaCriada && !(d.contratoAssinado && d.implantacaoPaga)) {
        return {
          tom: "alerta",
          titulo: "Marcar os dois selos",
          detalhe: "A empresa está em Fechamento (ganho) sem contrato assinado e implantação paga. O cadastro só é criado com os dois.",
          aba: "envio",
        };
      }
      if (!d.empresaCriada) {
        return {
          tom: "agir",
          titulo: "Criar o cadastro da empresa",
          detalhe: "O negócio está ganho. O cadastro nasce com os preços, as faixas e os benefícios da proposta.",
          aba: "fechamento",
        };
      }
      if (!d.conferido) {
        return {
          tom: "agir",
          titulo: "Fazer a conferência do fechamento",
          detalhe: "Confira o que foi combinado antes de passar a empresa para a implantação.",
          aba: "fechamento",
        };
      }
      return {
        tom: "ok",
        titulo: "Fechado e conferido",
        detalhe: "Nada pendente nesta ficha.",
        aba: "fechamento",
      };
    case "IMPLEMENTATION":
      if (d.passosFeitos >= d.passosTotal) {
        return {
          tom: "ok",
          titulo: "Implantação concluída",
          detalhe: "Todos os passos foram resolvidos.",
          aba: "fechamento",
        };
      }
      return {
        tom: "agir",
        titulo: "Concluir a implantação",
        detalhe: `${d.passosFeitos} de ${d.passosTotal} passos resolvidos.`,
        aba: "fechamento",
      };
  }
}

// ------------------------------------------------------------- próxima ação

export type ProximaAcao = {
  /** A data marcada já passou. */
  atrasada: boolean;
  /** "hoje", "amanhã", "em 3 dias", "há 2 dias". */
  quando: string;
};

/**
 * A próxima ação que o consultor agendou para si (data + nota no cartão).
 * `null` quando não há data — "sem próxima ação" é informação, e a tela a diz.
 *
 * A conta é em dias de CALENDÁRIO: `hoje` e a data chegam como "AAAA-MM-DD"
 * já no fuso de Brasília, e aqui só se subtrai.
 */
export function proximaAcao(dia: string | null, hoje: string): ProximaAcao | null {
  if (!dia) return null;
  const dias = Math.round((Date.parse(dia) - Date.parse(hoje)) / 86_400_000);
  if (Number.isNaN(dias)) return null;
  if (dias === 0) return { atrasada: false, quando: "hoje" };
  if (dias === 1) return { atrasada: false, quando: "amanhã" };
  if (dias > 1) return { atrasada: false, quando: `em ${dias} dias` };
  return { atrasada: true, quando: dias === -1 ? "ontem" : `há ${-dias} dias` };
}

// ⚠️ "O que falta para fechar" NÃO mora aqui: já existe em `envio.ts`
// (`faltaParaFechar`), e é ela que a aba Envio usa. A aba Fechamento lê a
// mesma — duas réguas para a regra de ouro acabariam dizendo coisas diferentes.

// ----------------------------------------------------------- linha do tempo

export type TipoDeEvento =
  | "fase"
  | "tentativa"
  | "reuniao"
  | "envio"
  | "selo"
  | "conferencia"
  | "nota";

export type EventoDoHistorico = {
  /** Estável, para a lista do React. */
  id: string;
  quando: string;
  tipo: TipoDeEvento;
  titulo: string;
  detalhe: string | null;
  autor: string | null;
};

export type FontesDoHistorico = {
  fases: {
    stage: LeadStage;
    enteredAt: string;
    leftAt: string | null;
    isInitial: boolean;
  }[];
  tentativas: {
    id: string;
    channel: ContactChannel;
    outcome: ContactOutcome;
    note: string | null;
    attemptedAt: string;
    authorName: string | null;
  }[];
  reunioes: {
    id: string;
    title: string | null;
    mode: MeetingMode;
    location: string | null;
    startsAt: string;
    status: MeetingStatus;
    statusNote: string | null;
  }[];
  envios: {
    id: string;
    channel: DispatchChannel;
    items: DispatchItem[];
    note: string | null;
    sentAt: string;
    authorName: string | null;
  }[];
  notas: {
    id: string;
    kind: string;
    note: string | null;
    createdAt: string;
    authorName: string | null;
  }[];
  contratoAssinadoEm: string | null;
  implantacaoPagaEm: string | null;
  conferidoEm: string | null;
  conferidoPor: string | null;
};

/** A anotação automática que o sistema grava a cada mudança de fase. */
const MUDANCA_DE_FASE = "STAGE_CHANGE";
/** Dois minutos: a anotação e a linha do relógio nascem no mesmo clique. */
const MESMO_ATO_MS = 2 * 60 * 1000;

const TIPO_DA_NOTA: Record<string, string> = {
  [MUDANCA_DE_FASE]: "Mudança de fase",
  NOTE: "Anotação",
  CALL: "Ligação",
  MEETING: "Reunião",
  PROPOSAL: "Proposta",
};

/**
 * A HISTÓRIA DA EMPRESA NO FUNIL, do mais recente para o mais antigo.
 *
 * Junta o que estava espalhado por cinco lugares: mudanças de fase, tentativas
 * de contato, reuniões, envios, selos, a conferência e as anotações.
 *
 * ⚠️ A ENTRADA INICIAL NÃO TEM DATA DE VERDADE. As empresas que já estavam no
 * funil antes de 14/09/2026 ganharam uma linha `isInitial` quando o relógio
 * foi ligado (migração 1007). Escrever "entrou em Captação em 14/09" seria
 * inventar uma data — o evento diz que o registro começa ali.
 *
 * ⚠️ MUDANÇA DE FASE É GRAVADA DUAS VEZES, E APARECE UMA. Mover a empresa
 * grava o relógio da fase (por gatilho) E uma anotação "Movido para…" (pela
 * tela). Mostrar as duas seria dizer a mesma coisa em duas linhas. A linha do
 * relógio fica — é ela que sabe quanto tempo durou —, e leva da anotação o que
 * só a anotação tem: QUEM moveu e o MOTIVO da perda. Anotação de mudança sem
 * linha de relógio correspondente (antes de 14/09) aparece sozinha.
 */
export function linhaDoTempo(f: FontesDoHistorico, agora: Date): EventoDoHistorico[] {
  const eventos: EventoDoHistorico[] = [];

  const anotacaoDaFase = casarAnotacoes(f);
  const jaContadas = new Set([...anotacaoDaFase.values()].map((n) => n.id));
  for (const [i, h] of f.fases.entries()) {
    const fim = h.leftAt ? new Date(h.leftAt).getTime() : agora.getTime();
    const duracao = rotuloDeDuracao(Math.max(0, fim - new Date(h.enteredAt).getTime()));
    const anotacao = anotacaoDaFase.get(i);
    const motivo = anotacao?.note?.split("— motivo:")[1]?.trim();
    eventos.push({
      id: `fase-${i}-${h.enteredAt}`,
      quando: h.enteredAt,
      tipo: "fase",
      titulo: h.isInitial
        ? `Já estava em ${LEAD_STAGE_LABELS[h.stage]} quando o registro começou`
        : `Entrou em ${LEAD_STAGE_LABELS[h.stage]}`,
      detalhe:
        (h.leftAt
          ? `Ficou ${duracao === "hoje" ? "menos de um dia" : duracao} nesta fase.`
          : `Está nesta fase ${duracao === "hoje" ? "desde hoje" : `há ${duracao}`}.`) +
        (motivo ? ` Motivo: ${motivo}` : ""),
      autor: anotacao?.authorName ?? null,
    });
  }

  for (const t of f.tentativas) {
    eventos.push({
      id: `tentativa-${t.id}`,
      quando: t.attemptedAt,
      tipo: "tentativa",
      titulo: `${CONTACT_CHANNEL_LABELS[t.channel]} — ${CONTACT_OUTCOME_LABELS[t.outcome]}`,
      detalhe: t.note,
      autor: t.authorName,
    });
  }

  for (const r of f.reunioes) {
    eventos.push({
      id: `reuniao-${r.id}`,
      quando: r.startsAt,
      tipo: "reuniao",
      titulo: `Reunião ${MEETING_MODE_LABELS[r.mode].toLowerCase()} — ${MEETING_STATUS_LABELS[r.status]}`,
      detalhe:
        [r.title, r.location, r.statusNote].filter(Boolean).join(" · ") || null,
      autor: null,
    });
  }

  for (const e of f.envios) {
    eventos.push({
      id: `envio-${e.id}`,
      quando: e.sentAt,
      tipo: "envio",
      titulo: `Enviado por ${DISPATCH_CHANNEL_LABELS[e.channel]}: ${e.items.map((x) => DISPATCH_ITEM_LABELS[x]).join(", ")}`,
      detalhe: e.note,
      autor: e.authorName,
    });
  }

  if (f.contratoAssinadoEm) {
    eventos.push({
      id: "selo-contrato",
      quando: f.contratoAssinadoEm,
      tipo: "selo",
      titulo: "Contrato assinado",
      detalhe: null,
      autor: null,
    });
  }
  if (f.implantacaoPagaEm) {
    eventos.push({
      id: "selo-implantacao",
      quando: f.implantacaoPagaEm,
      tipo: "selo",
      titulo: "Implantação paga",
      detalhe: null,
      autor: null,
    });
  }
  if (f.conferidoEm) {
    eventos.push({
      id: "conferencia",
      quando: f.conferidoEm,
      tipo: "conferencia",
      titulo: "Conferência do fechamento confirmada",
      detalhe: null,
      autor: f.conferidoPor,
    });
  }

  for (const n of f.notas) {
    if (jaContadas.has(n.id)) continue;
    eventos.push({
      id: `nota-${n.id}`,
      quando: n.createdAt,
      tipo: "nota",
      titulo: TIPO_DA_NOTA[n.kind] ?? n.kind,
      detalhe: n.note,
      autor: n.authorName,
    });
  }

  return eventos.sort(
    (a, b) => b.quando.localeCompare(a.quando) || a.id.localeCompare(b.id)
  );
}

/**
 * Qual anotação "Movido para…" pertence a qual linha do relógio.
 *
 * ⚠️ CASA PELO NOME DA FASE, não só pela hora, e QUEM ESCOLHE É A ANOTAÇÃO.
 * Foram duas versões erradas antes desta, as duas pegas em 13/10/2026:
 *
 *   1. casar "a anotação mais próxima no tempo": num funil andado depressa,
 *      "Movido para Contato" grudava em "Entrou em Captação" e o autor
 *      aparecia na fase errada (visto na tela do treino);
 *   2. percorrer as FASES em ordem, cada uma pegando a sua anotação: com duas
 *      passagens pela mesma fase em menos de dois minutos, a primeira passagem
 *      levava a anotação da segunda (pego pelo teste).
 *
 * Aqui cada anotação procura a passagem daquela fase mais próxima dela, e
 * cada passagem fica com uma anotação só.
 *
 * "Fechado (ganho) — empresa criada…" fica de FORA de propósito: ela diz o
 * que foi (ou não foi) copiado da proposta, e fundi-la apagaria isso.
 */
function casarAnotacoes(
  f: FontesDoHistorico
): Map<number, FontesDoHistorico["notas"][number]> {
  const porFase = new Map<number, FontesDoHistorico["notas"][number]>();
  const mudancas = f.notas
    .filter((n) => n.kind === MUDANCA_DE_FASE && n.note)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const n of mudancas) {
    const quando = new Date(n.createdAt).getTime();
    let melhor: { i: number; distancia: number } | null = null;
    for (const [i, h] of f.fases.entries()) {
      if (h.isInitial || porFase.has(i)) continue;
      const prefixo = `Movido para ${LEAD_STAGE_LABELS[h.stage]}`;
      if (n.note !== prefixo && !n.note!.startsWith(`${prefixo} —`)) continue;
      const distancia = Math.abs(new Date(h.enteredAt).getTime() - quando);
      if (distancia > MESMO_ATO_MS) continue;
      if (!melhor || distancia < melhor.distancia) melhor = { i, distancia };
    }
    if (melhor) porFase.set(melhor.i, n);
  }
  return porFase;
}

/** A reunião marcada (não cancelada, não realizada) mais próxima, a partir de agora. */
export function proximaReuniao(
  reunioes: Pick<FontesDoHistorico["reunioes"][number], "startsAt" | "status">[],
  agora: Date
): string | null {
  const futuras = reunioes
    .filter(
      (r) =>
        (r.status === "SCHEDULED" || r.status === "CONFIRMED") &&
        new Date(r.startsAt).getTime() >= agora.getTime()
    )
    .map((r) => r.startsAt)
    .sort();
  return futuras[0] ?? null;
}

/** A situação da aba Histórico, na mesma forma das outras abas. */
export function situacaoDoHistorico(eventos: number): {
  estado: "pronto";
  resumo: string;
} {
  return {
    estado: "pronto",
    resumo: eventos === 0 ? "sem registros" : plural(eventos, "registro", "registros"),
  };
}
