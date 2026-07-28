"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Plus, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import {
  buildSchedule,
  scheduleErrors,
  scheduleTotalCents,
  type ScheduleEntry,
} from "@/lib/payments";
import { savePaymentSchedule } from "@/app/(app)/comercial/payment-schedule-actions";

const inputClass = "h-9";

function toReais(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * I9: entrada + parcelas personalizadas. Serve à negociação do consultor e à
 * venda direta — o mesmo plano de cobrança que o Financeiro vai usar depois.
 */
export function PaymentScheduleEditor({
  negotiationId,
  directSaleId,
  totalCents,
  minInstallmentCents,
  initial,
  readOnly,
}: {
  negotiationId?: string;
  directSaleId?: string;
  /** Valor final da venda — a soma das cobranças tem de fechar com ele. */
  totalCents: number;
  minInstallmentCents?: number | null;
  initial?: ScheduleEntry[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [entries, setEntries] = useState<ScheduleEntry[]>(initial ?? []);
  const [downReais, setDownReais] = useState("");
  const [count, setCount] = useState("1");
  const [firstDue, setFirstDue] = useState(today());
  const [everyDays, setEveryDays] = useState("");

  const total = scheduleTotalCents(entries);
  const errors = useMemo(
    () =>
      entries.length > 0
        ? scheduleErrors(entries, { totalCents, minInstallmentCents })
        : [],
    [entries, totalCents, minInstallmentCents]
  );
  const missing = totalCents - total;

  function generate() {
    const down = downReais.trim() ? (parseBRLToCents(downReais) ?? 0) : 0;
    const n = Math.max(0, Number.parseInt(count || "0", 10) || 0);
    setEntries(
      buildSchedule({
        totalCents,
        downPaymentCents: down,
        installments: n,
        firstDueDate: firstDue,
        everyDays: everyDays ? Number(everyDays) : undefined,
      })
    );
  }

  function update(i: number, patch: Partial<ScheduleEntry>) {
    setEntries((prev) =>
      prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e))
    );
  }

  function addRow() {
    setEntries((prev) => [
      ...prev,
      {
        seq: prev.length + 1,
        kind: "parcela",
        dueDate: prev.at(-1)?.dueDate ?? firstDue,
        amountCents: Math.max(0, missing),
      },
    ]);
  }

  function save() {
    startTransition(async () => {
      const r = await savePaymentSchedule({
        negotiationId,
        directSaleId,
        entries: entries.map((e, i) => ({ ...e, seq: i + 1 })),
      });
      if (r.ok) {
        toast.success("Plano de pagamento salvo.");
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível salvar.");
      }
    });
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <CalendarClock className="size-4 text-primary" />
          Entrada + parcelas
        </p>
        <span className="text-xs text-muted-foreground">
          Valor da venda: <strong>{formatBRL(totalCents)}</strong>
        </span>
      </div>

      {!readOnly && (
        <div className="grid gap-2 rounded-md bg-muted/40 p-2 sm:grid-cols-5">
          <div>
            <Label className="text-[11px]">Entrada (R$)</Label>
            <Input
              className={inputClass}
              inputMode="decimal"
              placeholder="0,00"
              value={downReais}
              onChange={(e) => setDownReais(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-[11px]">Parcelas</Label>
            <Input
              className={inputClass}
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-[11px]">1º vencimento</Label>
            <Input
              className={inputClass}
              type="date"
              value={firstDue}
              onChange={(e) => setFirstDue(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-[11px]">A cada (dias)</Label>
            <Input
              className={inputClass}
              inputMode="numeric"
              placeholder="mensal"
              value={everyDays}
              onChange={(e) => setEveryDays(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={generate}
              disabled={isPending}
            >
              <Wand2 className="mr-1 size-3.5" />
              Gerar
            </Button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="py-2 text-center text-sm text-muted-foreground">
          Nenhuma cobrança lançada. Informe a entrada e as parcelas e clique em
          “Gerar” — depois dá para ajustar data e valor de cada uma.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {entries.map((e, i) => (
            <li
              key={i}
              className="flex flex-wrap items-end gap-2 rounded-md border p-2"
            >
              <span className="w-6 text-center text-xs text-muted-foreground">
                {i + 1}
              </span>
              <div className="w-28">
                <Label className="text-[11px]">Tipo</Label>
                <select
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  value={e.kind}
                  disabled={readOnly}
                  onChange={(ev) =>
                    update(i, {
                      kind: ev.target.value === "entrada" ? "entrada" : "parcela",
                    })
                  }
                >
                  <option value="entrada">Entrada</option>
                  <option value="parcela">Parcela</option>
                </select>
              </div>
              <div className="w-40">
                <Label className="text-[11px]">Vencimento</Label>
                <Input
                  className={inputClass}
                  type="date"
                  value={e.dueDate}
                  disabled={readOnly}
                  onChange={(ev) => update(i, { dueDate: ev.target.value })}
                />
              </div>
              <div className="w-32">
                <Label className="text-[11px]">Valor (R$)</Label>
                <Input
                  className={inputClass}
                  inputMode="decimal"
                  value={toReais(e.amountCents)}
                  disabled={readOnly}
                  onChange={(ev) =>
                    update(i, {
                      amountCents: parseBRLToCents(ev.target.value) ?? 0,
                    })
                  }
                />
              </div>
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setEntries((prev) => prev.filter((_, idx) => idx !== i))
                  }
                  aria-label="Remover cobrança"
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
        <div className="text-sm">
          <span className="text-muted-foreground">Somado: </span>
          <strong className="tabular-nums">{formatBRL(total)}</strong>
          {missing !== 0 && (
            <Badge
              variant="outline"
              className="ml-2 border-amber-300 bg-amber-50 text-amber-800"
            >
              {missing > 0
                ? `faltam ${formatBRL(missing)}`
                : `passou ${formatBRL(-missing)}`}
            </Badge>
          )}
        </div>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              <Plus className="mr-1 size-3.5" />
              Cobrança
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isPending || errors.length > 0 || entries.length === 0}
              onClick={save}
            >
              {isPending ? "Salvando…" : "Salvar plano de pagamento"}
            </Button>
          </div>
        )}
      </div>

      {errors.length > 0 && (
        <ul className="space-y-0.5 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          {errors.map((e) => (
            <li key={e}>• {e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
