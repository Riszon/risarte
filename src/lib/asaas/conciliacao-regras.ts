/**
 * ASA7 (4022, spec 21.2 item 4 e 21.7 item 3) — as regras PURAS da conciliação
 * das cobranças: o que o Asaas diz de cada cobrança contra o que o riSZon tem.
 * Sem banco e sem Asaas (testadas à parte).
 */

export type CobrancaDoAsaas = {
  id: string;
  status: string | null;
  value: number | null;
  deleted?: boolean | null;
  externalReference?: string | null;
  dateCreated?: string | null;
};

export type CobrancaDoRiszon = {
  id: string;
  asaas_payment_id: string | null;
  status: string;
  value_cents: number;
  is_external?: boolean | null;
};

export type TipoDeDivergencia =
  | "paga_no_asaas"
  | "situacao_diferente"
  | "valor_diferente"
  | "cancelada_so_no_asaas"
  | "cancelada_so_no_riszon"
  | "sem_no_asaas"
  | "fora_do_riszon";

export type Divergencia = {
  kind: TipoDeDivergencia;
  charge_id: string | null;
  asaas_payment_id: string | null;
  amount_cents: number | null;
  detail: Record<string, unknown>;
};

const PAGA_NO_ASAAS = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);
const ABERTA_NO_ASAAS = new Set(["PENDING", "OVERDUE", "AWAITING_RISK_ANALYSIS"]);

/**
 * As situações do riSZon que combinam com cada situação do Asaas. O riSZon
 * acompanha pelo aviso; um pequeno atraso do aviso (vencida ainda "emitida")
 * não é divergência.
 */
export function situacoesQueCombinam(statusAsaas: string | null, deleted: boolean): string[] {
  if (deleted) return ["cancelada"];
  const s = (statusAsaas ?? "").toUpperCase();
  if (s === "PENDING" || s === "AWAITING_RISK_ANALYSIS") return ["emitida"];
  if (s === "OVERDUE") return ["vencida", "emitida"];
  if (PAGA_NO_ASAAS.has(s)) return ["paga", "liquidada"];
  if (s === "REFUND_REQUESTED" || s === "REFUND_IN_PROGRESS") return ["paga", "liquidada"];
  if (s === "REFUNDED") return ["estornada"];
  if (s.startsWith("CHARGEBACK") || s === "AWAITING_CHARGEBACK_REVERSAL") return ["em_contestacao", "paga", "liquidada"];
  if (s === "DUNNING_REQUESTED" || s === "DUNNING_RECEIVED") return ["vencida", "paga", "liquidada"];
  return [];
}

/**
 * Compara. `asaas` = as cobranças que o Asaas devolveu nas listas desta rodada
 * (e nas leituras uma a uma); `riszon` = as cobranças do riSZon desta conta que
 * entram na rodada; `conhecidos` = TODOS os ids do Asaas que o riSZon conhece
 * nesta conta (para o "fora do riSZon"); `naoAchadas` = os ids do riSZon que a
 * leitura uma a uma não achou no Asaas (404).
 */
export function conciliar(a: {
  asaas: CobrancaDoAsaas[];
  riszon: CobrancaDoRiszon[];
  conhecidos: Set<string>;
  naoAchadas: Set<string>;
}): { divergencias: Divergencia[]; conferidas: { asaas: string[]; charges: string[] } } {
  const out: Divergencia[] = [];
  const porId = new Map(a.asaas.map((x) => [x.id, x]));
  const conferidasAsaas = new Set<string>();
  const conferidasRiszon = new Set<string>();

  for (const c of a.riszon) {
    if (c.is_external || !c.asaas_payment_id || c.status === "emitindo" || c.status === "erro_emissao") continue;
    conferidasRiszon.add(c.id);
    if (a.naoAchadas.has(c.asaas_payment_id)) {
      if (c.status !== "cancelada") {
        out.push({ kind: "sem_no_asaas", charge_id: c.id, asaas_payment_id: c.asaas_payment_id, amount_cents: c.value_cents, detail: { riszon: c.status } });
      }
      continue;
    }
    const x = porId.get(c.asaas_payment_id);
    if (!x) continue; // fora do alcance desta rodada
    conferidasAsaas.add(x.id);
    const deleted = !!x.deleted;
    const status = (x.status ?? "").toUpperCase();
    const combinam = situacoesQueCombinam(status, deleted);
    const valorAsaas = x.value == null ? null : Math.round(Number(x.value) * 100);
    const base = { asaas: deleted ? "DELETED" : status, riszon: c.status };
    if (!combinam.includes(c.status)) {
      let kind: TipoDeDivergencia = "situacao_diferente";
      if (PAGA_NO_ASAAS.has(status) && !deleted && (c.status === "emitida" || c.status === "vencida")) kind = "paga_no_asaas";
      else if (deleted && c.status !== "cancelada") kind = "cancelada_so_no_asaas";
      else if (c.status === "cancelada" && ABERTA_NO_ASAAS.has(status) && !deleted) kind = "cancelada_so_no_riszon";
      out.push({ kind, charge_id: c.id, asaas_payment_id: x.id, amount_cents: valorAsaas ?? c.value_cents, detail: base });
      continue;
    }
    // O valor só se compara com as duas pontas em aberto: depois de paga, o
    // Asaas grava o valor com o desconto de pontualidade (R$ 176,00 vira
    // R$ 167,20), e o recebido de verdade já é conferido pela baixa.
    if (!deleted && valorAsaas != null && valorAsaas !== c.value_cents && ABERTA_NO_ASAAS.has(status) && (c.status === "emitida" || c.status === "vencida")) {
      out.push({ kind: "valor_diferente", charge_id: c.id, asaas_payment_id: x.id, amount_cents: valorAsaas - c.value_cents,
                 detail: { ...base, valor_asaas: valorAsaas, valor_riszon: c.value_cents } });
    }
  }

  // Cobrança no Asaas que o riSZon não conhece (criada no painel, por fora).
  for (const x of a.asaas) {
    conferidasAsaas.add(x.id);
    if (x.deleted || a.conhecidos.has(x.id)) continue;
    out.push({ kind: "fora_do_riszon", charge_id: null, asaas_payment_id: x.id,
               amount_cents: x.value == null ? null : Math.round(Number(x.value) * 100),
               detail: { asaas: (x.status ?? "").toUpperCase(), referencia: x.externalReference ?? null, criada: x.dateCreated ?? null } });
  }
  return { divergencias: out, conferidas: { asaas: [...conferidasAsaas], charges: [...conferidasRiszon] } };
}

/** Os dias de 3 dias para trás (inclusive hoje), no formato do Asaas. */
export function janelaDe3Dias(hoje: string): string {
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 3);
  return d.toISOString().slice(0, 10);
}
