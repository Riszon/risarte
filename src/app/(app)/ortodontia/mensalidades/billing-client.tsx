"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Ban, CheckCircle2, RefreshCw, Undo2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ORTHO_PAYMENT_METHOD_LABELS, ORTHO_PAYMENT_METHODS } from "@/lib/ortodontia/constants";
import {
  cancelOrthoCharge,
  generateOrthoCharges,
  markOrthoChargePaid,
  refreshOrthoDelinquency,
} from "../actions";

const selectClass = "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

/** Gerar as mensalidades do mês e marcar as atrasadas. */
export function OrthoBillingToolbar({ clinicId, canManage }: { clinicId: string; canManage: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function generate() {
    startTransition(async () => {
      const r = await generateOrthoCharges(clinicId);
      if (!r.ok) toast.error(r.error ?? "Não foi possível gerar.");
      else {
        toast.success(
          r.count && r.count > 0 ? `${r.count} mensalidade(s) gerada(s).` : "As mensalidades deste mês já estavam geradas."
        );
        router.refresh();
      }
    });
  }

  function refresh() {
    startTransition(async () => {
      const r = await refreshOrthoDelinquency(clinicId);
      if (!r.ok) toast.error(r.error ?? "Não foi possível atualizar.");
      else {
        toast.success(r.count && r.count > 0 ? `${r.count} mensalidade(s) marcada(s) como atrasada(s).` : "Nenhuma mensalidade venceu sem pagamento.");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-3">
      <Button size="sm" disabled={isPending} onClick={generate}>
        <Wallet className="mr-1 size-3.5" /> Gerar mensalidades do mês
      </Button>
      {canManage && (
        <Button size="sm" variant="outline" disabled={isPending} onClick={refresh}>
          <RefreshCw className="mr-1 size-3.5" /> Marcar atrasadas
        </Button>
      )}
      <p className="text-[11px] text-muted-foreground">
        Gerar cria uma cobrança por caso <strong>em tratamento</strong> com mensalidade (não duplica; contenção e aguardando início não cobram).
        Marcar atrasadas registra o atraso do que venceu sem pagamento.
      </p>
    </div>
  );
}

/** Baixa (com a forma de pagamento), desfazer e cancelar uma mensalidade. */
export function OrthoChargeRow({ chargeId, paid, canCancel }: { chargeId: string; paid: boolean; canCancel: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState<null | "pagar" | "cancelar">(null);
  const [method, setMethod] = useState<string>("pix");
  const [reason, setReason] = useState("");

  function pay() {
    startTransition(async () => {
      const r = await markOrthoChargePaid(chargeId, true, method);
      if (!r.ok) toast.error(r.error ?? "Não foi possível dar baixa.");
      else {
        toast.success("Mensalidade paga! 🎉");
        setOpen(null);
        router.refresh();
      }
    });
  }
  function undo() {
    startTransition(async () => {
      const r = await markOrthoChargePaid(chargeId, false);
      if (!r.ok) toast.error(r.error ?? "Não foi possível desfazer.");
      else {
        toast.success("Baixa desfeita.");
        router.refresh();
      }
    });
  }
  function cancel() {
    startTransition(async () => {
      const r = await cancelOrthoCharge(chargeId, reason);
      if (!r.ok) toast.error(r.error ?? "Não foi possível cancelar.");
      else {
        toast.success("Mensalidade cancelada.");
        setOpen(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="inline-flex items-center gap-1">
      {paid ? (
        <Button size="sm" variant="ghost" disabled={isPending} onClick={undo} title="Desfazer a baixa">
          <Undo2 className="size-3.5" />
        </Button>
      ) : (
        <>
          <Button size="sm" disabled={isPending} onClick={() => setOpen("pagar")}>
            <CheckCircle2 className="mr-1 size-3.5" /> Dar baixa
          </Button>
          {canCancel && (
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setOpen("cancelar")} title="Cancelar a mensalidade">
              <Ban className="size-3.5" />
            </Button>
          )}
        </>
      )}

      <Dialog open={open === "pagar"} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Dar baixa na mensalidade</DialogTitle>
            <DialogDescription>Como o paciente pagou? A baixa entra no fluxo de caixa de hoje.</DialogDescription>
          </DialogHeader>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={selectClass}>
            {ORTHO_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{ORTHO_PAYMENT_METHOD_LABELS[m]}</option>
            ))}
          </select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)} disabled={isPending}>Voltar</Button>
            <Button onClick={pay} disabled={isPending}>Confirmar baixa</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "cancelar"} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancelar a mensalidade</DialogTitle>
            <DialogDescription>Ela sai da DRE. Escreva o motivo (fica no histórico do caso).</DialogDescription>
          </DialogHeader>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="w-full rounded-lg border border-input bg-transparent p-2 text-sm" placeholder="Motivo do cancelamento" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)} disabled={isPending}>Voltar</Button>
            <Button variant="destructive" onClick={cancel} disabled={isPending || reason.trim().length < 5}>Cancelar mensalidade</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
