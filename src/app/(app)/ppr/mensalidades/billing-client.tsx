"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, RefreshCw, Undo2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  generatePprCharges,
  markPprChargePaid,
  refreshPprDelinquency,
} from "../actions";

/** Gerar as mensalidades do mês e aplicar os prazos de inadimplência. */
export function PprBillingToolbar({
  clinicId,
  canManage,
}: {
  clinicId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function generate() {
    startTransition(async () => {
      const r = await generatePprCharges(clinicId);
      if (!r.ok) toast.error(r.error ?? "Não foi possível gerar.");
      else {
        toast.success(
          r.created && r.created > 0
            ? `${r.created} mensalidade(s) gerada(s).`
            : "As mensalidades deste mês já estavam geradas."
        );
        router.refresh();
      }
    });
  }

  function refresh() {
    startTransition(async () => {
      const r = await refreshPprDelinquency(clinicId);
      if (!r.ok) toast.error(r.error ?? "Não foi possível atualizar.");
      else {
        toast.success(
          r.changed && r.changed > 0
            ? `${r.changed} plano(s) mudaram de situação.`
            : "Nenhum plano precisou de mudança."
        );
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-3">
      <Button size="sm" disabled={isPending} onClick={generate}>
        <Wallet className="mr-1 size-3.5" />
        Gerar mensalidades do mês
      </Button>
      {canManage && (
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={refresh}
        >
          <RefreshCw className="mr-1 size-3.5" />
          Aplicar inadimplência
        </Button>
      )}
      <p className="text-[11px] text-muted-foreground">
        Gerar cria uma cobrança por adesão ativa (não duplica). Aplicar
        inadimplência suspende quem passou do prazo e cancela quem passou do
        limite configurado.
      </p>
    </div>
  );
}

/** Baixa do pagamento de uma mensalidade. */
export function PprChargeRow({
  chargeId,
  paid,
}: {
  chargeId: string;
  paid: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const r = await markPprChargePaid(chargeId, !paid);
      if (!r.ok) toast.error(r.error ?? "Não foi possível atualizar.");
      else {
        toast.success(paid ? "Baixa desfeita." : "Mensalidade paga! 🎉");
        router.refresh();
      }
    });
  }

  return (
    <Button
      size="sm"
      variant={paid ? "ghost" : "default"}
      disabled={isPending}
      onClick={toggle}
      title={paid ? "Desfazer a baixa" : "Marcar como paga"}
    >
      {paid ? (
        <Undo2 className="size-3.5" />
      ) : (
        <>
          <CheckCircle2 className="mr-1 size-3.5" />
          Dar baixa
        </>
      )}
    </Button>
  );
}
