"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** De quanto em quanto tempo a visão "Online agora" pede a página de novo. */
const A_CADA_MS = 60_000;

/**
 * Pede a página de novo a cada minuto, e mostra quando foi a última leitura.
 *
 * "Quem está online" envelhece em minutos: uma lista parada na tela, sem dizer
 * de quando é, seria lida como o agora. Por isso a hora da leitura fica à
 * vista, e a página se renova sozinha enquanto a aba estiver sendo olhada.
 */
export function AtualizarSozinho({ lidoAs }: { lidoAs: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const relogio = setInterval(() => {
      // Aba escondida não pede nada: ninguém está olhando.
      if (document.visibilityState === "visible") router.refresh();
    }, A_CADA_MS);
    return () => clearInterval(relogio);
  }, [router]);

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>Lido às {lidoAs} · atualiza sozinho a cada minuto</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        disabled={isPending}
        onClick={() => startTransition(() => router.refresh())}
      >
        <RefreshCw className="mr-1 size-3.5" />
        Atualizar agora
      </Button>
    </div>
  );
}
