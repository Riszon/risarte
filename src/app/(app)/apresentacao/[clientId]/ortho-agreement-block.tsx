"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, SmilePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import {
  ORTHO_BILLING_METHODS,
  ORTHO_BILLING_METHOD_LABELS,
  ORTHO_KIND_LABELS,
  ORTHO_RETAINER_KIND_LABELS,
  type OrthoBillingMethod,
  type OrthoKind,
  type OrthoRetainerKind,
} from "@/lib/ortodontia/constants";
import type { NegotiationOrthoBlock } from "./negotiation-loader";
import { saveNegotiationOrtho } from "./negotiation-actions";

const selectClass = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";
const reais = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

/**
 * ORTO8 (R5/R7): o ACORDO ORTODÔNTICO da negociação — o Consultor fecha a
 * mensalidade, quantas mensalidades neste lote, a forma de emissão, o dia, o
 * desconto por pontualidade e a contenção (cobrada ou não), dentro dos
 * limites da unidade (Q4). Fora do limite, a negociação cai em autorização do
 * Gerente, pelo mesmo caminho das outras regras. No fechamento da venda, o
 * caso ortodôntico nasce com este acordo.
 */
export function OrthoAgreementBlock({
  clientId,
  negotiationId,
  optionId,
  ortho,
  locked,
}: {
  clientId: string;
  /** Nulo = a negociação ainda não foi salva (o acordo precisa dela). */
  negotiationId: string | null;
  optionId: string;
  ortho: NegotiationOrthoBlock;
  locked: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const a = ortho.agreement;
  const d = ortho.defaults;
  const proposal = ortho.proposalByOption[optionId] ?? null;
  const [monthly, setMonthly] = useState(reais(a?.monthlyFeeCents ?? d.monthlyFeeCents));
  const [count, setCount] = useState<number>(a?.installmentsCount ?? (proposal ? Math.min(120, Math.max(1, proposal.plannedMonths)) : 12));
  const [method, setMethod] = useState<OrthoBillingMethod>((a?.billingMethod as OrthoBillingMethod) ?? "boleto");
  const [day, setDay] = useState<number>(a?.billingDay ?? d.billingDay);
  const [punct, setPunct] = useState(String(a?.punctualityDiscountPercent ?? d.punctualityDiscountPercent).replace(".", ","));
  const [retainerCharged, setRetainerCharged] = useState(a?.retainerCharged ?? d.retainerChargeEnabled);
  const [retainerFee, setRetainerFee] = useState(reais(a?.retainerFeeCents ?? d.retainerFeeCents));
  const [retainerTerms, setRetainerTerms] = useState(a?.retainerTerms ?? d.retainerTerms ?? "");
  const [notes, setNotes] = useState(a?.notes ?? "");

  const monthlyCents = parseBRLToCents(monthly) ?? 0;
  const punctNum = Number.parseFloat(punct.replace(",", ".")) || 0;
  const live: string[] = [];
  if (d.minMonthlyFeeCents > 0 && monthlyCents < d.minMonthlyFeeCents) {
    live.push(`mensalidade abaixo do mínimo de ${formatBRL(d.minMonthlyFeeCents)}`);
  }
  if (punctNum > d.maxPunctualityDiscountPercent) {
    live.push(`pontualidade acima do máximo (${d.maxPunctualityDiscountPercent}%)`);
  }
  if (retainerCharged && (parseBRLToCents(retainerFee) ?? 0) <= 0) live.push("contenção cobrada sem valor");

  function save() {
    if (!negotiationId) return;
    startTransition(async () => {
      const r = await saveNegotiationOrtho(clientId, negotiationId, {
        monthlyFeeCents: monthlyCents,
        installmentsCount: count,
        billingMethod: method,
        billingDay: day,
        punctualityDiscountPercent: punctNum,
        retainerCharged,
        retainerFeeCents: retainerCharged ? (parseBRLToCents(retainerFee) ?? 0) : 0,
        retainerTerms: retainerCharged ? retainerTerms : "",
        notes,
      });
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível salvar o acordo ortodôntico.");
        return;
      }
      if (r.violations && r.violations.length > 0) {
        toast.warning("Acordo fora da regra — enviado ao Gerente da unidade para autorização.");
      } else {
        toast.success("Acordo ortodôntico salvo.");
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-gold/50 bg-gold/5 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <SmilePlus className="size-4 text-gold-foreground" /> Acordo ortodôntico
        </p>
        <p className="text-[11px] text-muted-foreground">
          Limites da unidade: mensalidade mínima {formatBRL(d.minMonthlyFeeCents)} · pontualidade até {d.maxPunctualityDiscountPercent}%
        </p>
      </div>
      {proposal ? (
        <p className="mb-3 text-xs text-muted-foreground">
          Proposta do Planner: <strong>{ORTHO_KIND_LABELS[proposal.treatmentKind as OrthoKind] ?? proposal.treatmentKind}</strong>, previsão de{" "}
          <strong>{proposal.plannedMonths} meses</strong> (referência), manutenção a cada {proposal.maintenanceIntervalDays} dias, contenção final{" "}
          {ORTHO_RETAINER_KIND_LABELS[proposal.retainerKind as OrthoRetainerKind]?.toLowerCase() ?? proposal.retainerKind}. Você fecha o
          dinheiro; as características são do plano.
        </p>
      ) : (
        <p className="mb-3 text-xs text-muted-foreground">
          Esta opção tem procedimento de Ortodontia. Você fecha a mensalidade e a forma; as características do caso (tipo, meses, contenção) vêm do plano — peça ao Planner a proposta ortodôntica se faltar.
        </p>
      )}
      {!negotiationId && (
        <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          Salve a negociação primeiro; o acordo ortodôntico é gravado sobre ela.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="ortho-monthly">Mensalidade (R$)</Label>
          <Input id="ortho-monthly" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} disabled={locked || isPending} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ortho-count">Quantas mensalidades (este lote)</Label>
          <Input id="ortho-count" type="number" min={1} max={120} value={count} onChange={(e) => setCount(Number(e.target.value))} disabled={locked || isPending} />
          <p className="text-[11px] text-muted-foreground">Faltando 60/30/15 dias do fim, o sistema avisa para emitir mais ou encerrar.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ortho-method">Como as mensalidades são emitidas</Label>
          <select id="ortho-method" className={selectClass} value={method} onChange={(e) => setMethod(e.target.value as OrthoBillingMethod)} disabled={locked || isPending}>
            {ORTHO_BILLING_METHODS.map((m) => (
              <option key={m} value={m}>{ORTHO_BILLING_METHOD_LABELS[m]}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ortho-day">Dia de vencimento</Label>
          <Input id="ortho-day" type="number" min={1} max={28} value={day} onChange={(e) => setDay(Number(e.target.value))} disabled={locked || isPending} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ortho-punct">Desconto por pontualidade (%)</Label>
          <Input id="ortho-punct" inputMode="decimal" value={punct} onChange={(e) => setPunct(e.target.value)} disabled={locked || isPending} />
          <p className="text-[11px] text-muted-foreground">Para quem paga até o vencimento.</p>
        </div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={retainerCharged} onChange={(e) => setRetainerCharged(e.target.checked)} disabled={locked || isPending} />
            Cobrar a contenção na entrega (fim do tratamento)
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="ortho-ret-fee">Valor da contenção (R$)</Label>
              <Input id="ortho-ret-fee" inputMode="decimal" value={retainerFee} onChange={(e) => setRetainerFee(e.target.value)} disabled={locked || isPending || !retainerCharged} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="ortho-ret-terms">Condição especial da contenção</Label>
              <Input id="ortho-ret-terms" value={retainerTerms} onChange={(e) => setRetainerTerms(e.target.value)} disabled={locked || isPending || !retainerCharged} placeholder="Ex.: em até 3x sem juros" />
            </div>
          </div>
        </div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-4">
          <Label htmlFor="ortho-notes">Observações do acordo</Label>
          <Input id="ortho-notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={locked || isPending} placeholder="Ex.: primeira mensalidade 30 dias após a instalação" />
        </div>
      </div>
      {!locked && live.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>Fora do limite da ortodontia: {live.join("; ")}. Ao salvar, o Gerente da unidade será acionado para autorizar.</span>
        </p>
      )}
      {!locked && (
        <div className="mt-3">
          <Button size="sm" onClick={save} disabled={isPending || !negotiationId}>
            {isPending ? "Salvando…" : a ? "Salvar acordo ortodôntico" : "Fechar acordo ortodôntico"}
          </Button>
        </div>
      )}
      {locked && a && (
        <p className="mt-2 text-xs text-muted-foreground">
          Acordo fechado: {formatBRL(a.monthlyFeeCents)}/mês × {a.installmentsCount} · {ORTHO_BILLING_METHOD_LABELS[a.billingMethod as OrthoBillingMethod] ?? a.billingMethod} · dia {a.billingDay}
          {a.punctualityDiscountPercent > 0 ? ` · ${a.punctualityDiscountPercent}% de pontualidade` : ""} · contenção {a.retainerCharged ? `cobrada (${formatBRL(a.retainerFeeCents)})` : "incluída"}.
        </p>
      )}
    </div>
  );
}
