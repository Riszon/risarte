// Risarte Empresarial — as contas do painel do funil comercial.
//
// Puro e testado. A regra do projeto inteiro vale aqui com força: **régua vazia
// grita**. Sem dado, a resposta é "não sabemos", nunca zero — porque zero é uma
// afirmação, e um painel que afirma o que não mediu leva a decisão errada com
// cara de número oficial.

import type { CaptureChannel, LeadStage } from "./constants";
import { FUNNEL_COLUMNS, type StagePeriod } from "./funnel";

export type LeadDoPainel = {
  id: string;
  companyName: string;
  stage: LeadStage;
  consultantId: string | null;
  consultantName: string | null;
  captureChannel: CaptureChannel | null;
  estimatedValueCents: number | null;
  history: readonly StagePeriod[];
};

const UM_DIA = 24 * 60 * 60 * 1000;

// -----------------------------------------------------------------------------
// Conversão fase a fase
// -----------------------------------------------------------------------------

export type DegrauDaConversao = {
  key: string;
  titulo: string;
  numero: number;
  /** Quantas empresas JÁ PASSARAM por esta fase (não quantas estão nela). */
  alcancaram: number;
  /** % das que chegaram na fase anterior. `null` na primeira e sem base. */
  conversao: number | null;
};

export type Conversao = {
  degraus: DegrauDaConversao[];
  /** Empresas com caminho medível (entraram depois de o relógio ligar). */
  medidas: number;
  /**
   * Empresas que ficam FORA da conta porque já existiam quando o relógio foi
   * ligado — o caminho delas nunca foi registrado. Contá-las como "não
   * passaram" faria a conversão parecer pior do que é.
   */
  foraDaMedicao: number;
};

/** O lead tem caminho medível? Linha de backfill = passado desconhecido. */
export function temCaminhoMedivel(lead: LeadDoPainel): boolean {
  return lead.history.length > 0 && !lead.history.some((h) => h.isInitial);
}

export function conversaoDoFunil(leads: readonly LeadDoPainel[]): Conversao {
  const medidos = leads.filter(temCaminhoMedivel);

  const degraus = FUNNEL_COLUMNS.map((coluna) => {
    const alcancaram = medidos.filter((l) =>
      l.history.some((h) => (coluna.stages as readonly string[]).includes(h.stage))
    ).length;
    return {
      key: coluna.key as string,
      titulo: coluna.titulo,
      numero: coluna.numero,
      alcancaram,
      conversao: null as number | null,
    };
  });

  for (let i = 1; i < degraus.length; i += 1) {
    const base = degraus[i - 1].alcancaram;
    // Sem ninguém na fase anterior não existe conversão — e "0%" seria uma
    // afirmação falsa sobre uma etapa que ninguém percorreu.
    degraus[i].conversao =
      base === 0 ? null : Math.round((degraus[i].alcancaram / base) * 100);
  }

  return {
    degraus,
    medidas: medidos.length,
    foraDaMedicao: leads.length - medidos.length,
  };
}

// -----------------------------------------------------------------------------
// Tempo médio em cada fase
// -----------------------------------------------------------------------------

export type TempoDaFase = {
  stage: LeadStage;
  /** `null` quando nenhuma passagem TERMINOU: não há o que promediar. */
  mediaDias: number | null;
  passagensCompletas: number;
  /** Passagens ainda abertas — contam como "pelo menos", não como média. */
  emAberto: number;
};

/**
 * Média por fase, contando só as passagens que TERMINARAM.
 *
 * Incluir a passagem aberta puxaria a média para baixo (ela ainda está
 * crescendo) e faria a fase parecer mais rápida justamente quando há empresas
 * empacadas nela — o oposto do que o painel existe para mostrar.
 */
export function tempoMedioPorFase(
  leads: readonly LeadDoPainel[]
): TempoDaFase[] {
  const completas = new Map<LeadStage, number[]>();
  const abertas = new Map<LeadStage, number>();

  for (const lead of leads) {
    for (const h of lead.history) {
      if (h.leftAt) {
        const ms =
          new Date(h.leftAt).getTime() - new Date(h.enteredAt).getTime();
        completas.set(h.stage, [...(completas.get(h.stage) ?? []), Math.max(0, ms)]);
      } else {
        abertas.set(h.stage, (abertas.get(h.stage) ?? 0) + 1);
      }
    }
  }

  return FUNNEL_COLUMNS.flatMap((coluna) =>
    coluna.stages.map((stage) => {
      const lista = completas.get(stage) ?? [];
      return {
        stage,
        mediaDias:
          lista.length === 0
            ? null
            : Math.round(
                lista.reduce((a, b) => a + b, 0) / lista.length / UM_DIA
              ),
        passagensCompletas: lista.length,
        emAberto: abertas.get(stage) ?? 0,
      };
    })
  );
}

