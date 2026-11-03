import { addDaysIso, isoDateIn, weekdayOf } from "@/lib/dates";

/**
 * OS NÚMEROS E AS LISTAS DO PAINEL DAS ASSINATURAS (ZS7, plano ZS0 §9). Regra
 * pura, testada em `assinaturas-painel.test.ts`, sobre as linhas da leitura
 * única `signature_report_rows` (0347). A tela, o relatório (PDF e planilha) e
 * o relatório mensal usam ESTA conta — os números nunca divergem.
 *
 * Como cada número é contado (todas as datas no dia de Brasília):
 *   * Enviados — `sent_at` no período.
 *   * Assinados — situação "assinado" com a conclusão no período.
 *   * Taxa de assinatura — dos ENVIADOS no período, quantos já estão
 *     assinados (a mesma turma, para não misturar meses).
 *   * Faltam assinar — aguardando AGORA (não depende do período): separado em
 *     "esperando o cliente" e "esperando a equipe" (testemunhas ou Risarte).
 *   * Recusados / vencidos / cancelados — encerrados assim no período.
 *   * Tempo de resposta do cliente — do envio à assinatura do cliente, para os
 *     clientes que assinaram no período (média e mediana, em horas).
 *   * Tempo total — do envio à conclusão, para os assinados no período.
 *   * Faixas de espera — os que faltam assinar, pelos dias desde o envio.
 */

export type ItemDaLinha = { title: string; template_id: string | null; kind: string | null };

export type LinhaDoPainel = {
  id: string;
  number: string;
  clinic_id: string;
  clinic_name: string | null;
  audience: "patient" | "company";
  status: string;
  current_stage: string;
  client_name: string | null;
  client_id: string | null;
  company_id: string | null;
  lead_id: string | null;
  origin_type: string;
  origin_id: string | null;
  sent_at: string;
  client_signed_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
  ended_at: string | null;
  cancel_reason: string | null;
  refused_reason: string | null;
  sent_by: string | null;
  sent_by_name: string | null;
  cancelled_by_name: string | null;
  items: ItemDaLinha[];
};

export type Periodo = { de: string; ate: string };

export const LISTAS = ["enviados", "assinados", "faltam", "recusados", "vencidos", "cancelados"] as const;
export type ListaDoPainel = (typeof LISTAS)[number];

export const ROTULO_DA_LISTA: Record<ListaDoPainel, string> = {
  enviados: "Enviados",
  assinados: "Assinados",
  faltam: "Faltam assinar",
  recusados: "Recusados",
  vencidos: "Vencidos",
  cancelados: "Cancelados",
};

export type Tempo = { quantos: number; mediaHoras: number | null; medianaHoras: number | null };

export type Indicadores = {
  enviados: number;
  assinados: number;
  taxaPercent: number | null;
  assinadosDaTurma: number;
  faltam: number;
  faltamCliente: number;
  faltamEquipe: number;
  recusados: number;
  vencidos: number;
  cancelados: number;
  tempoCliente: Tempo;
  tempoTotal: Tempo;
  faixas: { rotulo: string; quantos: number }[];
  motivosCancelamento: { motivo: string; quantos: number }[];
  /** Enviados × assinados por semana (período de até 10 semanas) ou por mês. */
  serie: { inicio: string; enviados: number; assinados: number }[];
  seriePorMes: boolean;
  porUnidade: { clinicId: string; nome: string; enviados: number; assinados: number; faltam: number; taxaPercent: number | null }[];
};

/** Dia de Brasília de um instante ("AAAA-MM-DD"). */
export function diaEmBrasilia(instante: string | null): string | null {
  if (!instante) return null;
  const d = new Date(instante);
  return Number.isNaN(d.getTime()) ? null : isoDateIn(d);
}

const noPeriodo = (instante: string | null, p: Periodo) => {
  const d = diaEmBrasilia(instante);
  return !!d && d >= p.de && d <= p.ate;
};

const aguardando = (l: LinhaDoPainel) => l.status === "sent" || l.status === "partially_signed";

