"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  History,
  RotateCcw,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/commercial";
import {
  allocateReceipt,
  countByFilter,
  inPeriod,
  INSTALLMENT_STATUS_LABELS,
  matchesFilter,
  PERIOD_PRESETS,
  periodLabel,
  RECEIVABLE_FILTERS,
  receiptErrors,
  resolvePeriod,
  summarizeReceipts,
  summarizeReceivables,
  viewInstallment,
  type Installment,
  type InstallmentStatus,
  type PeriodPreset,
  type ReceivableFilter,
} from "@/lib/finance/receivables";
import { lateLabel } from "@/lib/finance/late-fees";
import type { ReceiptRow } from "./receivables-loader";
import { registerReceipt, reverseReceipt } from "./receivables-actions";

const STATUS_STYLE: Record<InstallmentStatus, string> = {
  em_aberto: "border-border bg-muted text-muted-foreground",
  parcial: "border-sky-300 bg-sky-50 text-sky-800",
  paga: "border-emerald-300 bg-emerald-50 text-emerald-800",
  cancelada: "border-border bg-muted text-muted-foreground",
  renegociada: "border-amber-300 bg-amber-50 text-amber-800",
};

const METHODS: (PaymentMethod | "dinheiro")[] = [
  "pix",
  "dinheiro",
  "boleto",
  "cartao",
  "cartao_parcelado",
  "deposito_avista",
];

