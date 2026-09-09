"use client";

import Link from "next/link";
import type { ReactNode } from "react";
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
  icon,
  badge,
  destaque,
}: {
  href: string;
  label: string;
  /**
   * ⚠️ O ÍCONE JÁ DESENHADO (`<Bell className="size-[18px]" />`), nunca o
   * componente (`Bell`).
   *
   * A barra de cima roda no SERVIDOR e este componente roda no NAVEGADOR.
   * Componente é função, e função não atravessa essa fronteira: passar `Bell`
   * derruba a página inteira com "A server error occurred", e **o build não
   * pega** — as telas do sistema são desenhadas sob demanda, então o erro só
   * aparece ao abrir. Foi assim que o treino caiu em 08/09/2026.
   *
   * Elemento pronto atravessa; por isso o tipo é `ReactNode`.
   */
  icon: ReactNode;
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
      {icon}
      <span className="sr-only">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-medium tabular-nums text-gold-foreground">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}
