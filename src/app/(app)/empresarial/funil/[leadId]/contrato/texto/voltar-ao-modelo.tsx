"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resetContractText } from "../../actions";

/**
 * Desfaz a personalização do texto do contrato desta empresa.
 *
 * Apaga o texto próprio dela, e ela volta a usar o modelo da rede. É ato de
 * gente, com confirmação — e o texto apagado continua na trilha de alterações
 * da Auditoria.
 */
export function VoltarAoModelo({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function voltar() {
    if (
      !window.confirm(
        "Apagar o texto personalizado desta empresa e voltar a usar o modelo da rede?"
      )
    ) {
      return;
    }
    startTransition(async () => {
      const r = await resetContractText(leadId);
      if (r.ok) {
        toast.success("Esta empresa voltou a usar o modelo da rede.");
        router.push(`/empresarial/funil/${leadId}/contrato`);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={voltar}
    >
      Voltar ao modelo da rede
    </Button>
  );
}
