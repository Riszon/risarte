"use client";

import { useState } from "react";
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
  redistributeFrom,
  resequenceDatesFrom,
  scheduleErrors,
  scheduleTotalCents,
  type ScheduleEntry,
} from "@/lib/payments";

function toReais(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * J4b: as COBRANÇAS da venda, em COMPONENTE CONTROLADO. Quem manda no plano é a
 * tela de pagamento (venda direta ou cockpit do consultor): ela gera as
 * cobranças ao vivo conforme as condições escolhidas e salva TUDO num único
 * botão. Aqui não há salvamento próprio — era o "dois lugares para salvar" que
 * o dono reclamou.
 *
 * Em modo leitura a lista é compacta (2 colunas). "Personalizar" abre a edição:
 * mudar o VALOR recalcula as seguintes; mudar a DATA pergunta se as próximas
 * acompanham a nova sequência.
 */
export function PaymentScheduleEditor({
  entries,
  onChange,
  totalCents,
  minInstallmentCents,
  readOnly,
}: {
  entries: ScheduleEntry[];
  onChange: (entries: ScheduleEntry[]) => void;
  totalCents: number;
  minInstallmentCents?: number | null;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  // Mudou a data de uma cobrança que tem outras depois — perguntar se as
  // seguintes acompanham a nova sequência ou se a mudança é só nesta.
  const [dateChange, setDateChange] = useState<{
    index: number;
    date: string;
  } | null>(null);

  const total = scheduleTotalCents(entries);
  const missing = Math.round(totalCents) - total;
  const errors = scheduleErrors(entries, { totalCents, minInstallmentCents });

  function changeAmount(i: number, raw: string) {
    const cents = parseBRLToCents(raw) ?? 0;
    // Mudou uma, as seguintes se ajustam sozinhas (pedido do dono).
    onChange(redistributeFrom(entries, i, cents, totalCents));
  }

  function changeDate(i: number, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    if (i >= entries.length - 1) {
      onChange(
        entries.map((x, idx) => (idx === i ? { ...x, dueDate: date } : x))
      );
      return;
    }
    setDateChange({ index: i, date });
  }

  function applyDateChange(cascade: boolean) {
    if (!dateChange) return;
    const { index, date } = dateChange;
    onChange(
      cascade
        ? resequenceDatesFrom(entries, index, date)
        : entries.map((x, idx) => (idx === index ? { ...x, dueDate: date } : x))
    );
    setDateChange(null);
  }

  if (entries.length === 0) return null;

  return (
    <div className="space-y-2 rounded-lg border bg-background p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <CalendarClock className="size-3.5 text-primary" />
          Cobranças ({entries.length})
        </p>
        {!readOnly && (
          <Button
            type="button"
            variant={editing ? "default" : "outline"}
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => setEditing((v) => !v)}
          >
            <Pencil className="mr-1 size-3" />
            {editing ? "Concluir" : "Personalizar"}
          </Button>
        )}
      </div>

      {/* Leitura: compacto, 2 colunas — 10 parcelas não viram uma tela inteira. */}
      {!editing ? (
        <ul className="grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
          {entries.map((e, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-2 border-b border-dashed py-0.5 last:border-0"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="w-4 text-right text-[10px] text-muted-foreground">
                  {i + 1}
                </span>
                {e.kind === "entrada" ? (
                  <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                    entrada
                  </Badge>
                ) : null}
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
        <ul className="space-y-1">
          {entries.map((e, i) => (
            <li key={i} className="flex flex-wrap items-end gap-1.5">
              <span className="w-4 pb-2 text-right text-[10px] text-muted-foreground">
                {i + 1}
              </span>
              <div className="w-[8.5rem]">
                {i === 0 && (
                  <Label className="text-[10px]">Vencimento</Label>
                )}
                <Input
                  className="h-8 text-xs"
                  type="date"
                  value={e.dueDate}
                  onChange={(ev) => changeDate(i, ev.target.value)}
                />
              </div>
              <div className="w-28">
                {i === 0 && (
                  <Label className="text-[10px]">
                    {e.kind === "entrada" ? "Entrada (R$)" : "Valor (R$)"}
                  </Label>
                )}
                <Input
                  className="h-8 text-xs"
                  inputMode="decimal"
                  defaultValue={toReais(e.amountCents)}
                  onBlur={(ev) => changeAmount(i, ev.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                aria-label="Remover cobrança"
                onClick={() =>
                  onChange(
                    entries
                      .filter((_, idx) => idx !== i)
                      .map((x, idx) => ({ ...x, seq: idx + 1 }))
                  )
                }
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
          <li>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() =>
                onChange([
                  ...entries,
                  {
                    seq: entries.length + 1,
                    kind: "parcela",
                    dueDate: entries.at(-1)?.dueDate ?? "",
                    amountCents: Math.max(0, missing),
                  },
                ])
              }
            >
              <Plus className="mr-1 size-3" />
              Cobrança
            </Button>
          </li>
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-1.5 text-xs">
        <span>
          <span className="text-muted-foreground">Somado: </span>
          <strong className="tabular-nums">{formatBRL(total)}</strong>
        </span>
        {missing !== 0 && (
          <Badge
            variant="outline"
            className="border-amber-300 bg-amber-50 text-[10px] text-amber-800"
          >
            {missing > 0
              ? `faltam ${formatBRL(missing)}`
              : `passou ${formatBRL(-missing)}`}
          </Badge>
        )}
      </div>

      {errors.length > 0 && (
        <ul className="space-y-0.5 rounded-md border border-destructive/40 bg-destructive/5 p-1.5 text-[11px] text-destructive">
          {errors.map((e) => (
            <li key={e}>• {e}</li>
          ))}
        </ul>
      )}

      {/* A pergunta do dono — mudou a data, e as próximas? */}
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
