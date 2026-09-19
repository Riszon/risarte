"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * SAIR, para a barra de cima do MODO PORTAL (0259).
 *
 * Quem ainda não tem o sistema real liberado vê só o Início, sem o menu lateral
 * — e era no menu lateral que morava o "Sair". A pessoa entrava e não tinha
 * como sair (relato do dono, 19/09/2026). O mesmo caminho da lateral: encerra
 * a sessão e volta para o login.
 */
export function BotaoSair() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await createClient().auth.signOut();
        router.push("/login");
        router.refresh();
      }}
      className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-accent hover:text-accent-foreground"
    >
      <LogOut className="size-4" />
      Sair
    </button>
  );
}
