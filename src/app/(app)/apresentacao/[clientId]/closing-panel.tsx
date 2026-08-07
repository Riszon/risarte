"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  CircleDot,
  FileSignature,
  Lock,
  PartyPopper,
  Receipt,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import {
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from "@/lib/commercial";
import { markClosingStep } from "./closing-actions";
import { openPlanCancellation } from "./cancellation-actions";
import {
  CANCELLATION_DESTINATIONS,
  CANCELLATION_DESTINATION_LABELS,
  cancellationErrors,
  type CancellationDestination,
} from "@/lib/finance/cancellation";

export type ClosingSummary = {
  finalCents: number;
  adjustmentCents: number;
  paymentMethod: PaymentMethod | null;
  installments: number;
  partialReason: string | null;
  excludedDescriptions: string[];
  presentationSummary: string | null;
};

export function ClosingPanel({
  clientId,
  negotiationId,
  sale,
  summary,
  canClose,
  canCancel = false,
  negotiationCancelled = false,
}: {
  clientId: string;
  negotiationId: string;
  sale: {
    contractSigned: boolean;
    /** 0202: cobrança gerada — informativo, não conclui a venda. */
    paymentIssued?: boolean;
    paymentConfirmed: boolean;
    closedAt: string | null;
  } | null;
  summary: ClosingSummary;
  canClose: boolean;
  /** Cancelar venda fechada é do Gerente/Admin (0205). */
  canCancel?: boolean;
  negotiationCancelled?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [destination, setDestination] = useState<CancellationDestination | "">(
    ""
  );
  const [returnDate, setReturnDate] = useState("");
  const [cancelNotes, setCancelNotes] = useState("");

  /**
   * 0206 — cancelar NÃO desfaz nada aqui. Este passo só apura o acerto de
   * contas e abre o termo; sessões, cobranças e fase do cliente só mudam
   * quando o paciente assinar e o Gerente efetivar, na página do termo.
   */
  function doCancel() {
    startTransition(async () => {
      const r = await openPlanCancellation({
        clientId,
        negotiationId,
        reason: cancelReason,
        destination: closed ? (destination || null) : null,
        returnDate: destination === "follow_up" ? returnDate || null : null,
        notes: cancelNotes,
      });
      if (r.ok && r.cancellationId) {
        toast.success("Termo de cancelamento gerado — confira e colha a assinatura.");
        router.push(`/cancelamentos/${r.cancellationId}/termo`);
      } else if (r.ok) {
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  const cancelErrors = cancellationErrors({
    reason: cancelReason,
    destination: destination || null,
    returnDate: returnDate || null,
    wasClosed: Boolean(sale?.closedAt),
  });

  const signed = sale?.contractSigned ?? false;
  const issued = sale?.paymentIssued ?? false;
  const paid = sale?.paymentConfirmed ?? false;
  const closed = Boolean(sale?.closedAt);

  function toggle(
    step: "contract" | "payment_issued" | "payment_confirmed",
    value: boolean
  ) {
    startTransition(async () => {
      const r = await markClosingStep(clientId, negotiationId, step, value);
      if (r.ok) {
        if (r.closed)
          toast.success(
            "VENDA CONCLUÍDA! Contrato assinado e pagamento confirmado — a recepção foi acionada para iniciar o tratamento."
          );
        else toast.success("Fechamento atualizado.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <Card className="border-emerald-200">
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <FileSignature className="size-4" />
          Fechamento
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Regra de ouro: só é venda com <strong>contrato assinado</strong> E{" "}
          <strong>pagamento confirmado</strong>.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Resumo que entra no contrato do cliente. */}
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Resumo do fechamento (vai no contrato)
          </p>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Valor final</span>
            <span className="text-base font-semibold">
              {formatBRL(summary.finalCents)}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            {summary.adjustmentCents !== 0 && (
              <span>
                {summary.adjustmentCents < 0 ? "Desconto" : "Acréscimo"}:{" "}
                {formatBRL(Math.abs(summary.adjustmentCents))}
              </span>
            )}
            <span>
              Pagamento:{" "}
              {summary.paymentMethod
                ? PAYMENT_METHOD_LABELS[summary.paymentMethod]
                : "a definir"}
            </span>
            {summary.installments > 1 && (
              <span>{summary.installments}x</span>
            )}
          </div>
          {summary.excludedDescriptions.length > 0 && (
            <div className="rounded-md border border-rose-200 bg-rose-50/60 p-2">
              <p className="text-xs font-medium text-rose-800">
                Aprovação parcial — não aprovados pelo cliente:
              </p>
              <ul className="mt-0.5 list-inside list-disc text-xs text-rose-900">
                {summary.excludedDescriptions.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
              {summary.partialReason && (
                <p className="mt-1 text-xs text-rose-900/80">
                  Motivo: {summary.partialReason}
                </p>
              )}
            </div>
          )}
          {summary.presentationSummary && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Resumo da apresentação:
              </p>
              <p className="whitespace-pre-wrap text-xs">
                {summary.presentationSummary}
              </p>
            </div>
          )}
        </div>

        {negotiationCancelled ? (
          <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm">
            <p className="font-semibold">Venda cancelada.</p>
            <p className="text-xs text-muted-foreground">
              As sessões não realizadas e as cobranças em aberto foram
              canceladas, e o cliente voltou para a Conversão Comercial.
            </p>
          </div>
        ) : closed ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
              <PartyPopper className="size-5 shrink-0" />
              <div>
                <p className="font-semibold">Venda concluída!</p>
                <p className="text-xs">
                  Cliente movido para o Início de Tratamento. A recepção foi
                  acionada para agendar.
                </p>
              </div>
            </div>
            {/* 0205: desfazer uma venda fechada por engano ou desistência. */}
            {canCancel && !cancelling && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => setCancelling(true)}
              >
                Cancelar tratamento
              </Button>
            )}
            {canCancel && cancelling && (
              <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2">
                <p className="text-xs">
                  Este passo <strong>não desfaz nada ainda</strong>: ele apura o
                  acerto de contas e gera o <strong>termo de cancelamento</strong>{" "}
                  para o paciente assinar. Sessões, cobranças e fase só mudam
                  depois da assinatura.
                </p>

                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Motivo do cancelamento (obrigatório)"
                  className="min-h-16 w-full rounded-md border border-input bg-transparent p-2 text-xs"
                />

                <label className="block">
                  <span className="text-[11px] font-medium">
                    Para onde o paciente vai depois do cancelamento
                  </span>
                  <select
                    value={destination}
                    onChange={(e) =>
                      setDestination(
                        e.target.value as CancellationDestination | ""
                      )
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
                  value={cancelNotes}
                  onChange={(e) => setCancelNotes(e.target.value)}
                  placeholder="Observações para o termo (opcional) — use para registrar o que o contrato previa"
                  className="min-h-12 w-full rounded-md border border-input bg-transparent p-2 text-xs"
                />

                {cancelErrors.length > 0 && (
                  <p className="text-[11px] text-destructive">
                    {cancelErrors[0]}
                  </p>
                )}

                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setCancelling(false)}
                  >
                    Voltar
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 text-xs"
                    disabled={isPending || cancelErrors.length > 0}
                    onClick={doCancel}
                  >
                    Gerar termo de cancelamento
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* 0202: os MESMOS três passos da venda direta e da renegociação.
                Só contrato + pagamento CONFIRMADO concluem a venda; "cobrança
                emitida" registra que o documento foi gerado. */}
            <div className="grid gap-2 sm:grid-cols-3">
              <StepToggle
                icon={<FileSignature className="size-4" />}
                label="Contrato assinado"
                hint="Assinatura via ZapSign (marcação manual por enquanto)"
                done={signed}
                disabled={!canClose || isPending}
                onToggle={(v) => toggle("contract", v)}
              />
              <StepToggle
                icon={<Receipt className="size-4" />}
                label="Cobrança emitida"
                hint="Boleto/link gerado e enviado — ainda não é pagamento"
                done={issued}
                disabled={!canClose || isPending}
                onToggle={(v) => toggle("payment_issued", v)}
              />
              <StepToggle
                icon={<Wallet className="size-4" />}
                label="Pagamento confirmado"
                hint="Dinheiro na conta (marcação manual por enquanto)"
                done={paid}
                disabled={!canClose || isPending}
                onToggle={(v) => toggle("payment_confirmed", v)}
              />
            </div>
            {!canClose && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="size-3.5" />
                Apenas o Assistente/Consultor Comercial (ou Gerente) registra o
                fechamento.
              </p>
            )}
            {canClose && (
              <p className="text-xs text-muted-foreground">
                {signed && paid
                  ? "Tudo pronto."
                  : `Falta: ${[!signed && "contrato assinado", !paid && "pagamento confirmado"]
                      .filter(Boolean)
                      .join(" e ")}.`}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StepToggle({
  icon,
  label,
  hint,
  done,
  disabled,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  done: boolean;
  disabled: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        done ? "border-emerald-300 bg-emerald-50" : "bg-card"
      )}
    >
      <p className="flex items-center gap-1.5 text-sm font-medium">
        {done ? (
          <CheckCircle2 className="size-4 text-emerald-600" />
        ) : (
          <CircleDot className="size-4 text-muted-foreground" />
        )}
        {icon}
        {label}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      <Button
        size="sm"
        variant={done ? "outline" : "default"}
        disabled={disabled}
        className="mt-2 h-7 w-full text-xs"
        onClick={() => onToggle(!done)}
      >
        {done ? "Desmarcar" : "Marcar como concluído"}
      </Button>
    </div>
  );
}
