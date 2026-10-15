"use client";

import { Menu } from "lucide-react";
import { ABRIR_MENU_LATERAL } from "@/components/app-sidebar";

/**
 * O BOTÃO ☰ — só no celular (AP23/AP46). Abre a gaveta do menu lateral, que
 * abaixo de 768 px fica escondida para a tela ter a largura inteira. A barra
 * de cima e a lateral são vizinhas no layout; o recado vai por um evento da
 * janela, que a lateral escuta.
 */
export function BotaoMenuLateral() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(ABRIR_MENU_LATERAL))}
      title="Abrir o menu"
      className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground md:hidden"
    >
      <Menu className="size-[18px]" />
      <span className="sr-only">Abrir o menu</span>
    </button>
  );
}
