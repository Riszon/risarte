import type { AppointmentType } from "@/lib/appointments";

/**
 * AP176 (0425) — AS DICAS DA AGENDA PARA QUEM TEM CASO ORTODÔNTICO.
 *
 * Desde a 0425 só a "Manutenção ortodôntica" vira manutenção do caso. Duas
 * coisas ajudam a recepção a não cair no hábito antigo:
 *
 * 1. Escolher "Sessão de Tratamento" ou "Retorno" com o ortodontista de quem
 *    tem caso aberto → a janela pergunta se não é manutenção (`dicaDoTipo`).
 * 2. Outro tratamento em paralelo (decisão do dono, 17/11/2026): a mesma
 *    consulta não é sessão do plano E manutenção ao mesmo tempo — são DOIS
 *    atendimentos seguidos no mesmo dia. Depois de salvar um, a janela já
 *    prepara o outro, começando quando o primeiro termina (`emSeguida`).
 *
 * Regras puras: a janela só desenha o que elas dizem.
 */

export type OrtoNaAgenda = {
  status: "em_tratamento" | "contencao";
  orthodontistId: string | null;
  orthodontistName: string | null;
  /** Datas (aaaa-mm-dd) das manutenções previstas ainda sem agendamento. */
  previstas: string[];
};

/** Quantos dias para cada lado contam como "a manutenção daquela semana". */
export const JANELA_DA_MANUTENCAO_DIAS = 7;

export function dicaDoTipo(p: {
  type: AppointmentType;
  providerId: string;
  orto: OrtoNaAgenda | null;
}): string | null {
  if (!p.orto) return null;
  if (p.type !== "treatment_session" && p.type !== "return_visit") return null;
  if (!p.providerId || p.providerId !== p.orto.orthodontistId) return null;
  return "Este paciente tem caso ortodôntico, e este é o ortodontista dele. Se for a manutenção do aparelho, escolha o tipo \"Manutenção ortodôntica\": só ele entra no cronograma do caso.";
}

function diasEntre(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(ya, ma - 1, da) - Date.UTC(yb, mb - 1, db)) / 86_400_000);
}

/** A manutenção prevista mais perto da data, se cair na mesma semana. */
export function manutencaoDaSemana(orto: OrtoNaAgenda | null, data: string): string | null {
  if (!orto || !data) return null;
  let melhor: string | null = null;
  for (const d of orto.previstas) {
    const dist = Math.abs(diasEntre(d, data));
    if (dist > JANELA_DA_MANUTENCAO_DIAS) continue;
    if (melhor === null || dist < Math.abs(diasEntre(melhor, data))) melhor = d;
  }
  return melhor;
}

export type EmSeguida =
  | { tipo: "ortho_maintenance"; providerId: string | null; prevista: string }
  | { tipo: "treatment_session"; providerId: null };

/**
 * Depois de salvar um agendamento NOVO: preparar o outro atendimento no mesmo
 * dia, logo em seguida? Sessão do plano → a manutenção prevista naquela
 * semana; manutenção → a sessão do plano que falta agendar.
 */
export function emSeguida(p: {
  type: AppointmentType;
  date: string;
  orto: OrtoNaAgenda | null;
  sessoesAAgendar: number;
}): EmSeguida | null {
  if (!p.orto) return null;
  if (p.type === "treatment_session") {
    const prevista = manutencaoDaSemana(p.orto, p.date);
    if (!prevista) return null;
    return { tipo: "ortho_maintenance", providerId: p.orto.orthodontistId, prevista };
  }
  if (p.type === "ortho_maintenance" && p.sessoesAAgendar > 0) {
    return { tipo: "treatment_session", providerId: null };
  }
  return null;
}

/** O horário em que o primeiro atendimento termina ("HH:MM"). */
export function horarioEmSeguida(hora: string, duracaoMin: number): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hora);
  if (!m || !Number.isFinite(duracaoMin) || duracaoMin <= 0) return null;
  const total = Number(m[1]) * 60 + Number(m[2]) + Math.round(duracaoMin);
  if (total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
