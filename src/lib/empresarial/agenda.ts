// Risarte Empresarial — a agenda própria do programa comercial.
//
// Puro de propósito: a mesma conta serve à tela, à rota do arquivo de calendário
// e ao teste. Ver migração 1008.

import {
  MEETING_STATUS_LABELS,
  type MeetingMode,
  type MeetingStatus,
} from "./constants";

// -----------------------------------------------------------------------------
// Situação da reunião
// -----------------------------------------------------------------------------

/** Reunião que ainda vai acontecer (ocupa a agenda de alguém). */
export function isMeetingOpen(status: MeetingStatus): boolean {
  return status === "SCHEDULED" || status === "CONFIRMED";
}

/**
 * Para onde uma reunião pode ir a partir de onde está.
 *
 * REALIZADA, CANCELADA e NÃO COMPARECEU são fim de linha: a reunião aconteceu
 * (ou deixou de acontecer) e isso não se desfaz. REMARCADA também encerra esta
 * — quem continua é a reunião nova, que aponta para ela.
 */
export function nextMeetingStatuses(
  atual: MeetingStatus
): readonly MeetingStatus[] {
  if (!isMeetingOpen(atual)) return [];
  const comuns: MeetingStatus[] = [
    "CONFIRMED",
    "DONE",
    "RESCHEDULED",
    "CANCELLED",
    "NO_SHOW",
  ];
  return comuns.filter((s) => s !== atual);
}

/** Motivo é obrigatório quando a reunião não aconteceu — senão vira buraco. */
export function requiresStatusNote(status: MeetingStatus): boolean {
  return (
    status === "CANCELLED" || status === "NO_SHOW" || status === "RESCHEDULED"
  );
}

export type MeetingView = {
  id: string;
  companyName: string;
  title: string | null;
  mode: MeetingMode;
  location: string | null;
  startsAt: string;
  endsAt: string;
  status: MeetingStatus;
  statusNote: string | null;
  ownerName: string | null;
};

/**
 * Quantas vezes esta reunião já foi remarcada — seguindo a corrente de
 * `rescheduled_from` para trás. É o número que mostra a empresa que enrola.
 */
export function timesRescheduled(
  meetingId: string,
  anteriorDe: ReadonlyMap<string, string | null>
): number {
  let n = 0;
  let atual = anteriorDe.get(meetingId) ?? null;
  const vistos = new Set<string>([meetingId]);
  while (atual && !vistos.has(atual)) {
    // `vistos` existe porque uma corrente com laço (dado estragado) travaria a
    // tela para sempre — e travar é pior que mostrar um número incompleto.
    vistos.add(atual);
    n += 1;
    atual = anteriorDe.get(atual) ?? null;
  }
  return n;
}

// -----------------------------------------------------------------------------
// "Adicionar à minha agenda" — arquivo .ics
// -----------------------------------------------------------------------------
// Formato iCalendar (RFC 5545), que Google Agenda, Outlook e o celular abrem.
// Escrito à mão de propósito: são 15 linhas, e uma dependência nova para isso
// custaria mais do que resolve.

/** Escapa o que o formato trata como separador. Sem isto, vírgula parte campo. */
function escapeIcs(texto: string): string {
  return texto
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Dobra a linha em 75 octetos, como o formato exige. Linha comprida sem dobra
 * faz alguns calendários recusarem o arquivo inteiro — e o sintoma é "não
 * aconteceu nada ao clicar", que é o pior tipo de defeito.
 */
// `TextEncoder`, não `Buffer`: este arquivo também é lido pela tela, e `Buffer`
// só existe no servidor — a importação quebraria no navegador.
const encoder = new TextEncoder();
const octetos = (s: string) => encoder.encode(s).length;

function foldLine(linha: string): string {
  if (octetos(linha) <= 75) return linha;

  const partes: string[] = [];
  let atual = "";
  for (const char of linha) {
    // A continuação começa com um espaço, então cabe um octeto a menos.
    const limite = partes.length === 0 ? 75 : 74;
    if (octetos(atual) + octetos(char) > limite) {
      partes.push(atual);
      atual = "";
    }
    atual += char;
  }
  partes.push(atual);
  return partes.join("\r\n ");
}

/** Instante em UTC no formato do calendário: 20260915T170000Z. */
export function icsInstant(instant: Date | string): string {
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) throw new Error("Data inválida para o calendário");
  return `${d.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

export type IcsInput = {
  id: string;
  resumo: string;
  descricao?: string | null;
  local?: string | null;
  inicio: string | Date;
  fim: string | Date;
  agora?: Date;
};

/**
 * O arquivo de calendário de uma reunião.
 *
 * ⚠️ Tudo em UTC (o `Z` no fim). É o único jeito de o compromisso cair na hora
 * certa no celular de quem está em outro fuso — e é a mesma lição que já custou
 * três horas de erro na agenda do sistema.
 */
export function buildIcs(input: IcsInput): string {
  const linhas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Risarte//Empresarial//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.id}@risarte-empresarial`,
    `DTSTAMP:${icsInstant(input.agora ?? new Date())}`,
    `DTSTART:${icsInstant(input.inicio)}`,
    `DTEND:${icsInstant(input.fim)}`,
    `SUMMARY:${escapeIcs(input.resumo)}`,
  ];
  if (input.descricao) linhas.push(`DESCRIPTION:${escapeIcs(input.descricao)}`);
  if (input.local) linhas.push(`LOCATION:${escapeIcs(input.local)}`);
  linhas.push("END:VEVENT", "END:VCALENDAR");

  // O formato exige fim de linha CRLF, e arquivo tem de terminar com quebra.
  return `${linhas.map(foldLine).join("\r\n")}\r\n`;
}

/** Nome do arquivo baixado. Sem acento e sem espaço, que viajam mal. */
export function icsFileName(companyName: string): string {
  const limpo = companyName
    .normalize("NFD")
    // Os acentos que a decomposição NFD separa (U+0300 a U+036F).
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `reuniao-${limpo || "risarte"}.ics`;
}

/** Texto curto da situação, para o cartão e a lista. */
export function meetingStatusLabel(status: MeetingStatus): string {
  return MEETING_STATUS_LABELS[status];
}
