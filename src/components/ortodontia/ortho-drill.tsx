"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Uma linha da lista que abre ao clicar no cartão do painel. */
export type OrthoDrillItem = {
  key: string;
  href?: string | null;
  title: string;
  subtitle?: string | null;
  badge?: string | null;
  badgeTone?: "primary" | "amber" | "emerald" | "rose" | "sky" | "muted";
  value?: string | null;
};

const BADGE_TONE: Record<NonNullable<OrthoDrillItem["badgeTone"]>, string> = {
  primary: "border-primary/30 bg-primary/10 text-primary",
  amber: "border-amber-300 bg-amber-50 text-amber-800",
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-800",
  rose: "border-rose-300 bg-rose-50 text-rose-800",
  sky: "border-sky-300 bg-sky-50 text-sky-800",
  muted: "border-border bg-muted text-muted-foreground",
};

/**
 * Todo número do painel abre a lista por trás dele (mesmo padrão do PPR+ e do
 * Comercial): um indicador que não abre a lista é um número em que ninguém
 * confia. Sem itens, o cartão não é clicável.
 */
export function OrthoDrill({
  items,
  dialogTitle,
  scopeLabel,
  dialogHint,
  className,
  children,
}: {
  items: OrthoDrillItem[];
  dialogTitle: string;
  scopeLabel: string;
  dialogHint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return <div className={className}>{children}</div>;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "block w-full text-left transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring",
          className
        )}
        title="Ver a lista"
      >
        {children}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>
              {scopeLabel}
              {dialogHint ? ` · ${dialogHint}` : ""}
            </DialogDescription>
          </DialogHeader>
          <ul className="divide-y text-sm">
            {items.map((it) => {
              const row = (
                <div className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{it.title}</p>
                    {it.subtitle && <p className="truncate text-xs text-muted-foreground">{it.subtitle}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {it.badge && (
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", BADGE_TONE[it.badgeTone ?? "muted"])}>
                        {it.badge}
                      </span>
                    )}
                    {it.value && <span className="tabular-nums text-xs">{it.value}</span>}
                  </div>
                </div>
              );
              return (
                <li key={it.key}>
                  {it.href ? (
                    <Link href={it.href} className="block hover:bg-muted/50" onClick={() => setOpen(false)}>
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-muted-foreground">{items.length} registro{items.length === 1 ? "" : "s"}.</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
