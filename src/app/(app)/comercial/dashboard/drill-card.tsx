"use client";

import Link from "next/link";
import {
  Ban,
  CheckCircle2,
  ChevronRight,
  Hourglass,
  PhoneCall,
  ThumbsDown,
  Wallet,
} from "lucide-react";
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

/** Uma linha da lista que abre ao clicar no cartão. */
export type DrillItem = {
  clientId: string;
  clientName: string;
  code: string | null;
  clinicName: string | null;
  /** Selo curto (situação da negociação, follow-up na clínica...). */
  badge?: string | null;
  badgeTone?: "primary" | "amber" | "emerald" | "rose" | "muted";
  /** Valor à direita (omitir quando a lista não é de dinheiro). */
  valueCents?: number | null;
  /** Linha extra (motivo da perda, data, quem marcou, tentativas...). */
  note?: string | null;
};

export type DrillIcon =
  | "hourglass"
  | "wallet"
  | "check"
  | "phone"
  | "lost"
  | "cancelled";

const ICONS: Record<DrillIcon, React.ComponentType<{ className?: string }>> = {
  hourglass: Hourglass,
  wallet: Wallet,
  check: CheckCircle2,
  phone: PhoneCall,
  lost: ThumbsDown,
  cancelled: Ban,
};

type Tone = "gold" | "emerald" | "sky" | "violet" | "amber" | "rose" | "muted";

const TONE_ACCENT: Record<Tone, string> = {
  gold: "bg-gold",
  emerald: "bg-emerald-500",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  muted: "bg-muted-foreground/40",
};
const TONE_ICON: Record<Tone, string> = {
  gold: "bg-gold/15 text-gold-foreground",
  emerald: "bg-emerald-500/10 text-emerald-700",
  sky: "bg-sky-500/10 text-sky-700",
  violet: "bg-violet-500/10 text-violet-700",
  amber: "bg-amber-500/15 text-amber-700",
  rose: "bg-rose-500/10 text-rose-700",
  muted: "bg-muted text-muted-foreground",
};
const BADGE_TONE: Record<
  NonNullable<DrillItem["badgeTone"]>,
  string
> = {
  primary: "border-primary/30 bg-primary/10 text-primary",
  amber: "border-amber-300 bg-amber-50 text-amber-800",
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-800",
  rose: "border-rose-300 bg-rose-50 text-rose-800",
  muted: "border-border bg-muted text-muted-foreground",
};

/**
 * Cartão de indicador que ABRE a lista por trás do número (clientes + valores),
 * já respeitando os filtros de unidade/período do dashboard. Sem itens, o
 * cartão fica apagado e não clicável.
 */
export function DrillCard({
  tone,
  icon,
  label,
  value,
  hint,
  items,
  dialogTitle,
  scopeLabel,
  emptyValueLabel,
  showTotal = true,
}: {
  tone: Tone;
  icon: DrillIcon;
  label: string;
  value: string;
  hint: string;
  items: DrillItem[];
  dialogTitle: string;
  /** Ex.: "Cambé · Este mês" — mostrado no subtítulo do pop-up. */
  scopeLabel: string;
  /** Texto do rodapé quando a lista não é de dinheiro. */
  emptyValueLabel?: string;
  showTotal?: boolean;
}) {
  const active = items.length > 0;
  const Icon = ICONS[icon];
  const total = items.reduce((s, i) => s + (i.valueCents ?? 0), 0);
  const effectiveTone: Tone = active ? tone : "muted";

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
        className={cn("absolute inset-x-0 top-0 h-1", TONE_ACCENT[effectiveTone])}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-lg",
            TONE_ICON[effectiveTone]
          )}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
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
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            {scopeLabel} — {items.length} cliente(s).
          </DialogDescription>
        </DialogHeader>

        <ul className="-mx-1 flex-1 space-y-1.5 overflow-y-auto px-1">
          {items.map((i, idx) => (
            <li key={`${i.clientId}-${idx}`}>
              <Link
                href={`/comercial/${i.clientId}`}
                className="flex items-start justify-between gap-2 rounded-lg border p-2.5 transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {i.clientName}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    {i.code && <span className="font-mono">{i.code}</span>}
                    {i.clinicName && <span>{i.clinicName}</span>}
                    {i.badge && (
                      <span
                        className={cn(
                          "rounded-full border px-1.5 py-0.5 font-medium",
                          BADGE_TONE[i.badgeTone ?? "muted"]
                        )}
                      >
                        {i.badge}
                      </span>
                    )}
                  </span>
                  {i.note && (
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {i.note}
                    </span>
                  )}
                </span>
                {i.valueCents != null && (
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatBRL(i.valueCents)}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>

        {showTotal && (
          <div className="flex items-center justify-between gap-2 border-t pt-3 text-sm">
            <span className="text-muted-foreground">
              {emptyValueLabel ?? "Total"}
            </span>
            <span className="text-base font-semibold tabular-nums">
              {emptyValueLabel ? items.length : formatBRL(total)}
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
