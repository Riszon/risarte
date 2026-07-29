"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  redistributeFrom,
  resequenceDatesFrom,
  scheduleErrors,
  scheduleTotalCents,
  type ScheduleEntry,
} from "@/lib/payments";
import { savePaymentSchedule } from "@/app/(app)/comercial/payment-schedule-actions";

function toReais(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * I9b: as COBRANÇAS da venda. O "como vai pagar" (à vista / parcelado /
 * entrada + parcelas) é decidido acima, no bloco de condições — aqui só se
 * define quando e quanto de cada cobrança.
 *
 * Por padrão o plano é gerado pronto e mostrado em modo leitura; quem quiser
 * mudar data ou valor clica em "Personalizar". Editar uma cobrança RECALCULA
 * as seguintes, para o plano sempre fechar com o valor da venda.
 */
export function PaymentScheduleEditor({
  negotiationId,
  directSaleId,
  totalCents,
  minInstallmentCents,
  initial,
  /** Entrada e nº de parcelas vindos das condições salvas. */
  downPaymentCents = 0,
  installments = 1,
  readOnly,
}: {
  negotiationId?: string;
  directSaleId?: string;
  totalCents: number;
  minInstallmentCents?: number | null;
  initial?: ScheduleEntry[];
  downPaymentCents?: number;
  installments?: number;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [firstDue, setFirstDue] = useState(today());
  const [entries, setEntries] = useState<ScheduleEntry[]>(
    initial && initial.length > 0
      ? initial
      : buildSchedule({
          totalCents,
          downPaymentCents,
          installments,
          firstDueDate: today(),
        })
  );
  const [editing, setEditing] = useState(false);
  // J2: mudou a data de uma cobrança que tem outras depois — perguntar se as
  // seguintes acompanham a nova sequência ou se a mudança é só nesta.
  const [dateChange, setDateChange] = useState<{
    index: number;
    date: string;
  } | null>(null);

  const total = scheduleTotalCents(entries);
  const missing = totalCents - total;
  const errors = useMemo(
    () => scheduleErrors(entries, { totalCents, minInstallmentCents }),
    [entries, totalCents, minInstallmentCents]
  );

  /** Refaz o plano a partir da 1ª data (mantém entrada e nº de parcelas). */
  function regenerate(from: string) {
    setFirstDue(from);
    setEntries(
      buildSchedule({
        totalCents,
        downPaymentCents,
        installments,
        firstDueDate: from,
      })
    );
  }

  function changeAmount(i: number, raw: string) {
    const cents = parseBRLToCents(raw) ?? 0;
    // O pedido do dono: mudou uma, as seguintes se ajustam sozinhas.
    setEntries((prev) => redistributeFrom(prev, i, cents, totalCents));
  }

  /** J2: mudança de data — última cobrança aplica direto; com cobranças depois,
   *  abre a pergunta ("só esta" × "as seguintes acompanham"). */
  function changeDate(i: number, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    if (i >= entries.length - 1) {
      setEntries((prev) =>
        prev.map((x, idx) => (idx === i ? { ...x, dueDate: date } : x))
      );
      return;
    }
    setDateChange({ index: i, date });
  }

  function applyDateChange(cascade: boolean) {
    if (!dateChange) return;
    const { index, date } = dateChange;
    setEntries((prev) =>
      cascade
        ? resequenceDatesFrom(prev, index, date)
        : prev.map((x, idx) => (idx === index ? { ...x, dueDate: date } : x))
    );
    setDateChange(null);
  }

  function save() {
    startTransition(async () => {
      const r = await savePaymentSchedule({
        negotiationId,
        directSaleId,
        entries: entries.map((e, i) => ({ ...e, seq: i + 1 })),
      });
      if (r.ok) {
        toast.success("Cobranças salvas.");
        setEditing(false);
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível salvar.");
      }
    });
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <CalendarClock className="size-4 text-primary" />
          Cobranças
        </p>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <Label className="text-[11px] text-muted-foreground">
              1º vencimento
            </Label>
            <Input
              type="date"
              className="h-8 w-[9.5rem]"
              value={firstDue}
              onChange={(e) => regenerate(e.target.value)}
            />
            <Button
              type="button"
              variant={editing ? "default" : "outline"}
              size="sm"
              onClick={() => setEditing((v) => !v)}
            >
              <Pencil className="mr-1 size-3.5" />
              {editing ? "Concluir edição" : "Personalizar"}
            </Button>
          </div>
        )}
      </div>

      {/* Modo leitura: uma linha por cobrança, curta e clara. */}
      {!editing ? (
        <ul className="divide-y rounded-md border">
          {entries.map((e, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-sm"
            >
              <span className="flex items-center gap-2">
                <span className="w-5 text-center text-xs text-muted-foreground">
                  {i + 1}
                </span>
                {e.kind === "entrada" ? (
                  <Badge variant="secondary" className="text-[10px]">
                    Entrada
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">Parcela</span>
                )}
                <span className="text-muted-foreground">
                  {fmtDate(e.dueDate)}
                </span>
              </span>
              <span className="font-medium tabular-nums">
                {formatBRL(e.amountCents)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-1.5">
          {entries.map((e, i) => (
            <li
              key={i}
              className="flex flex-wrap items-end gap-2 rounded-md border p-2"
            >
              <span className="w-5 pb-2 text-center text-xs text-muted-foreground">
                {i + 1}
              </span>
              <div className="w-36">
                <Label className="text-[11px]">Vencimento</Label>
                <Input
                  className="h-9"
                  type="date"
                  value={e.dueDate}
                  onChange={(ev) => changeDate(i, ev.target.value)}
                />
              </div>
              <div className="w-32">
                <Label className="text-[11px]">
                  {e.kind === "entrada" ? "Entrada (R$)" : "Valor (R$)"}
                </Label>
                <Input
                  className="h-9"
                  inputMode="decimal"
                  defaultValue={toReais(e.amountCents)}
                  onBlur={(ev) => changeAmount(i, ev.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Remover cobrança"
                onClick={() =>
                  setEntries((prev) =>
                    prev
                      .filter((_, idx) => idx !== i)
                      .map((x, idx) => ({ ...x, seq: idx + 1 }))
                  )
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
          <li>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setEntries((prev) => [
                  ...prev,
                  {
                    seq: prev.length + 1,
                    kind: "parcela",
                    dueDate: prev.at(-1)?.dueDate ?? firstDue,
                    amountCents: Math.max(0, missing),
                  },
                ])
              }
            >
              <Plus className="mr-1 size-3.5" />
              Cobrança
            </Button>
          </li>
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm">
        <span>
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
        </span>
        {/* I9b: um lugar só para salvar no fluxo normal — este botão aparece
            apenas quando o usuário está personalizando as cobranças. */}
        {!readOnly && editing && (
          <Button
            type="button"
            size="sm"
            disabled={isPending || errors.length > 0}
            onClick={save}
          >
            {isPending ? "Salvando…" : "Salvar alterações"}
          </Button>
        )}
      </div>

      {errors.length > 0 && (
        <ul className="space-y-0.5 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          {errors.map((e) => (
            <li key={e}>• {e}</li>
          ))}
        </ul>
      )}

      {/* J2: a pergunta do dono — mudou a data, e as próximas? */}
      <Dialog
        open={dateChange !== null}
        onOpenChange={(open) => {
          if (!open) setDateChange(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mudar o vencimento</DialogTitle>
          </DialogHeader>
          {dateChange && (
            <p className="text-sm text-muted-foreground">
              A cobrança {dateChange.index + 1} passa para{" "}
              <strong>{fmtDate(dateChange.date)}</strong>. E as seguintes?
            </p>
          )}
          <DialogFooter className="gap-2 sm:flex-col sm:items-stretch">
            <Button type="button" onClick={() => applyDateChange(true)}>
              As seguintes acompanham (mesmo dia dos meses seguintes)
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => applyDateChange(false)}
            >
              Só esta cobrança
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
