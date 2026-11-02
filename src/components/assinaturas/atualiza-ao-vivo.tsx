"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * SITUAÇÃO AO VIVO (plano ZS0 §5.6): quando o retorno da ZapSign muda um
 * pacote ou um signatário, a tela recarrega os dados do servidor sem a pessoa
 * apertar F5. A RLS vale no Realtime: cada um só recebe o que pode ver.
 * Com a aba visível, há ainda a conferência de 60 s — o padrão da auditoria —
 * para o caso de o Realtime não entregar.
 */
export function AtualizaAoVivo({ clientId, intervalMs = 60_000 }: { clientId?: string; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`assinaturas-${clientId ?? "minhas"}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "signature_packages", ...(clientId ? { filter: `client_id=eq.${clientId}` } : {}) },
        () => router.refresh()
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "signature_signers" }, () => router.refresh())
      .subscribe();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => {
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [clientId, intervalMs, router]);
  return null;
}
