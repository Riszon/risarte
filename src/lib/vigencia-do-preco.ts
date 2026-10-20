// VIGÊNCIA DO PREÇO (0309, Odontograma OD1 — decisão D3 do dono, 20/10/2026).
//
// O preço de hoje continua onde sempre esteve; o banco guarda o histórico
// sozinho (gatilho) e aplica o reajuste agendado na madrugada da data. Aqui:
// a régua da DATA (hoje = já, futuro = agenda, passado = não pode) e o que a
// tela diz sobre os agendamentos. Puro e testado.

export type QuandoVale = "hoje" | "futuro" | "passado" | "invalida";

/** Datas no formato do campo de data (aaaa-mm-dd), comparadas como texto. */
export function quandoVale(data: string | null | undefined, hoje: string): QuandoVale {
  const d = (data ?? "").trim();
  if (d === "") return "hoje";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T12:00:00Z`))) return "invalida";
  if (d === hoje) return "hoje";
  return d > hoje ? "futuro" : "passado";
}

export const RECADO_DA_DATA: Record<Exclude<QuandoVale, "hoje" | "futuro">, string> = {
  passado: "O preço vale de hoje em diante — data no passado não é aceita.",
  invalida: "Data inválida.",
};

/** dd/mm/aaaa, sem fuso (a data já é a data civil). */
export function dataBr(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export type Agendamento = {
  id: string;
  procedureId: string;
  clinicId: string | null;
  priceCents: number;
  validFrom: string;
  note: string | null;
};

/** Os que já deviam ter sido aplicados (a madrugada falhou). */
export function atrasados(lista: Agendamento[], hoje: string): Agendamento[] {
  return lista.filter((a) => a.validFrom <= hoje);
}

/** O próximo reajuste de um preço (rede ou uma unidade), se houver. */
export function proximoReajuste(
  lista: Agendamento[],
  procedureId: string,
  clinicId: string | null
): Agendamento | null {
  const doPreco = lista
    .filter((a) => a.procedureId === procedureId && a.clinicId === clinicId)
    .sort((x, y) => x.validFrom.localeCompare(y.validFrom));
  return doPreco[0] ?? null;
}

export const ROTULO_DA_ORIGEM: Record<string, string> = {
  inicial: "ponto de partida",
  cadastro: "cadastro",
  alteracao: "alteração",
  agendado: "reajuste agendado",
  remocao: "ajuste da unidade removido",
};

/** Os recados do banco, em português. Desconhecido → nulo (nunca chuta). */
export function mensagemDaVigencia(erro: string): string | null {
  const mapa: [string, string][] = [
    ["DATE_NOT_FUTURE", "Para agendar, escolha uma data a partir de amanhã (hoje vale na hora)."],
    ["INVALID_PRICE", "Preço inválido."],
    ["INVALID_PERCENT", "Informe um percentual válido (ex.: 10 ou -5)."],
    ["NOTHING_SELECTED", "Nenhum procedimento no escopo."],
    ["SCHEDULE_NOT_OPEN", "Este reajuste já foi aplicado ou cancelado."],
    ["PRICE_HISTORY_IMMUTABLE", "O histórico de preço não pode ser alterado."],
    ["NOT_ALLOWED", "Só o Admin Master mexe no preço."],
  ];
  for (const [k, v] of mapa) if (erro.includes(k)) return v;
  return null;
}
