"use client";

import {
  Children,
  isValidElement,
  useState,
  type ReactNode,
  type ReactElement,
} from "react";
import { cn } from "@/lib/utils";

type PanelProps = { id: string; label: string; children: ReactNode };

/** Marcador de aba — não renderiza sozinho; o ProntuarioTabs lê id/label/filhos.
 * Uso: <ProntuarioTabs><TabPanel id="x" label="X">…</TabPanel>…</ProntuarioTabs> */
export const TabPanel: (props: PanelProps) => ReactNode = () => null;

/** H4.10: a ficha do cliente em abas (na sequência do fluxo). Mantém todas as
 * abas montadas (esconde as inativas) para não perder o estado dos editores. */
export function ProntuarioTabs({ children }: { children: ReactNode }) {
  const panels = Children.toArray(children).filter(
    (c): c is ReactElement<PanelProps> =>
      isValidElement(c) &&
      typeof (c.props as Partial<PanelProps>).id === "string"
  );
  const [active, setActive] = useState<string>(panels[0]?.props.id ?? "");

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-4 mb-4 overflow-x-auto border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div role="tablist" className="flex gap-1 py-1.5">
          {panels.map((p) => (
            <button
              key={p.props.id}
              type="button"
              role="tab"
              aria-selected={active === p.props.id}
              onClick={() => setActive(p.props.id)}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active === p.props.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {p.props.label}
            </button>
          ))}
        </div>
      </div>
      {panels.map((p) => (
        <div
          key={p.props.id}
          role="tabpanel"
          hidden={active !== p.props.id}
          className="space-y-4"
        >
          {p.props.children}
        </div>
      ))}
    </div>
  );
}
