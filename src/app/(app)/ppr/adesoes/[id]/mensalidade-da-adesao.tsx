"use client";

/**
 * 4018 (19.32.10) — na adesão do PPR+: a decisão dos 90 dias de atraso ("Manter
 * suspensa"; cancelar é o botão de sempre) e a passagem de recorrência para
 * boleto ou Pix, uma a uma, com a concordância do cliente registrada.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { keepPprSuspended, switchPprMethod } from "../../actions";

export function MensalidadeDaAdesao({
  membershipId,
  status,
  paymentMethod,
  overdueAlertAt,
  overdueKeptAt,
  canManage,
  canEdit,
}: {
  membershipId: string;
  status: string;
  paymentMethod: string | null;
  overdueAlertAt: string | null;
  overdueKeptAt: string | null;
  canManage: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const recorrente = !!paymentMethod && paymentMethod.endsWith("_recorrente");
  const decidir = canManage && status === "suspenso" && !!overdueAlertAt && !overdueKeptAt;
  if (!decidir && !(canEdit && recorrente && status !== "cancelado")) return null;

  function manter() {
    start(async () => {
      const r = await keepPprSuspended(membershipId);
      if (!r.ok) return void toast.error(r.error ?? "Não foi possível.");
      toast.success("Decisão registrada: a adesão continua suspensa, e o aviso para.");
      router.refresh();
    });
  }
  function passar(metodo: "boleto" | "pix") {
    if (!window.confirm(`O cliente concordou em pagar por ${metodo === "boleto" ? "boleto" : "Pix"}, um por mês, pelo Asaas? A concordância fica registrada.`)) return;
    start(async () => {
      const r = await switchPprMethod(membershipId, metodo, true);
      if (!r.ok) return void toast.error(r.error ?? "Não foi possível.");
      toast.success("Meio alterado. As próximas mensalidades vão pelo Asaas (se a unidade ligou as mensalidades).");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200">
      {decidir && (
        <div className="space-y-1">
          <p>
            <strong>Adesão com 90 dias de atraso.</strong> O sistema não cancela sozinho: cancele a adesão (botão
            &quot;Cancelar&quot;) ou mantenha suspensa. O aviso se repete a cada 7 dias até a decisão.
          </p>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={isPending} onClick={manter}>
            Manter suspensa
          </Button>
        </div>
      )}
      {canEdit && recorrente && status !== "cancelado" && (
        <div className="space-y-1">
          <p>Esta adesão paga por recorrência, que continua cobrada por fora até a ASA4B.</p>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={isPending} onClick={() => passar("boleto")}>
              Passar para boleto
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={isPending} onClick={() => passar("pix")}>
              Passar para Pix
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