function methodLabel(m: string | null): string {
  if (!m) return "—";
  if (m === "dinheiro") return "Dinheiro";
  return PAYMENT_METHOD_LABELS[m as PaymentMethod] ?? m;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * FIN1 — a aba Financeiro da ficha: o que o cliente deve, o que está em atraso
 * e o que já pagou. A baixa aceita **valor parcial** (paciente pagando metade da
 * parcela é rotina em clínica), mas **nunca desconto**: quitar por menos é ato
 * de renegociação.
 */
export function ReceivablesSection({
  clientId,
  installments,
  receipts,
  today,
  canReceive,
  canReverse,
}: {
  clientId: string;
  installments: Installment[];
  receipts: ReceiptRow[];
  today: string;
  canReceive: boolean;
  canReverse: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<ReceivableFilter>("todas");
  const [preset, setPreset] = useState<PeriodPreset>("tudo");
  const [customStart, setCustomStart] = useState(today.slice(0, 8) + "01");
  const [customEnd, setCustomEnd] = useState(today);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [receivedAt, setReceivedAt] = useState(today);
  const [method, setMethod] = useState<string>("pix");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const allViews = useMemo(
    () => installments.map((i) => viewInstallment(i, today)),
    [installments, today]
  );
  // Período escolhido: as cobranças entram pelo VENCIMENTO; os recebimentos,
  // pela data em que o dinheiro entrou.
  const period = useMemo(
    () =>
      resolvePeriod(preset, today, { start: customStart, end: customEnd }),
    [preset, today, customStart, customEnd]
  );
  const views = useMemo(
    () => allViews.filter((v) => inPeriod(v.dueDate, period)),
    [allViews, period]
  );
  const received = useMemo(
    () => summarizeReceipts(receipts, period),
    [receipts, period]
  );
  const summary = useMemo(
    () => summarizeReceivables(views, received.totalCents),
    [views, received.totalCents]
  );
  const counts = useMemo(() => countByFilter(views), [views]);
  const shown = useMemo(
    () => views.filter((v) => matchesFilter(v, filter)),
    [views, filter]
  );

  const paying = allViews.find((v) => v.id === payingId) ?? null;
  const amountCents = parseBRLToCents(amount) ?? 0;
  const errors = paying
    ? receiptErrors({
        amountCents,
        payoffCents: paying.updatedBalanceCents,
        receivedAt,
        today,
      })
    : [];
  const allocation = paying ? allocateReceipt(paying, amountCents) : null;

  function openPayment(id: string) {
    const v = allViews.find((x) => x.id === id);
    if (!v) return;
    setPayingId(id);
    // Já vem com multa, juros e benefício perdido — o usuário só reduz se
    // recebeu menos (o que vira baixa parcial, nunca quitação).
    setAmount(centsToInput(v.updatedBalanceCents));
    setReceivedAt(today);
    setMethod(v.paymentMethod ?? "pix");
    setReference("");
    setNotes("");
  }

  function save() {
    if (!paying) return;
    const quita = amountCents >= paying.updatedBalanceCents;
    startTransition(async () => {
      const r = await registerReceipt({
        clientId,
        installmentId: paying.id,
        amountCents,
        receivedAt,
        paymentMethod: method,
        reference,
        notes,
        clientToken: crypto.randomUUID(),
      });
      if (r.ok) {
        toast.success(
          quita
            ? "Recebimento registrado — cobrança quitada."
            : "Recebimento parcial registrado."
        );
        setPayingId(null);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function doReverse() {
    if (!reversingId) return;
    startTransition(async () => {
      const r = await reverseReceipt({ clientId, receiptId: reversingId, reason });
      if (r.ok) {
        toast.success("Recebimento estornado.");
        setReversingId(null);
        setReason("");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  if (installments.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Este cliente ainda não tem cobranças. Elas nascem quando uma venda é
          fechada — na negociação do consultor ou na venda direta.
        </CardContent>
      </Card>
    );
  }

  const historyOf = (id: string) =>
    receipts.filter((r) => r.installmentId === id);

  return (
    <div className={cn("space-y-4", isPending && "opacity-70")}>
      {/* Período: mês, ano ou intervalo escolhido. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">
          Período
        </span>
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value as PeriodPreset)}
          className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
        >
          {PERIOD_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        {preset === "custom" && (
          <>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
            />
            <span className="text-xs text-muted-foreground">até</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
            />
          </>
        )}
        {period && (
          <span className="text-[11px] text-muted-foreground">
            cobranças com vencimento {periodLabel(preset, period)}
          </span>
        )}
      </div>

      {/* Resumo do topo. */}
      <div className="grid gap-2 sm:grid-cols-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              Em aberto
            </p>
            <p className="text-xl font-semibold tabular-nums">
              {formatBRL(summary.openCents)}
            </p>
          </CardContent>
        </Card>
        <Card className={cn(summary.lateCents > 0 && "border-destructive/50")}>
          <CardContent className="p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              Em atraso {summary.lateCount > 0 && `(${summary.lateCount})`}
            </p>
            <p
              className={cn(
                "text-xl font-semibold tabular-nums",
                summary.lateCents > 0 && "text-destructive"
              )}
            >
              {formatBRL(summary.lateCents)}
            </p>
            {summary.lateCents > 0 && (
              <p className="text-[10px] text-muted-foreground">
                já com multa e juros
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              Recebido {periodLabel(preset, period)}
            </p>
            <p className="text-xl font-semibold tabular-nums text-emerald-700">
              {formatBRL(received.totalCents)}
            </p>
            {/* O dono pediu: o card precisa dizer o que aí dentro é multa e
                juros — senão o número parece faturamento e não é. */}
            {received.chargesCents + received.benefitCents > 0 ? (
              <p className="text-[10px] leading-tight text-muted-foreground">
                {formatBRL(received.principalCents)} de parcelas +{" "}
                {formatBRL(received.chargesCents)} de multa e juros
                {received.benefitCents > 0 && (
                  <> + {formatBRL(received.benefitCents)} de benefício perdido</>
                )}
              </p>
            ) : (
              received.count > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  sem multa e juros
                </p>
              )
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cobranças. */}
      <Card>
        <CardHeader className="gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="size-4 text-primary" />
            Cobranças
          </CardTitle>
          {/* Filtro por situação. */}
          <div className="flex flex-wrap gap-1">
            {RECEIVABLE_FILTERS.map((f) => {
              const active = filter === f.key;
              const n = counts[f.key];
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  disabled={n === 0 && f.key !== "todas"}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                    !active &&
                      f.key === "em_atraso" &&
                      n > 0 &&
                      "border-destructive/40 text-destructive"
                  )}
                >
                  {f.label}
                  <span className="ml-1 tabular-nums opacity-70">{n}</span>
                </button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {shown.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Nenhuma cobrança nesta situação.
            </p>
          )}
          {shown.map((v) => {
            const hist = historyOf(v.id);
            return (
              <div
                key={v.id}
                className={cn(
                  "rounded-lg border p-2.5 text-sm",
                  v.isLate && "border-destructive/40 bg-destructive/5"
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-6 text-center text-xs text-muted-foreground">
                    {v.seq}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">
                      {v.kind === "entrada" ? "Entrada" : "Parcela"} ·{" "}
                      {fmtDate(v.dueDate)}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {v.origin === "direct_sale" ? "Venda direta" : "Negociação"}
                      {v.paymentMethod && ` · ${methodLabel(v.paymentMethod)}`}
                    </span>
                    {v.isLate && (
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[11px] font-medium text-destructive">
                        <AlertTriangle className="size-3" />
                        {lateLabel(v.daysLate)} · multa{" "}
                        {formatBRL(v.lateFeeCents)} + juros{" "}
                        {formatBRL(v.interestCents)}
                        {v.benefitDueCents > 0 && (
                          <> + benefício perdido {formatBRL(v.benefitDueCents)}</>
                        )}
                      </span>
                    )}
                    {!v.isLate &&
                      v.isOpen &&
                      v.benefitDiscountCents > 0 && (
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          Pagando em dia, o cliente economiza{" "}
                          {formatBRL(v.benefitDiscountCents)} nesta parcela.
                        </span>
                      )}
                    {v.paidTotalCents > 0 && v.status === "parcial" && (
                      <span className="mt-0.5 block text-[11px] text-sky-800">
                        Recebido {formatBRL(v.paidTotalCents)} — falta{" "}
                        {formatBRL(v.updatedBalanceCents)}
                      </span>
                    )}
                  </span>

                  <Badge
                    variant="outline"
                    className={cn("text-[10px]", STATUS_STYLE[v.status])}
                  >
                    {INSTALLMENT_STATUS_LABELS[v.status]}
                  </Badge>

                  <span className="text-right tabular-nums">
                    {v.isLate ? (
                      <>
                        <span className="block text-xs text-muted-foreground line-through">
                          {formatBRL(v.balanceCents)}
                        </span>
                        <span className="font-semibold text-destructive">
                          {formatBRL(v.updatedBalanceCents)}
                        </span>
                      </>
                    ) : (
                      <span className="font-medium">
                        {formatBRL(
                          v.isOpen ? v.updatedBalanceCents : v.amountCents
                        )}
                      </span>
                    )}
                  </span>

                  <div className="flex gap-1">
                    {v.isOpen && canReceive && (
                      <Button
                        size="sm"
                        className="h-8"
                        onClick={() => openPayment(v.id)}
                      >
                        Dar baixa
                      </Button>
                    )}
                    {hist.length > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        onClick={() =>
                          setHistoryId(historyId === v.id ? null : v.id)
                        }
                      >
                        <History className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {historyId === v.id && (
                  <ul className="mt-2 space-y-1 border-t pt-2 text-xs">
                    {hist.map((r) => {
                      const extras = [
                        r.benefitCents > 0 &&
                          `benefício perdido ${formatBRL(r.benefitCents)}`,
                        r.lateFeeCents > 0 &&
                          `multa ${formatBRL(r.lateFeeCents)}`,
                        r.interestCents > 0 &&
                          `juros ${formatBRL(r.interestCents)}`,
                      ].filter(Boolean) as string[];
                      return (
                        <li
                          key={r.id}
                          className={cn(
                            "flex flex-wrap items-center justify-between gap-2",
                            (r.reversed || r.reversalOf) &&
                              "text-muted-foreground"
                          )}
                        >
                          <span>
                            {r.reversalOf ? "Estorno" : "Recebimento"} ·{" "}
                            {fmtDate(r.receivedAt)} ·{" "}
                            {methodLabel(r.paymentMethod)}
                            {r.reference && ` · ${r.reference}`}
                            {r.byName && ` · ${r.byName}`}
                            {/* Detalhamento: o dono precisa ver o que foi
                                principal e o que foi multa/juros. */}
                            {extras.length > 0 && (
                              <span className="block text-[11px]">
                                principal {formatBRL(r.principalCents)} +{" "}
                                {extras.join(" + ")}
                              </span>
                            )}
                            {r.reversalReason && (
                              <span className="block text-[11px]">
                                Motivo: {r.reversalReason}
                              </span>
                            )}
                          </span>
                          <span className="flex items-center gap-2">
                            <span
                              className={cn(
                                "tabular-nums",
                                r.reversalOf
                                  ? "text-destructive"
                                  : r.reversed
                                    ? "line-through"
                                    : "text-emerald-700"
                              )}
                            >
                              {r.reversalOf ? "−" : "+"}
                              {formatBRL(r.amountCents)}
                            </span>
                            {canReverse && !r.reversed && !r.reversalOf && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[11px]"
                                onClick={() => setReversingId(r.id)}
                              >
                                <RotateCcw className="mr-1 size-3" />
                                Estornar
                              </Button>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Baixa (total ou parcial). */}
      <Dialog
        open={paying !== null}
        onOpenChange={(o) => !o && setPayingId(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar recebimento</DialogTitle>
          </DialogHeader>
          {paying && (
            <div className="space-y-3 text-sm">
              <div className="space-y-1 rounded-lg bg-muted/40 p-2 text-xs">
                <p>
                  Cobrança {paying.seq} · vencimento {fmtDate(paying.dueDate)}
                </p>
                <ul className="space-y-0.5 tabular-nums">
                  <li className="flex justify-between">
                    <span>Valor da parcela</span>
                    <span>{formatBRL(paying.balanceCents)}</span>
                  </li>
                  {paying.benefitRemCents > 0 && (
                    <li className="flex justify-between text-destructive">
                      <span>Benefício perdido por atraso</span>
                      <span>+ {formatBRL(paying.benefitRemCents)}</span>
                    </li>
                  )}
                  {paying.lateFeeRemCents > 0 && (
                    <li className="flex justify-between text-destructive">
                      <span>Multa</span>
                      <span>+ {formatBRL(paying.lateFeeRemCents)}</span>
                    </li>
                  )}
                  {paying.interestRemCents > 0 && (
                    <li className="flex justify-between text-destructive">
                      <span>Juros ({lateLabel(paying.daysLate)})</span>
                      <span>+ {formatBRL(paying.interestRemCents)}</span>
                    </li>
                  )}
                  <li className="flex justify-between border-t pt-0.5 font-semibold">
                    <span>Total a receber</span>
                    <span>{formatBRL(paying.updatedBalanceCents)}</span>
                  </li>
                </ul>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Valor recebido (R$)
                  </span>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                  />
                  <span className="text-[10px] text-muted-foreground">
                    Recebeu só uma parte? Basta digitar o valor menor.
                  </span>
                </label>
                <label className="block">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Data do recebimento
                  </span>
                  <input
                    type="date"
                    value={receivedAt}
                    onChange={(e) => setReceivedAt(e.target.value)}
                    className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Forma de pagamento
                  </span>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                  >
                    {METHODS.map((m) => (
                      <option key={m} value={m}>
                        {methodLabel(m)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Comprovante (nº/autenticação)
                  </span>
                  <input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="opcional"
                    className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-[11px] font-medium text-muted-foreground">
                  Observação
                </span>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="opcional"
                  className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                />
              </label>

              {errors.length > 0 && (
                <ul className="space-y-0.5 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                  {errors.map((e) => (
                    <li key={e}>• {e}</li>
                  ))}
                </ul>
              )}

              {errors.length === 0 && allocation && (
                <p className="rounded-lg border border-border bg-muted/30 p-2 text-xs">
                  Vai ser registrado como principal{" "}
                  <strong>{formatBRL(allocation.principalCents)}</strong>
                  {allocation.benefitCents > 0 && (
                    <>
                      {" "}
                      + benefício perdido{" "}
                      <strong>{formatBRL(allocation.benefitCents)}</strong>
                    </>
                  )}
                  {allocation.lateFeeCents > 0 && (
                    <>
                      {" "}
                      + multa{" "}
                      <strong>{formatBRL(allocation.lateFeeCents)}</strong>
                    </>
                  )}
                  {allocation.interestCents > 0 && (
                    <>
                      {" "}
                      + juros{" "}
                      <strong>{formatBRL(allocation.interestCents)}</strong>
                    </>
                  )}
                  .
                </p>
              )}

              {errors.length === 0 &&
                amountCents < paying.updatedBalanceCents && (
                  <p className="rounded-lg border border-sky-300 bg-sky-50 p-2 text-xs text-sky-900">
                    Baixa parcial: sobra{" "}
                    <strong>
                      {formatBRL(paying.updatedBalanceCents - amountCents)}
                    </strong>{" "}
                    em aberto, e a multa e os juros continuam sobre o valor
                    cheio até a cobrança ser quitada. Perdoar a diferença só em
                    renegociação.
                  </p>
                )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPayingId(null)}>
              Cancelar
            </Button>
            <Button disabled={isPending || errors.length > 0} onClick={save}>
              <Check className="mr-1 size-4" />
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Estorno. */}
      <Dialog
        open={reversingId !== null}
        onOpenChange={(o) => !o && setReversingId(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Estornar recebimento</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            O recebimento não é apagado: fica no histórico com um estorno ao
            lado, e o saldo da cobrança volta. Escreva o motivo.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex.: cheque devolvido; valor lançado na cobrança errada..."
            className="min-h-20 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReversingId(null)}>
              Cancelar
            </Button>
            <Button
              disabled={isPending || !reason.trim()}
              onClick={doReverse}
            >
              Estornar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
