"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Ban, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { openPlanCancellation } from "@/app/(app)/apresentacao/[clientId]/cancellation-actions";
import {
  CANCELLATION_DESTINATIONS,
  CANCELLATION_DESTINATION_LABELS,
  cancellationErrors,
  type CancellationDestination,
} from "@/lib/finance/cancellation";

/**
 * 0207 — cancelar o tratamento MORA NO PRONTUÁRIO.
 *
 * Estava enterrado na tela de apresentação (0206), e isso era errado por dois
 * motivos: o paciente já está na Fase 5, então apresentação é passado e
 * ninguém procura lá; e quem cancela é o **Gerente**, que não usa a tela do
 * Consultor. O lugar certo é junto do plano e das sessões — onde ele está
 * quando toma a decisão.
 */
export function CancelPlanCard({
  clientId,
  negotiationId,
  saleCode,
  negotiationCancelled,
  wasClosed,
  openCancellation,
}: {
  clientId: string;
  negotiationId: string;
  /** PT-00003 — o código da venda continua valendo depois de cancelada. */
  saleCode: string | null;
  negotiationCancelled: boolean;
  /** Venda fechada: exige destino do paciente (Fase 6 ou 7). */
  wasClosed: boolean;
  /** Termo do cancelamento (em andamento OU já efetivado). */
  openCancellation: { id: string; code: string | null; status: string } | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [destination, setDestination] = useState<CancellationDestination | "">(
    ""
  );
  const [returnDate, setReturnDate] = useState("");
  const [notes, setNotes] = useState("");

  const errors = cancellationErrors({
    reason,
    destination: destination || null,
    returnDate: returnDate || null,
    wasClosed,
  });

  function submit() {
    startTransition(async () => {
      const r = await openPlanCancellation({
        clientId,
        negotiationId,
        reason,
        destination: wasClosed ? destination || null : null,
        returnDate: destination === "follow_up" ? returnDate || null : null,
        notes,
      });
      if (r.ok && r.cancellationId) {
        toast.success("Termo gerado — confira e colha a assinatura.");
        router.push(`/cancelamentos/${r.cancellationId}/termo`);
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  /**
   * PLANO JÁ CANCELADO. O código da venda **continua valendo** — é ele que
   * amarra as cobranças, o termo e o histórico do paciente. Some daqui e o
   * cancelamento vira um buraco na ficha (achado do dono, 07/08/2026).
   */
  if (negotiationCancelled) {
    return (
      <Card className="border-border bg-muted/40">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <span>
            <span className="mr-2 rounded border border-border bg-background px-1 font-mono text-[11px]">
              {saleCode ?? "—"}
            </span>
            <strong>Plano cancelado</strong>
            {openCancellation?.code ? ` · termo ${openCancellation.code}` : ""}
            <span className="mt-0.5 block text-xs text-muted-foreground">
              As sessões não realizadas e as cobranças em aberto foram
              canceladas. O que já foi executado continua no prontuário.
            </span>
          </span>
          {openCancellation && (
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={
                <Link href={`/cancelamentos/${openCancellation.id}/termo`} />
              }
            >
              <FileText className="mr-1 size-4" />
              Ver termo assinado
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  // Já existe termo em andamento: o caminho é continuar nele, não abrir outro.
  if (
    openCancellation &&
    (openCancellation.status === "rascunho" ||
      openCancellation.status === "assinado")
  ) {
    return (
      <Card className="border-amber-300 bg-amber-50/50">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <span>
            <strong>Cancelamento em andamento</strong>
            {openCancellation.code ? ` (${openCancellation.code})` : ""} —{" "}
            {openCancellation.status === "assinado"
              ? "termo assinado, aguardando efetivação."
              : "aguardando a assinatura do paciente."}
          </span>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={`/cancelamentos/${openCancellation.id}/termo`} />}
          >
            <FileText className="mr-1 size-4" />
            Abrir termo
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          className="text-xs text-muted-foreground"
          onClick={() => setOpen(true)}
        >
          <Ban className="mr-1 size-4" />
          Cancelar tratamento
        </Button>
      </div>
    );
  }

  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardContent className="space-y-2 p-3">
        <p className="text-sm font-medium">Cancelar tratamento</p>
        <p className="text-xs">
          Este passo <strong>não desfaz nada ainda</strong>: apura o acerto de
          contas e gera o <strong>termo</strong> para o paciente assinar.
          Sessões, cobranças e fase só mudam depois da assinatura.
        </p>

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motivo do cancelamento (obrigatório)"
          className="min-h-16 w-full rounded-md border border-input bg-transparent p-2 text-xs"
        />

        {wasClosed && (
          <label className="block">
            <span className="text-[11px] font-medium">
              Para onde o paciente vai depois do cancelamento
            </span>
            <select
              value={destination}
              onChange={(e) =>
                setDestination(e.target.value as CancellationDestination | "")
              }
              className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">Escolher…</option>
              {CANCELLATION_DESTINATIONS.map((d) => (
                <option key={d} value={d}>
                  {CANCELLATION_DESTINATION_LABELS[d]}
                </option>
              ))}
            </select>
          </label>
        )}

        {destination === "follow_up" && (
          <label className="block">
            <span className="text-[11px] font-medium">
              Data de retorno (obrigatória)
            </span>
            <input
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
              className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            />
          </label>
        )}

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Observações para o termo (opcional) — use para registrar o que o contrato previa"
          className="min-h-12 w-full rounded-md border border-input bg-transparent p-2 text-xs"
        />

        {errors.length > 0 && (
          <p className="text-[11px] text-destructive">{errors[0]}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setOpen(false)}
          >
            Voltar
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-7 text-xs"
            disabled={isPending || errors.length > 0}
            onClick={submit}
          >
            Gerar termo de cancelamento
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
