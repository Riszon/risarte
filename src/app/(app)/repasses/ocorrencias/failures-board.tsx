"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import { formatBrDateTime, formatIsoDateBr } from "@/lib/dates";
import {
  FAILURE_OUTCOME_LABEL,
  FAILURE_PAID_LABEL,
  FAILURE_RESOLUTION_LABEL,
  FAILURE_SOURCE_LABEL,
  FAILURE_STATUS_LABEL,
  discountError,
  failureEffectText,
  reasonError,
  type PayoutFailure,
} from "@/lib/finance/payout-report";
import { decidePayoutFailure } from "../actions";

/**
 * A lista de ocorrências e a decisão, UMA por vez. "Foi falha" mostra antes o
 * que vai acontecer (a mesma regra do banco); o desconto pode ser menor que o
 * valor pago, nunca maior.
 */
export function FailuresBoard({ failures }: { failures: PayoutFailure[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const [isFailure, setIsFailure] = useState(true);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");

  const abertas = failures.filter((f) => f.status === "aberta");
  const decididas = failures.filter((f) => f.status !== "aberta");
  const minhas = abertas.filter((f) => f.canDecide).length;

  function abrir(id: string) {
    setOpen(id);
    setIsFailure(true);
    setReason("");
    setAmount("");
  }

  function decidir(f: PayoutFailure) {
    const erro = reasonError(reason);
    if (erro) return void toast.error(erro);
    const base = f.payoutCents;
    const desconto = amount.trim() ? parseBRLToCents(amount) : null;
    if (isFailure) {
      const e = discountError(desconto, base);
      if (e) return void toast.error(e);
    }
    startTransition(async () => {
      const r = await decidePayoutFailure({
        failureId: f.id,
        isFailure,
        reason,
        discountCents: desconto,
        baseCents: base,
      });
      if (!r.ok) toast.error(r.error ?? "Algo deu errado.");
      else {
        toast.success(
          !isFailure
            ? "Registrado: não foi falha. Nada muda no repasse."
            : r.status === "desconto"
              ? "Falha registrada. O desconto entra no próximo relatório do dentista."
              : r.status === "nao_pagar"
                ? "Falha registrada. O repasse deste procedimento não será pago."
                : "Falha registrada. O mesmo dentista refaz sem receber de novo."
        );
        setOpen(null);
      }
      router.refresh();
    });
  }

  return (
    <div className={cn("space-y-6", isPending && "opacity-70")}>
      <section className="space-y-2">
        <h2 className="font-medium">
          Esperando decisão{" "}
          <span className="text-xs font-normal text-muted-foreground">
            ({abertas.length}
            {minhas > 0 ? `; ${minhas} com você` : ""})
          </span>
        </h2>
        <p className="text-xs text-muted-foreground">
          Uma ocorrência sem decisão não trava nada: os outros pagamentos do
          dentista seguem. Depois de 3 dias úteis, quem decide recebe um lembrete.
        </p>
        {abertas.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">
            Nenhuma ocorrência esperando decisão.
          </p>
        ) : (
          <ul className="divide-y divide-dashed rounded-lg border text-sm">
            {abertas.map((f) => (
              <li key={f.id} className="space-y-2 p-3">
                <Cabecalho f={f} />
                {f.canDecide && open !== f.id && (
                  <Button size="sm" disabled={isPending} onClick={() => abrir(f.id)}>
                    Decidir
                  </Button>
                )}
                {!f.canDecide && (
                  <p className="text-xs text-muted-foreground">
                    Quem decide é quem aprova a equipe deste dentista na unidade.
                  </p>
                )}
                {open === f.id && (
                  <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                    <div className="space-y-2">
                      <label className="flex items-start gap-2">
                        <input
                          type="radio"
                          name={`f-${f.id}`}
                          className="mt-1"
                          checked={isFailure}
                          onChange={() => setIsFailure(true)}
                        />
                        <span>
                          <span className="font-medium">Foi falha do dentista</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {failureEffectText(f)}
                          </span>
                        </span>
                      </label>
                      <label className="flex items-start gap-2">
                        <input
                          type="radio"
                          name={`f-${f.id}`}
                          className="mt-1"
                          checked={!isFailure}
                          onChange={() => setIsFailure(false)}
                        />
                        <span>
                          <span className="font-medium">Não foi falha do dentista</span>
                          <span className="block text-[11px] text-muted-foreground">
                            A ocorrência é encerrada e nada muda no repasse.
                          </span>
                        </span>
                      </label>
                    </div>
                    {isFailure &&
                      f.paidState !== "fora_de_relatorio" &&
                      !(f.source === "qualidade" && f.resolution === "redo_same") && (
                        <label className="block max-w-xs">
                          <Label className="text-[11px]">
                            Valor a descontar (vazio = {formatBRL(f.payoutCents)}, o valor
                            pago)
                          </Label>
                          <Input
                            className="h-8"
                            inputMode="decimal"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder={formatBRL(f.payoutCents)}
                          />
                        </label>
                      )}
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="block min-w-0 flex-1">
                        <Label className="text-[11px]">
                          Motivo (obrigatório; o dentista vê este texto quando houver desconto)
                        </Label>
                        <Input
                          className="h-8"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </label>
                      <Button size="sm" disabled={isPending} onClick={() => decidir(f)}>
                        Confirmar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
                        Desistir
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {decididas.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">
            Decididas{" "}
            <span className="text-xs font-normal text-muted-foreground">
              ({decididas.length})
            </span>
          </h2>
          <ul className="divide-y divide-dashed rounded-lg border text-sm">
            {decididas.map((f) => (
              <li key={f.id} className="space-y-1 p-3">
                <Cabecalho f={f} />
                <p className="text-xs">
                  <strong>{FAILURE_STATUS_LABEL[f.status]}</strong>
                  {f.outcome ? ` — ${FAILURE_OUTCOME_LABEL[f.outcome]}` : ""}
                  {f.outcome === "desconto" && f.discountCents
                    ? ` (${formatBRL(f.discountCents)})`
                    : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  Motivo: {f.decisionReason ?? "—"}
                  {f.decidedByName ? ` — ${f.decidedByName}` : ""}
                  {f.decidedAt ? `, ${formatBrDateTime(f.decidedAt)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Cabecalho({ f }: { f: PayoutFailure }) {
  return (
    <div className="space-y-0.5">
      <p>
        <span className="font-medium">{f.procedureName}</span>
        <span className="ml-2 text-xs text-muted-foreground">
          {f.providerName} · {f.clinicName} · finalizado em {formatIsoDateBr(f.finishedOn)}
        </span>
      </p>
      <p className="text-xs text-muted-foreground">
        {f.clientName ?? "—"}
        {f.clientId && (
          <Link href={`/prontuarios/${f.clientId}`} className="ml-2 underline">
            ver atendimento
          </Link>
        )}{" "}
        · repasse {formatBRL(f.payoutCents)} ({FAILURE_PAID_LABEL[f.paidState]})
      </p>
      <p className="text-xs">
        <Badge variant="outline" className="mr-2 text-[10px]">
          {FAILURE_SOURCE_LABEL[f.source]}
        </Badge>
        {f.resolution ? `${FAILURE_RESOLUTION_LABEL[f.resolution] ?? f.resolution}. ` : ""}
        {f.sourceNote ?? ""}
        <span className="ml-1 text-muted-foreground">
          ({formatBrDateTime(f.createdAt)}
          {f.createdByName ? `, ${f.createdByName}` : ""})
        </span>
      </p>
    </div>
  );
}
