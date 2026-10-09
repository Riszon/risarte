"use client";

import { LogOut } from "lucide-react";

/**
 * SAIR, para a barra de cima do MODO PORTAL (0259).
 *
 * Quem ainda não tem o sistema real liberado vê só o Início, sem o menu lateral
 * — e era no menu lateral que morava o "Sair". A pessoa entrava e não tinha
 * como sair (relato do dono, 19/09/2026).
 *
 * 0287: sai pela rota que encerra o acesso e REGISTRA a saída. Antes o botão
 * apagava a sessão no navegador e a trilha nunca soube que a pessoa saiu.
 * `window.location`, e não `<Link>`: o Next pré-carregaria a rota de saída.
 */
export function BotaoSair() {
  return (
    <button
      type="button"
      onClick={() => window.location.assign("/auth/encerrar?motivo=saiu")}
      className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-accent hover:text-accent-foreground"
    >
      <LogOut className="size-4" />
      Sair
    </button>
  );
}