// -----------------------------------------------------------------------------
// Quem está parado
// -----------------------------------------------------------------------------

export type Parada = {
  lead: LeadDoPainel;
  dias: number;
  limite: number;
  /** Tempo que só vale desde que o relógio ligou (14/09/2026). */
  parcial: boolean;
};

/**
 * Empresas além do limite da fase em que estão.
 *
 * Fase sem limite cadastrado **não vira alerta** — é ausência de configuração,
 * não empresa saudável. Inventar um limite aqui faria a tela cobrar por uma
 * régua que ninguém definiu.
 */
export function paradasAlemDoLimite(
  leads: readonly LeadDoPainel[],
  limites: ReadonlyMap<string, number>,
  agora: Date
): Parada[] {
  const paradas: Parada[] = [];
  for (const lead of leads) {
    const aberta = lead.history.find((h) => h.leftAt == null);
    if (!aberta) continue;
    const limite = limites.get(aberta.stage);
    if (limite == null) continue;

    const dias = Math.floor(
      Math.max(0, agora.getTime() - new Date(aberta.enteredAt).getTime()) / UM_DIA
    );
    if (dias > limite) {
      paradas.push({ lead, dias, limite, parcial: aberta.isInitial });
    }
  }
  // Pior primeiro: quem está parado há mais tempo precisa aparecer no topo.
  return paradas.sort((a, b) => b.dias - a.dias);
}

// -----------------------------------------------------------------------------
// Por consultor e por canal
// -----------------------------------------------------------------------------

export type Recorte = {
  chave: string;
  rotulo: string;
  emAberto: number;
  ganhos: number;
  perdas: number;
  valorEmAbertoCents: number;
  /** `null` quando não houve nenhum FECHAMENTO — sem base não há taxa. */
  taxaDeGanho: number | null;
};

function recortar(
  leads: readonly LeadDoPainel[],
  chaveDe: (l: LeadDoPainel) => { chave: string; rotulo: string }
): Recorte[] {
  const mapa = new Map<string, Recorte>();

  for (const lead of leads) {
    const { chave, rotulo } = chaveDe(lead);
    const atual =
      mapa.get(chave) ??
      {
        chave,
        rotulo,
        emAberto: 0,
        ganhos: 0,
        perdas: 0,
        valorEmAbertoCents: 0,
        taxaDeGanho: null,
      };

    if (lead.stage === "CLOSED_WON" || lead.stage === "IMPLEMENTATION") {
      atual.ganhos += 1;
    } else if (lead.stage === "CLOSED_LOST") {
      atual.perdas += 1;
    } else {
      atual.emAberto += 1;
      atual.valorEmAbertoCents += lead.estimatedValueCents ?? 0;
    }
    mapa.set(chave, atual);
  }

  for (const r of mapa.values()) {
    const fechados = r.ganhos + r.perdas;
    // Sem nenhum fechamento não existe taxa de ganho. "0%" diria que o
    // consultor perdeu tudo, quando ele ainda não fechou nada.
    r.taxaDeGanho =
      fechados === 0 ? null : Math.round((r.ganhos / fechados) * 100);
  }

  return [...mapa.values()].sort(
    (a, b) => b.ganhos - a.ganhos || b.emAberto - a.emAberto
  );
}

export function porConsultor(leads: readonly LeadDoPainel[]): Recorte[] {
  return recortar(leads, (l) => ({
    chave: l.consultantId ?? "SEM_CONSULTOR",
    // "Sem consultor" é um recorte de verdade: é a fila que ninguém assumiu.
    rotulo: l.consultantName ?? "Sem consultor",
  }));
}

export function porCanal(
  leads: readonly LeadDoPainel[],
  rotulos: Record<CaptureChannel, string>
): Recorte[] {
  return recortar(leads, (l) => ({
    chave: l.captureChannel ?? "NAO_INFORMADO",
    rotulo: l.captureChannel ? rotulos[l.captureChannel] : "Não informado",
  }));
}
