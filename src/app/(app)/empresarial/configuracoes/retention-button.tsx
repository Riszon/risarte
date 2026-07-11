"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runRetention } from "./actions";

export function RetentionButton() {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const r = await runRetention();
          if (r.ok) {
            toast.success(
              `Retenção concluída: ${r.count ?? 0} cadastro(s) anonimizado(s).`
            );
          } else toast.error(r.error ?? "Erro.");
        })
      }
    >
      {isPending ? "Rodando..." : "Rodar retenção agora (LGPD)"}
    </Button>
  );
}
