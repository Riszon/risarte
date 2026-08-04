"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import {
  buildSchedule,
  scheduleErrors,
  scheduleTotalCents,
  type ScheduleEntry,
} from "@/lib/payments";
import { PaymentScheduleEditor } from "@/components/payment-schedule-editor";
import {
  financedPlan,
  renegotiationBase,
  renegotiationErrors,
  renegotiationOutcome,
} from "@/lib/finance/renegotiation";
import type { InstallmentView } from "@/lib/finance/receivables";
import { saveRenegotiation } from "./receivables-actions";

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * FIN2 — a renegociação. A dívida apurada é **tudo o que é devido hoje**; o que
 * for perdoado é desconto, tem o teto da regra comercial da unidade e fica
 * registrado com motivo e autor (decisões do dono, 04/08/2026).
 */
export function RenegotiationDialog({
  open,
  onOpenChange,
  clientId,
  selected,
  today,
  maxDiscountPercent,
  isManager,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  selected: InstallmentView[];
  today: string;
  maxDiscountPercent: number | null;
  isManager: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [downPayment, setDownPayment] = useState("0,00");
  const [count, setCount] = useState(3);
  const [firstDue, setFirstDue] = useState(today);
  const [method, setMethod] = useState("boleto");
  const [rate, setRate] = useState("0");
  const [reason, setReason] = useState("");
  const [entries, setEntries] = useState<ScheduleEntry[] | null>(null);

  const base = useMemo(() => renegotiationBase(selected), [selected]);

  const downCents = parseBRLToCents(downPayment) ?? 0;
  const monthlyPercent = Math.max(0, Number(rate.replace(",", ".")) || 0);
  // Juros do parcelamento: quanto mais tempo para quitar, mais o cliente paga.
  const financed = useMemo(
    () =>
      financedPlan(
        Math.max(0, base.totalCents - downCents),
        monthlyPercent,
        Math.max(1, count)
      ),
    [base.totalCents, downCents, monthlyPercent, count]
  );

  // O parcelamento sugerido cobre a dívida (mais os juros, se houver); o
  // usuário edita à vontade — é a diferença que vira desconto ou acréscimo.
  const suggested = useMemo(
    () =>
      buildSchedule({
        totalCents: downCents + financed.financedTotalCents,
        downPaymentCents: downCents,
        installments: Math.max(1, count),
        firstDueDate: firstDue,
      }),
    [downCents, financed.financedTotalCents, count, firstDue]
  );
  const current = entries ?? suggested;
  const newTotal = scheduleTotalCents(current);

  const outcome = renegotiationOutcome({
    originalCents: base.totalCents,
    newCents: newTotal,
    maxDiscountPercent,
    isManager,
  });

  const errors = renegotiationErrors({
    selectedCount: base.count,
    originalCents: base.totalCents,
    newCents: newTotal,
    // O total do novo plano é livre (a diferença é o desconto); aqui só
    // checamos valores, datas e a entrada única.
    scheduleErrors: scheduleErrors(current, { totalCents: newTotal }),
  });
  const needsReason = outcome.discountCents !== 0 && !reason.trim();

  function save() {
    startTransition(async () => {
      const r = await saveRenegotiation({
        clientId,
        installmentIds: selected.map((v) => v.id),
        entries: current.map((e) => ({
          kind: e.kind,
          due_date: e.dueDate,
          amount_cents: e.amountCents,
          payment_method: method || null,
        })),
        reason,
        monthlyInterestPercent: monthlyPercent,
      });
      if (r.ok) {
        toast.success(
          outcome.needsAuthorization
            ? "Renegociação enviada para autorização do Gerente."
            : "Renegociação aplicada — as cobranças novas já estão na ficha."
        );
        onOpenChange(false);
        setEntries(null);
        setReason("");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Renegociar cobranças</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* 1) A dívida apurada hoje. */}
          <div className="space-y-1 rounded-lg border bg-muted/30 p-3">
            <p className="text-xs font-semibold">
              Dívida apurada hoje ({base.count} cobrança
              {base.count === 1 ? "" : "s"}
              {base.lateCount > 0 && `, ${base.lateCount} em atraso`})
            </p>
            <ul className="space-y-0.5 text-xs tabular-nums">
              <li className="flex justify-between">
                <span>Valor que falta das parcelas</span>
                <span>{formatBRL(base.principalCents)}</span>
              </li>
              {base.benefitCents > 0 && (
                <li className="flex justify-between text-destructive">
                  <span>Benefício perdido por atraso</span>
                  <span>+ {formatBRL(base.benefitCents)}</span>
                </li>
              )}
              {base.lateFeeCents > 0 && (
                <li className="flex justify-between text-destructive">
                  <span>Multa</span>
                  <span>+ {formatBRL(base.lateFeeCents)}</span>
                </li>
              )}
              {base.interestCents > 0 && (
                <li className="flex justify-between text-destructive">
                  <span>Juros</span>
                  <span>+ {formatBRL(base.interestCents)}</span>
                </li>
              )}
              <li className="flex justify-between border-t pt-0.5 font-semibold">
                <span>Total devido</span>
                <span>{formatBRL(base.totalCents)}</span>
              </li>
            </ul>
            <ul className="mt-1 space-y-0.5 border-t pt-1 text-[11px] text-muted-foreground">
              {selected.map((v) => (
                <li key={v.id} className="flex justify-between gap-2">
                  <span>
                    {v.kind === "entrada" ? "Entrada" : `Parcela ${v.seq}`} ·{" "}
                    {fmtDate(v.dueDate)}
                  </span>
                  <span className="tabular-nums">
                    {formatBRL(v.updatedBalanceCents)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* 2) O novo parcelamento. */}
          <div className="grid gap-2 sm:grid-cols-5">
            <div>
              <Label className="text-[11px]">Entrada (R$)</Label>
              <Input
                className="h-9 text-sm"
                inputMode="decimal"
                value={downPayment}
                onChange={(e) => {
                  setDownPayment(e.target.value);
                  setEntries(null);
                }}
              />
            </div>
            <div>
              <Label className="text-[11px]">Parcelas</Label>
              <Input
                className="h-9 text-sm"
                type="number"
                min={1}
                max={48}
                value={count}
                onChange={(e) => {
                  setCount(Number(e.target.value) || 1);
                  setEntries(null);
                }}
              />
            </div>
            <div>
              <Label className="text-[11px]">Juros ao mês (%)</Label>
              <Input
                className="h-9 text-sm"
                inputMode="decimal"
                value={rate}
                onChange={(e) => {
                  setRate(e.target.value);
                  setEntries(null);
                }}
              />
            </div>
            <div>
              <Label className="text-[11px]">1º vencimento</Label>
              <Input
                className="h-9 text-sm"
                type="date"
                value={firstDue}
                onChange={(e) => {
                  setFirstDue(e.target.value);
                  setEntries(null);
                }}
              />
            </div>
            <div>
              <Label className="text-[11px]">Forma de pagamento</Label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
              >
                <option value="boleto">Boleto</option>
                <option value="pix">PIX</option>
                <option value="credito_recorrente">
                  Recorrência no cartão
                </option>
                <option value="cartao_parcelado">Cartão parcelado</option>
                <option value="deposito_avista">Depósito</option>
              </select>
            </div>
          </div>

          {financed.interestCents > 0 && (
            <p className="rounded-lg border border-border bg-muted/30 p-2 text-xs">
              Parcelando {count}× a {monthlyPercent}% ao mês, o cliente paga{" "}
              <strong>{formatBRL(financed.installmentCents)}</strong> por
              parcela — <strong>{formatBRL(financed.interestCents)}</strong> de
              juros pelo tempo até quitar. Alongar o prazo aumenta esse valor.
            </p>
          )}

          <PaymentScheduleEditor
            entries={current}
            onChange={setEntries}
            totalCents={newTotal}
          />

          {/* 3) O resultado: desconto ou acréscimo. */}
          <div className="space-y-1 rounded-lg border p-3 text-xs tabular-nums">
            <p className="flex justify-between">
              <span>Dívida apurada</span>
              <span>{formatBRL(outcome.originalCents)}</span>
            </p>
            <p className="flex justify-between">
              <span>Novo parcelamento</span>
              <span>{formatBRL(outcome.newCents)}</span>
            </p>
            {outcome.discountCents > 0 && (
              <p className="flex justify-between font-semibold text-destructive">
                <span>Desconto concedido ({outcome.discountPercent}%)</span>
                <span>− {formatBRL(outcome.discountCents)}</span>
              </p>
            )}
            {outcome.discountCents < 0 && (
              <p className="flex justify-between font-semibold">
                <span>
                  Juros do parcelamento
                  {monthlyPercent > 0 && ` (${monthlyPercent}% ao mês)`}
                </span>
                <span>+ {formatBRL(-outcome.discountCents)}</span>
              </p>
            )}
            {maxDiscountPercent !== null && (
              <p className="text-[11px] font-normal text-muted-foreground">
                Teto de desconto da unidade: {maxDiscountPercent}%
              </p>
            )}
          </div>

          {outcome.needsAuthorization && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                Este desconto precisa de <strong>autorização do Gerente</strong>{" "}
                da unidade. A renegociação fica registrada e as cobranças só
                mudam quando ele aprovar.
              </span>
            </p>
          )}

          <div>
            <Label className="text-[11px]">
              Motivo {outcome.discountCents !== 0 && "(obrigatório)"}
            </Label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: cliente desempregado, acordo de quitação em 3x..."
              className="min-h-16 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
            />
          </div>

          {errors.length > 0 && (
            <ul className="space-y-0.5 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              {errors.map((e) => (
                <li key={e}>• {e}</li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={isPending || errors.length > 0 || needsReason}
            onClick={save}
          >
            <Check className="mr-1 size-4" />
            {outcome.needsAuthorization ? "Enviar para autorização" : "Renegociar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
