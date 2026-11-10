import type { ScheduleEntry } from "@/lib/payments";

/**
 * 0374 (AP130/AP131, 10/11/2026): A PROPOSTA DE PAGAMENTO MORA NA NEGOCIAÇÃO.
 *
 * Com a negociação aberta, o "Salvar negociação" guarda o parcelamento em
 * `plan_negotiations.proposed_schedule` — nenhuma cobrança nasce. As cobranças
 * (`payment_installments`) só existem depois do "Cliente aceitou".
 *
 * Quem MOSTRA o parcelamento da negociação (cockpit, orçamento impresso) usa
 * `parcelamentoDaNegociacao`: as cobranças de verdade quando existem; senão, a
 * proposta guardada. Ler só as cobranças deixaria a negociação aberta sem
 * parcelamento na tela.
 */

export type LinhaDeCobranca = {
  seq: number;
  kind: string | null;
  due_date: string;
  amount_cents: number;
  status?: string | null;
};

/** Converte o `proposed_schedule` (jsonb) com tolerância: lixo vira vazio. */
export function lerProposta(valor: unknown): ScheduleEntry[] {
  if (!Array.isArray(valor)) return [];
  const out: ScheduleEntry[] = [];
  valor.forEach((e, i) => {
    if (!e || typeof e !== "object") return;
    const r = e as Record<string, unknown>;
    const amount = Number(r.amount_cents);
    const due = typeof r.due_date === "string" ? r.due_date.slice(0, 10) : null;
    if (!due || !Number.isFinite(amount)) return;
    out.push({
      seq: i + 1,
      kind: r.kind === "entrada" ? "entrada" : "parcela",
      dueDate: due,
      amountCents: amount,
    });
  });
  return out;
}

export function parcelamentoDaNegociacao(
  cobrancas: LinhaDeCobranca[],
  proposta: unknown
): ScheduleEntry[] {
  const vivas = cobrancas.filter((c) => c.status !== "cancelada");
  if (vivas.length > 0) {
    return [...vivas]
      .sort((a, b) => a.seq - b.seq)
      .map((c) => ({
        seq: c.seq,
        kind: c.kind === "entrada" ? "entrada" : "parcela",
        dueDate: String(c.due_date).slice(0, 10),
        amountCents: Number(c.amount_cents),
      }));
  }
  return lerProposta(proposta);
}
