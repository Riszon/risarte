"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Bloco de conteúdo que recolhe/expande ao clicar no cabeçalho — usado para
 * encurtar telas longas (ex.: cockpit do Planner). Mantém a aparência de Card:
 * o cabeçalho vira um botão com ícone + título (+ resumo opcional à direita) e
 * uma seta que gira. O corpo (children) some quando recolhido.
 */
export function CollapsibleBlock({
  title,
  icon,
  aside,
  defaultOpen = true,
  className,
  contentClassName,
  children,
}: {
  title: React.ReactNode;
  /** Ícone à esquerda do título. */
  icon?: React.ReactNode;
  /** Resumo à direita (ex.: contagem) — visível mesmo recolhido. */
  aside?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className={className}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-(--card-spacing) text-left transition-colors hover:text-foreground/80"
      >
        {icon}
        <span className="font-heading text-base leading-snug font-medium">
          {title}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {aside}
          <ChevronDown
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
            aria-hidden
          />
        </span>
      </button>
      {open && (
        <CardContent className={contentClassName}>{children}</CardContent>
      )}
    </Card>
  );
}
