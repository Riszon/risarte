"use client";

import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Uma linha da lista que abre ao clicar no cartão do painel. */
export type PprDrillItem = {
  key: string;
  /** Para onde a linha leva (prontuário, adesão...). Sem href = só leitura. */
  href?: string | null;
  title: string;
  subtitle?: string | null;
  note?: string | null;
  badge?: string | null;
  badgeTone?: "primary" | "amber" | "emerald" | "rose" | "muted";
  /** Já formatado (dinheiro, data, contagem) — o painel decide o formato. */
  value?: string | null;
};

const BADGE_TONE: Record<NonNullable<PprDrillItem["badgeTone"]>, string> = {
  primary: "border-primary/30 bg-primary/10 text-primary",
  amber: "border-amber-300 bg-amber-50 text-amber-800",
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-800",
  rose: "border-rose-300 bg-rose-50 text-rose-800",
  muted: "border-border bg-muted text-muted-foreground",
};

/**
 * Envolve qualquer cartão/linha do painel e ABRE a lista por trás do número,
 * já respeitando o filtro de unidade. Sem itens, nada fica clicável.
 */
export function PprDrill({
  items,
  dialogTitle,
  scopeLabel,
  dialogHint,
  footerLabel,
  footerValue,
  className,
  children,
}: {
  items: PprDrillItem[];
  dialogTitle: string;
  /** Ex.: "Cambé · hoje" — subtítulo do pop-up. */
  scopeLabel: string;
  /** Explicação curta da regra do indicador. */
  dialogHint?: string;
  footerLabel?: string;
  footerValue?: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (items.length === 0) {
    return <div className={className}>{children}</div>;
  }

  const trigger = (
    <button
      type="button"
      className={cn(
        "w-full cursor-pointer rounded-xl text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        className
      )}
    >
      {children}
    </button>
  );

  return (
    <Dialog>
      <DialogTrigger render={trigger} />
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            {scopeLabel} — {items.length} registro(s).
            {dialogHint && (
              <span className="mt-0.5 block text-xs">{dialogHint}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <ul className="-mx-1 flex-1 space-y-1.5 overflow-y-auto px-1">
          {items.map((i) => {
            const body = (
              <>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {i.title}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    {i.subtitle && <span>{i.subtitle}</span>}
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
                {i.value && (
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {i.value}
                  </span>
                )}
              </>
            );
            const cls =
              "flex items-start justify-between gap-2 rounded-lg border p-2.5";
            return (
              <li key={i.key}>
                {i.href ? (
                  <Link
                    href={i.href}
                    className={cn(
                      cls,
                      "transition-colors hover:border-primary/40 hover:bg-muted/40"
                    )}
                  >
                    {body}
                  </Link>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>

        {footerLabel && (
          <div className="flex items-center justify-between gap-2 border-t pt-3 text-sm">
            <span className="text-muted-foreground">{footerLabel}</span>
            <span className="text-base font-semibold tabular-nums">
              {footerValue}
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
