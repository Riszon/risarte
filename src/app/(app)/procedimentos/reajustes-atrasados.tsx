"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { aplicarReajustesAtrasados } from "./actions";

/**
 * 0309 — o reajuste agendado devia ter entrado na madrugada e não entrou
 * (a rotina falhou). A tela avisa em vez de esconder, e o Admin aplica.
 */
export function ReajustesAtrasados({ quantos, podeAplicar }: { quantos: number; podeAplicar: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  if (quantos === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      <span className="inline-flex items-center gap-2">
        <AlertTriangle className="size-4" />
        {quantos === 1 ? "1 reajuste de preço está atrasado" : `${quantos} reajustes de preço estão atrasados`}: a data
        já chegou e o sistema ainda não trocou o preço. Até trocar, vale o preço anterior.
      </span>
      {podeAplicar && (
        <Button
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const r = await aplicarReajustesAtrasados();
              if (r.ok) {
                toast.success(`${r.aplicados ?? 0} reajuste(s) aplicado(s).`);
                router.refresh();
              } else toast.error(r.error ?? "Algo deu errado.");
            })
          }
        >
          Aplicar agora
        </Button>
      )}
    </div>
  );
}
