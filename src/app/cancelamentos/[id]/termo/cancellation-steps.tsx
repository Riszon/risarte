"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  applyPlanCancellation,
  discardPlanCancellation,
  signPlanCancellation,
} from "@/app/(app)/apresentacao/[clientId]/cancellation-actions";

/**
 * 0206 — os passos do cancelamento, fora do documento impresso.
 *
 * A ordem importa: **nada do tratamento é desfeito antes da assinatura**.
 * Enquanto o termo estiver em rascunho, descartar não deixa rastro no
 * tratamento — é o que permite conversar com o paciente sem medo.
 */
export function CancellationSteps({
  id,
  clientId,
  status,
  signedAt,
  appliedAt,
}: {
  id: string;
  clientId: string;
  status: string;
  signedAt: string | null;
  appliedAt: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  if (status === "efetivado") {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
        <p className="font-semibold">Cancelamento efetivado.</p>
        <p className="text-xs">
          As sessões não realizadas e as cobranças em aberto foram canceladas
          {appliedAt ? ` em ${appliedAt.slice(8, 10)}/${appliedAt.slice(5, 7)}/${appliedAt.slice(0, 4)}` : ""}
          . O que já havia sido executado continua no prontuário.
        </p>
      </div>
    );
  }

  if (status === "descartado") {
    return (
      <div className="rounded-lg border bg-muted/50 p-3 text-sm">
        <p className="font-semibold">Termo descartado.</p>
        <p className="text-xs text-muted-foreground">
          O tratamento seguiu normalmente — nada foi cancelado.
        </p>
      </div>
    );
  }

  const signed = status === "assinado";

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div>
        <p className="text-sm font-semibold">Passos do cancelamento</p>
        <p className="text-xs text-muted-foreground">
          Enquanto o termo não for assinado e efetivado,{" "}
          <strong>nada do tratamento é desfeito</strong>.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={signed ? "outline" : "default"}
          disabled={isPending}
          onClick={() =>
            run(
              () => signPlanCancellation({ id, clientId, signed: !signed }),
              signed ? "Assinatura desmarcada." : "Termo marcado como assinado."
            )
          }
        >
          {signed
            ? `Assinado${signedAt ? ` em ${signedAt.slice(8, 10)}/${signedAt.slice(5, 7)}` : ""} — desmarcar`
            : "Marcar termo como assinado"}
        </Button>

        <Button
          size="sm"
          variant="destructive"
          disabled={isPending || !signed}
          title={
            signed
              ? "Cancela as sessões pendentes e as cobranças em aberto"
              : "O cliente precisa assinar o termo antes"
          }
          onClick={() =>
            run(
              () => applyPlanCancellation({ id, clientId }),
              "Cancelamento efetivado."
            )
          }
        >
          Efetivar cancelamento
        </Button>

        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() =>
            run(
              () => discardPlanCancellation({ id, clientId }),
              "Termo descartado — o tratamento segue normalmente."
            )
          }
        >
          Descartar
        </Button>
      </div>
    </div>
  );
}