/** Dias desde o envio, no calendário de Brasília. */
export function diasDeEspera(l: Pick<LinhaDoPainel, "sent_at">, hoje: string): number {
  const d = diaEmBrasilia(l.sent_at);
  if (!d) return 0;
  return Math.max(0, Math.round((Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000));
}

/** As faixas a partir dos limites das Configurações (padrão {2,5,7}). */
export function rotulosDasFaixas(limites: number[]): string[] {
  const ls = [...new Set(limites.filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
  if (ls.length === 0) return ["todos"];
  const rotulos: string[] = [];
  let anterior = 0;
  for (const l of ls) {
    rotulos.push(anterior === 0 ? `até ${l} dia${l === 1 ? "" : "s"}` : anterior + 1 === l ? `${l} dias` : `${anterior + 1} a ${l} dias`);
    anterior = l;
  }
  rotulos.push(`mais de ${anterior} dias`);
  return rotulos;
}

/** O índice da faixa de um pacote que espera há `dias` dias. */
export function faixaDe(dias: number, limites: number[]): number {
  const ls = [...new Set(limites.filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
  const i = ls.findIndex((l) => dias <= l);
  return i < 0 ? ls.length : i;
}

function tempo(horas: number[]): Tempo {
  if (horas.length === 0) return { quantos: 0, mediaHoras: null, medianaHoras: null };
  const ordenadas = [...horas].sort((a, b) => a - b);
  const meio = Math.floor(ordenadas.length / 2);
  const mediana = ordenadas.length % 2 ? ordenadas[meio] : (ordenadas[meio - 1] + ordenadas[meio]) / 2;
  return { quantos: horas.length, mediaHoras: horas.reduce((s, h) => s + h, 0) / horas.length, medianaHoras: mediana };
}

const horasEntre = (de: string, ate: string) => Math.max(0, (Date.parse(ate) - Date.parse(de)) / 3_600_000);

const taxa = (assinados: number, enviados: number) => (enviados > 0 ? Math.round((assinados / enviados) * 1000) / 10 : null);

/** Segunda-feira da semana de um dia civil. */
function inicioDaSemana(dia: string): string {
  const dow = weekdayOf(dia);
  return addDaysIso(dia, dow === 0 ? -6 : 1 - dow);
}

/** O primeiro dia do mês seguinte ("AAAA-MM-01"). */
function proximoMes(dia: string): string {
  const a = Number(dia.slice(0, 4));
  const m = Number(dia.slice(5, 7));
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
}

/** Motivos que não são de gente (rascunho descartado, PDF que falhou) não contam como cancelamento. */
const MOTIVOS_TECNICOS = new Set(["draft_discarded", "pdf_failed"]);

export function calcularIndicadores(linhas: LinhaDoPainel[], periodo: Periodo, opts: { hoje: string; faixas: number[] }): Indicadores {
  const enviadosL = linhas.filter((l) => noPeriodo(l.sent_at, periodo));
  const assinadosL = linhas.filter((l) => l.status === "signed" && noPeriodo(l.completed_at, periodo));
  const faltamL = linhas.filter(aguardando);
  const encerrados = (s: string) => linhas.filter((l) => l.status === s && noPeriodo(l.ended_at, periodo));
  const canceladosL = encerrados("cancelled").filter((l) => !MOTIVOS_TECNICOS.has(l.cancel_reason ?? ""));
  const assinadosDaTurma = enviadosL.filter((l) => l.status === "signed").length;

  const rotulos = rotulosDasFaixas(opts.faixas);
  const faixas = rotulos.map((rotulo) => ({ rotulo, quantos: 0 }));
  for (const l of faltamL) faixas[faixaDe(diasDeEspera(l, opts.hoje), opts.faixas)].quantos++;

  const motivos = new Map<string, number>();
  for (const l of canceladosL) {
    const m = (l.cancel_reason ?? "").trim() || "sem motivo informado";
    motivos.set(m, (motivos.get(m) ?? 0) + 1);
  }

  // Até 10 semanas, por semana (começa na segunda); mais que isso, por mês.
  const dias = (Date.parse(`${periodo.ate}T00:00:00Z`) - Date.parse(`${periodo.de}T00:00:00Z`)) / 86_400_000;
  const seriePorMes = dias > 70;
  const chave = (dia: string) => (seriePorMes ? `${dia.slice(0, 7)}-01` : inicioDaSemana(dia));
  const serie = new Map<string, { inicio: string; enviados: number; assinados: number }>();
  for (let d = chave(periodo.de); d <= periodo.ate; d = seriePorMes ? proximoMes(d) : addDaysIso(d, 7)) serie.set(d, { inicio: d, enviados: 0, assinados: 0 });
  for (const l of enviadosL) serie.get(chave(diaEmBrasilia(l.sent_at)!))!.enviados++;
  for (const l of assinadosL) {
    const s = serie.get(chave(diaEmBrasilia(l.completed_at)!));
    if (s) s.assinados++;
  }

  const unidades = new Map<string, { clinicId: string; nome: string; enviados: number; assinados: number; faltam: number; turma: number }>();
  const unidade = (l: LinhaDoPainel) => {
    let u = unidades.get(l.clinic_id);
    if (!u) {
      u = { clinicId: l.clinic_id, nome: l.clinic_name ?? "Unidade", enviados: 0, assinados: 0, faltam: 0, turma: 0 };
      unidades.set(l.clinic_id, u);
    }
    return u;
  };
  for (const l of enviadosL) {
    const u = unidade(l);
    u.enviados++;
    if (l.status === "signed") u.turma++;
  }
  for (const l of assinadosL) unidade(l).assinados++;
  for (const l of faltamL) unidade(l).faltam++;

  return {
    enviados: enviadosL.length,
    assinados: assinadosL.length,
    taxaPercent: taxa(assinadosDaTurma, enviadosL.length),
    assinadosDaTurma,
    faltam: faltamL.length,
    faltamCliente: faltamL.filter((l) => l.current_stage === "client").length,
    faltamEquipe: faltamL.filter((l) => l.current_stage !== "client").length,
    recusados: encerrados("refused").length,
    vencidos: encerrados("expired").length,
    cancelados: canceladosL.length,
    tempoCliente: tempo(
      linhas.filter((l) => l.client_signed_at && noPeriodo(l.client_signed_at, periodo)).map((l) => horasEntre(l.sent_at, l.client_signed_at!))
    ),
    tempoTotal: tempo(assinadosL.map((l) => horasEntre(l.sent_at, l.completed_at!))),
    faixas,
    motivosCancelamento: [...motivos].map(([motivo, quantos]) => ({ motivo, quantos })).sort((a, b) => b.quantos - a.quantos),
    serie: [...serie.values()],
    seriePorMes,
    porUnidade: [...unidades.values()]
      .map((u) => ({ clinicId: u.clinicId, nome: u.nome, enviados: u.enviados, assinados: u.assinados, faltam: u.faltam, taxaPercent: taxa(u.turma, u.enviados) }))
      .sort((a, b) => b.enviados - a.enviados || a.nome.localeCompare(b.nome, "pt-BR")),
  };
}

/** As linhas de uma lista do painel, na ordem em que fazem sentido. */
export function linhasDaLista(
  linhas: LinhaDoPainel[],
  lista: ListaDoPainel,
  periodo: Periodo,
  opts: { hoje: string; faixas: number[]; faixa?: number | null }
): LinhaDoPainel[] {
  const porData = (campo: keyof LinhaDoPainel) => (a: LinhaDoPainel, b: LinhaDoPainel) => String(b[campo] ?? "").localeCompare(String(a[campo] ?? ""));
  switch (lista) {
    case "enviados":
      return linhas.filter((l) => noPeriodo(l.sent_at, periodo)).sort(porData("sent_at"));
    case "assinados":
      return linhas.filter((l) => l.status === "signed" && noPeriodo(l.completed_at, periodo)).sort(porData("completed_at"));
    case "faltam":
      return linhas
        .filter(aguardando)
        .filter((l) => opts.faixa == null || faixaDe(diasDeEspera(l, opts.hoje), opts.faixas) === opts.faixa)
        .sort((a, b) => a.sent_at.localeCompare(b.sent_at));
    case "recusados":
      return linhas.filter((l) => l.status === "refused" && noPeriodo(l.ended_at, periodo)).sort(porData("ended_at"));
    case "vencidos":
      return linhas.filter((l) => l.status === "expired" && noPeriodo(l.ended_at, periodo)).sort(porData("ended_at"));
    case "cancelados":
      return linhas
        .filter((l) => l.status === "cancelled" && noPeriodo(l.ended_at, periodo) && !MOTIVOS_TECNICOS.has(l.cancel_reason ?? ""))
        .sort(porData("ended_at"));
  }
}

/** Quem está segurando um pacote que falta assinar. */
export function quemSegura(l: Pick<LinhaDoPainel, "current_stage">): string {
  return l.current_stage === "client" ? "o cliente" : l.current_stage === "witnesses" ? "as testemunhas" : "a Risarte";
}

/**
 * De onde o pacote veio (pedido do dono): a negociação do paciente abre no
 * painel de negociação e fechamento; o envio pela ficha abre a ficha; o
 * Empresarial abre a empresa (aba Contratos) ou o lead (aba Envio e selos).
 */
export function linkDaOrigem(
  l: Pick<LinhaDoPainel, "origin_type" | "client_id" | "company_id" | "lead_id">
): { href: string; rotulo: string } | null {
  if (l.client_id && (l.origin_type === "plan_negotiation" || l.origin_type === "treatment_plan")) {
    return { href: `/apresentacao/${l.client_id}`, rotulo: "Abrir a negociação" };
  }
  if (l.client_id) return { href: `/prontuarios/${l.client_id}?aba=documentos`, rotulo: "Abrir a ficha" };
  if (l.company_id) return { href: `/empresarial/${l.company_id}?aba=contratos`, rotulo: "Abrir a empresa" };
  if (l.lead_id) return { href: `/empresarial/funil/${l.lead_id}?aba=envio`, rotulo: "Abrir a negociação" };
  return null;
}

/** "3 h", "1,5 dia" — o tempo do painel, em palavras curtas. */
export function textoDoTempo(horas: number | null): string {
  if (horas == null) return "—";
  if (horas < 24) return `${Math.max(1, Math.round(horas))} h`;
  const dias = horas / 24;
  return `${dias.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dia${dias >= 2 ? "s" : ""}`;
}
