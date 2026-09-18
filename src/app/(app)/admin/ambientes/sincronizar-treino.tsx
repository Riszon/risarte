"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sincronizarTreinoAgora, type ResultadoDaSincronizacao } from "./actions";

/**
 * O botão "Sincronizar treino agora" (0260). A cópia do dia a dia é sozinha;
 * este botão é a primeira carga e o conserto do que ficou pendente.
 */
export function SincronizarTreino() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [resultado, setResultado] = useState<ResultadoDaSincronizacao | null>(null);

  return (
    <div className="space-y-2">
      <Button
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const r = await sincronizarTreinoAgora();
            setResultado(r);
            if (r.ok) {
              toast.success("Treino sincronizado com o sistema real.");
            } else {
              toast.error(r.error ?? "A sincronização não terminou.");
            }
            router.refresh();
          })
        }
      >
        <RefreshCw className={`mr-1 size-4 ${isPending ? "animate-spin" : ""}`} />
        {isPending ? "Copiando para o treino…" : "Sincronizar treino agora"}
      </Button>

      {resultado?.resumo && (
        <p className="text-xs text-muted-foreground">
          Copiados: {resultado.resumo.pessoas} logins, {resultado.resumo.risartanos}{" "}
          fichas e {resultado.resumo.permissoes} linhas da matriz de permissões.
        </p>
      )}
      {resultado && resultado.avisos && resultado.avisos.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800 dark:text-amber-300">
          {[...new Set(resultado.avisos)].map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
