"use client";

/**
 * 4018 (19.32.10): o caso em recorrência continua como está até a ASA4B (cobrado
 * por fora). A unidade pode passá-lo para boleto, Pix ou cartão pelo link, um a
 * um, com a concordância do cliente registrada.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { switchOrthoMethod } from "../../actions";

const NOME = { boleto: "boleto", pix: "Pix", cartao: "cartão pelo link" } as const;

export function MeioDoCaso({ caseId, method }: { caseId: string; method: string | null }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  if (!method || !method.endsWith("_recorrente")) return null;
  function passar(m: keyof typeof NOME) {
    if (!window.confirm(`O cliente concordou em pagar por ${NOME[m]}, um por mês, pelo Asaas? A concordância fica registrada.`)) return;
    start(async () => {
      const r = await switchOrthoMethod(caseId, m, true);
      if (!r.ok) return void toast.error(r.error ?? "Não foi possível.");
      toast.success("Meio alterado. As próximas mensalidades vão pelo Asaas (se a unidade ligou as mensalidades).");
      router.refresh();
    });
  }
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
      <span className="text-muted-foreground">Recorrência (cobrada por fora até a ASA4B):</span>
      {(Object.keys(NOME) as (keyof typeof NOME)[]).map((m) => (
        <Button key={m} size="sm" variant="outline" className="h-6 text-[10px]" disabled={isPending} onClick={() => passar(m)}>
          Passar para {NOME[m]}
        </Button>
      ))}
    </span>
  );
}
