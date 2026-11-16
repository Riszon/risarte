import type { SessionContext } from "@/lib/auth";

/**
 * ASA6 (4021, spec 20) — a cobrança mensal da rede: quem vê, os rótulos e a
 * planilha do demonstrativo. Puro (sem banco): o banco decide de novo em cada
 * leitura e ação.
 */

/** Gerente e franqueado (a sua unidade), Financeiro da Franqueadora e Admin Master (a rede). */
export function podeVerCobrancaDaRede(session: SessionContext): boolean {
  if (session.isAdminMaster) return true;
  const papeis = Object.values(session.rolesByClinic).flat();
  return papeis.includes("finance_franchisor") || papeis.includes("unit_manager") || papeis.includes("franchisee");
}

export type LoteDaLista = {
  id: string;
  clinic_id: string;
  clinic_name: string;
  period: string;
  status: string;
  total_cents: number | null;
  preview_deadline: string;
  unit_ack_at: string | null;
  due_date: string | null;
  paid_on: string | null;
  charge_status: string | null;
  example_values: boolean;
  contests: number;
};

export type ItemDoLote = {
  id: string;
  kind: "fixa" | "percentual" | "ajuste" | "credito" | "saldo_anterior";
  fee: string;
  fee_label: string;
  origin_period: string;
  split_charge_id: string | null;
  payable_id: string | null;
  credit_of_item_id: string | null;
  received_on: string | null;
  method: string | null;
  origin_label: string | null;
  patient_code: string | null;
  patient_short: string | null;
  base_cents: number | null;
  percent: number | null;
  amount_cents: number;
  description: string | null;
  status: "ativo" | "contestado" | "dispensado";
  contest_reason: string | null;
  contest_attachment_path: string | null;
  contested_at: string | null;
  decision: "aceita" | "recusada" | null;
  decision_reason: string | null;
  decided_at: string | null;
  after_issue: boolean;
};

export type LoteLido = {
  batch: {
    id: string;
    clinic_id: string;
    period: string;
    status: string;
    preview_deadline: string;
    unit_ack_at: string | null;
    total_cents: number | null;
    due_date: string | null;
    fine_percent: number | null;
    interest_percent_month: number | null;
    paid_on: string | null;
    paid_cents: number | null;
    late_cents: number | null;
    settle_note: string | null;
    cancel_reason: string | null;
    example_values: boolean;
  };
  clinic: { id: string; name: string; legal_name: string | null; cnpj: string | null };
  charge: {
    id: string;
    status: string;
    invoice_url: string | null;
    bank_slip_url: string | null;
    identification_field: string | null;
    pix_copy_paste: string | null;
    due_date: string | null;
    value_cents: number | null;
    paid_cents: number | null;
    paid_on: string | null;
    error_code: string | null;
  } | null;
  can_manage: boolean;
  can_contest: boolean;
  items: ItemDoLote[];
  info: { retido_cents: number; a_reter_cents: number; dispensado_cents: number } | null;
  notice: string | null;
};

export type SaldoAnterior = {
  clinicId: string;
  first_period: string | null;
  decision: { decision: string; installments: number; total_cents: number; reason: string; decided_at: string; decided_by: string | null } | null;
  lines: { payable_id: string; fee: string; label: string; period: string; amount_cents: number; paid_cents: number; open_cents: number; due_date: string; status: string }[];
};

export const SITUACAO_DO_LOTE: Record<string, { rotulo: string; tom: string }> = {
  previa: { rotulo: "Prévia", tom: "bg-sky-100 text-sky-900" },
  aprovada: { rotulo: "Aprovada (emitindo)", tom: "bg-indigo-100 text-indigo-900" },
  emitida: { rotulo: "Emitida", tom: "bg-amber-100 text-amber-900" },
  paga: { rotulo: "Paga", tom: "bg-emerald-100 text-emerald-900" },
  sem_cobranca: { rotulo: "Nada a cobrar", tom: "bg-muted text-muted-foreground" },
  acumulada: { rotulo: "Acumula para o mês seguinte", tom: "bg-muted text-muted-foreground" },
  cancelada: { rotulo: "Cancelada", tom: "bg-muted text-muted-foreground" },
};

export const TIPO_DA_LINHA: Record<ItemDoLote["kind"], string> = {
  fixa: "Taxa fixa",
  percentual: "A cobrar",
  ajuste: "Ajuste de mês anterior",
  credito: "Crédito",
  saldo_anterior: "Saldo anterior",
};

export const mesAno = (iso: string) => {
  const [y, m] = iso.slice(0, 10).split("-");
  return `${m}/${y}`;
};

/** O resumo do demonstrativo (20.4): por tipo de linha e por taxa. */
export function resumoDoLote(itens: ItemDoLote[]) {
  const vale = itens.filter((i) => i.status !== "dispensado");
  const soma = (f: (i: ItemDoLote) => boolean) => vale.filter(f).reduce((s, i) => s + Number(i.amount_cents), 0);
  const porTaxa = new Map<string, { label: string; total: number }>();
  for (const i of vale.filter((x) => x.kind === "percentual")) {
    const t = porTaxa.get(i.fee) ?? { label: i.fee_label, total: 0 };
    t.total += Number(i.amount_cents);
    porTaxa.set(i.fee, t);
  }
  return {
    fixas: soma((i) => i.kind === "fixa"),
    porTaxa: [...porTaxa.values()],
    ajustes: soma((i) => i.kind === "ajuste" || i.kind === "credito"),
    saldoAnterior: soma((i) => i.kind === "saldo_anterior"),
    total: soma(() => true),
  };
}

/** A planilha do demonstrativo (CSV com ponto e vírgula, para o Excel em português). */
export function planilhaDoLote(lido: LoteLido): string {
  const cel = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const reais = (c: number | null) => (c == null ? "" : (Number(c) / 100).toFixed(2).replace(".", ","));
  const cab = ["Tipo", "Taxa", "Mês de origem", "Data", "Origem", "Paciente (código)", "Paciente", "Base (R$)", "Percentual", "Valor (R$)", "Situação", "Contestação", "Decisão"];
  const linhas = lido.items.map((i) => [
    TIPO_DA_LINHA[i.kind],
    i.fee_label,
    mesAno(i.origin_period),
    i.received_on ? i.received_on.slice(0, 10).split("-").reverse().join("/") : "",
    i.origin_label ?? i.description ?? "",
    i.patient_code ?? "",
    i.patient_short ?? "",
    reais(i.base_cents),
    i.percent == null ? "" : String(i.percent).replace(".", ","),
    reais(i.amount_cents),
    i.status,
    i.contest_reason ?? "",
    i.decision ? `${i.decision}: ${i.decision_reason ?? ""}` : "",
  ]);
  return [cab, ...linhas].map((l) => l.map(cel).join(";")).join("\r\n");
}
