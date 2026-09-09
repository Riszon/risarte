"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Um ícone da barra de cima.
 *
 * Existe para os cinco itens terem UMA aparência só. Quando cada um desenhava o
 * próprio botão, bastava alguém mexer em um para a fileira ficar desalinhada —
 * e desalinho numa barra que aparece em toda tela é o tipo de coisa que ninguém
 * reporta e todo mundo vê.
 *
 * O rótulo existe no `title` e no texto para leitor de tela: a barra mostra só o
 * desenho, mas quem navega por teclado ou por leitura precisa saber o que é.
 */
export function TopbarItem({
  href,
  label,
  icon: Icon,
  badge,
  destaque,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Número no canto. `0` ou ausente não desenha nada. */
  badge?: number;
  /** Para o que pede atenção (alertas), sem gritar. */
  destaque?: boolean;
}) {
  return (
    <Link
      href={href}
      title={label}
      className={cn(
        "relative grid size-9 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground",
        destaque && "text-amber-600 hover:text-amber-700"
      )}
    >
      <Icon className="size-[18px]" />
      <span className="sr-only">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-medium tabular-nums text-gold-foreground">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}
