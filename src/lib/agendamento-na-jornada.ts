// O CLIENTE TEM AGENDAMENTO? — a marca nos cartões da Jornada (relato OC-00074).
//
// "Seria ótimo se tivesse algum alerta na aba Jornada, dos clientes que
// precisam fazer alguma tarefa, por exemplo sem agendamento." O dono decidiu
// (14/10/2026): todo cartão mostra o próximo agendamento ou "Sem agendamento",
// e o "Sem agendamento" aparece em DESTAQUE em todas as fases.
//
// Conta como agendamento o que ainda vai acontecer ou está acontecendo HOJE:
// marcado ou confirmado, a partir do começo do dia brasileiro, e que não foi
// concluído nem teve desistência. Cancelado e falta não contam — o horário
// voltou a ficar livre. Pendência de dia ANTERIOR (ninguém resolveu) também não
// conta: o cliente não tem horário pela frente.
//
// Regra pura; a leitura mora na página.

import { APPOINTMENT_TYPE_LABELS, type AppointmentType } from "@/lib/appointments";
import { formatInBrazil, isoDateIn } from "@/lib/dates";

export type AgendamentoLido = {
  client_id: string;
  clinic_id: string;
  starts_at: string;
  type: string;
  status: string;
  attendance: string | null;
};

export type ProximoAgendamento = { startsAt: string; type: string; clinicId: string };

/** Este agendamento é um horário que o cliente TEM pela frente? */
export function contaComoAgendamento(a: AgendamentoLido, inicioDeHojeIso: string): boolean {
  if (a.status !== "scheduled" && a.status !== "confirmed") return false;
  if (a.attendance === "done" || a.attendance === "gave_up") return false;
  const quando = new Date(a.starts_at).getTime();
  const hoje = new Date(inicioDeHojeIso).getTime();
  if (Number.isNaN(quando) || Number.isNaN(hoje)) return false;
  return quando >= hoje;
}

/** O PRÓXIMO agendamento de cada cliente (o mais cedo que conta). */
export function proximoPorCliente(
  agendamentos: readonly AgendamentoLido[],
  inicioDeHojeIso: string
): Map<string, ProximoAgendamento> {
  const saida = new Map<string, ProximoAgendamento>();
  for (const a of agendamentos) {
    if (!contaComoAgendamento(a, inicioDeHojeIso)) continue;
    const atual = saida.get(a.client_id);
    if (!atual || new Date(a.starts_at).getTime() < new Date(atual.startsAt).getTime()) {
      saida.set(a.client_id, { startsAt: a.starts_at, type: a.type, clinicId: a.clinic_id });
    }
  }
  return saida;
}

/** "16/10 14:00 · Início de Tratamento" — no relógio brasileiro. */
export function rotuloDoAgendamento(p: ProximoAgendamento): string {
  const quando = formatInBrazil(p.startsAt, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).replace(",", "");
  const tipo = APPOINTMENT_TYPE_LABELS[p.type as AppointmentType] ?? "Agendamento";
  return `${quando} · ${tipo}`;
}

/**
 * Para onde a marca leva (pedido do dono, 14/10/2026):
 *   - COM agendamento: a agenda no DIA dele, para ver;
 *   - SEM agendamento: a agenda com o "Novo agendamento" aberto e o cliente já
 *     escolhido (`?cliente=`, o mesmo caminho dos avisos da Recepção). Quem
 *     não agenda (o consultor, por exemplo) só abre a agenda.
 * Na visão da REDE (Franqueadora), a unidade vai junto — é a agenda dela que
 * interessa, não a da Franqueadora.
 */
export function linkDaAgenda(p: {
  clientId: string;
  clientClinicId: string;
  proximo: ProximoAgendamento | null;
  visaoDaRede: boolean;
}): string {
  if (p.proximo) {
    const dia = isoDateIn(new Date(p.proximo.startsAt));
    const unidade = p.visaoDaRede ? `&unidade=${p.proximo.clinicId}` : "";
    return `/agenda?vista=dia&ref=${dia}${unidade}`;
  }
  const unidade = p.visaoDaRede ? `&unidade=${p.clientClinicId}` : "";
  return `/agenda?cliente=${p.clientId}${unidade}`;
}

/** Os ids em lotes: a lista vai na URL, e mil ids de uma vez passariam do limite dela. */
export function emLotes<T>(lista: readonly T[], tamanho: number): T[][] {
  if (tamanho < 1) throw new Error("tamanho do lote precisa ser positivo");
  const saida: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) saida.push(lista.slice(i, i + tamanho));
  return saida;
}
