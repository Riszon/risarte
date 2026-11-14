"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { atualizarSaldo } from "./actions";

/** Lê agora o saldo da conta Asaas da franqueadora (só para quem vê a rede). */
export function AtualizarSaldo() {
  const [pendente, iniciar] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pendente}
      onClick={() =>
        iniciar(async () => {
          const r = await atualizarSaldo();
          if (r.ok) toast.success("Saldo atualizado com o Asaas.");
          else toast.error(r.error ?? "Não foi possível atualizar o saldo.");
        })
      }
    >
      <RefreshCw className={pendente ? "size-4 animate-spin" : "size-4"} />
      {pendente ? "Atualizando…" : "Atualizar saldo"}
    </Button>
  );
}
