"use client";

import Link from "next/link";
import { ChevronRight, Hourglass, Wallet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { NEGOTIATION_STATUS_LABELS, type NegotiationStatus } from "@/lib/commercial";

export type AwaitingItem = {
  clientId: string;
  clientName: string;
  code: string | null;
  clinicName: string | null;
  status: string;
  valueCents: number;
};

const STATUS_STYLE: Record<string, string> = {
  em_negociacao: "border-primary/30 bg-primary/10 text-primary",
  aguardando_autorizacao: "border-amber-300 bg-amber-50 text-amber-800",
  aceita: "border-emerald-300 bg-emerald-50 text-emerald-800",
};

/**
 * Cartão "Aguardando fechamento" que abre a lista dos clientes em aberto (com o
 * valor de cada um), já respeitando o filtro de unidade/período do dashboard.
 */
export function AwaitingDialog({
  label,
  value,
  hint,
  icon,
  items,
  periodLabel,
  unitLabel,
}: {
  label: string;
  value: string;
  hint: string;
  icon: "hourglass" | "wallet";
  items: AwaitingItem[];
  periodLabel: string;
  unitLabel: string;
}) {
  const total = items.reduce((s, i) => s + i.valueCents, 0);
  const active = items.length > 0;
  const Icon = icon === "wallet" ? Wallet : Hourglass;

  const card = (
    <button
      type="button"
      disabled={!active}
      className={cn(
        "relative w-full overflow-hidden rounded-xl border bg-card p-4 text-left shadow-sm transition-shadow",
        active
          ? "cursor-pointer hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary/40"
          : "cursor-default"
      )}
    >
      <span
        className={cn(
          "absolute inset-x-0 top-0 h-1",
          active ? "bg-amber-500" : "bg-muted-foreground/40"
        )}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-lg",
            active
              ? "bg-amber-500/15 text-amber-700"
              : "bg-muted text-muted-foreground"
          )}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
        {hint}
        {active && (
          <span className="inline-flex items-center font-medium text-primary">
            · ver lista <ChevronRight className="size-3" />
          </span>
        )}
      </p>
    </button>
  );

  if (!active) return card;

  return (
    <Dialog>
      <DialogTrigger render={card} />
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Aguardando fechamento</DialogTitle>
          <DialogDescription>
            {unitLabel} · {periodLabel} — {items.length} cliente(s) sem contrato
            assinado e/ou pagamento confirmado.
          </DialogDescription>
        </DialogHeader>

        <ul className="-mx-1 flex-1 space-y-1.5 overflow-y-auto px-1">
          {items.map((i) => (
            <li key={i.clientId}>
              <Link
                href={`/comercial/${i.clientId}`}
                className="flex items-center justify-between gap-2 rounded-lg border p-2.5 transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {i.clientName}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    {i.code && <span className="font-mono">{i.code}</span>}
                    {i.clinicName && <span>{i.clinicName}</span>}
                    <span
                      className={cn(
                        "rounded-full border px-1.5 py-0.5 font-medium",
                        STATUS_STYLE[i.status] ?? "border-border bg-muted"
                      )}
                    >
                      {NEGOTIATION_STATUS_LABELS[
                        i.status as NegotiationStatus
                      ] ?? i.status}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatBRL(i.valueCents)}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between gap-2 border-t pt-3 text-sm">
          <span className="text-muted-foreground">Total em aberto</span>
          <span className="text-base font-semibold tabular-nums">
            {formatBRL(total)}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
