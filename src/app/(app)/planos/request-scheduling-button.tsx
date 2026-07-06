"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarClock, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestCommercialScheduling } from "./actions";

/**
 * AJ4: botão "Pedir agendamento" nas linhas em fase comercial sem apresentação.
 * Ao clicar, avisa a recepção (pop-up) para marcar a apresentação comercial.
 */
export function RequestSchedulingButton({ clientId }: { clientId: string }) {
  const [isPending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);

  function send() {
    startTransition(async () => {
      const result = await requestCommercialScheduling(clientId);
      if (result.ok) {
        setSent(true);
        toast.success("Pedido enviado à recepção.");
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 gap-1 px-2 text-xs"
      disabled={isPending || sent}
      onClick={send}
    >
      {sent ? (
        <>
          <Check className="size-3.5" />
          Pedido enviado
        </>
      ) : (
        <>
          <CalendarClock className="size-3.5" />
          Pedir agendamento
        </>
      )}
    </Button>
  );
}
