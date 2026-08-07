"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  FileText,
  Handshake,
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
import {
  canRenegotiateInstallment,
  RENEGOTIATION_STATUS_LABELS,
} from "@/lib/finance/renegotiation";
import type {
  ReceiptRow,
  RenegotiationRow,
  SaleSummary,
} from "./receivables-loader";
import {
  authorizeRenegotiation,
  registerBoletoIssue,
  registerReceipt,
  reverseReceipt,
  setRenegotiationStep,
} from "./receivables-actions";
import { RenegotiationDialog } from "./renegotiation-dialog";

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
  renegotiations,
  sales,
  maxDiscountPercent,
  today,
  boletos,
  boletoIssuableIds,
  canReceive,
  canReverse,
  canRenegotiate,
  canAuthorize,
}: {
  clientId: string;
  installments: Installment[];
  receipts: ReceiptRow[];
  renegotiations: RenegotiationRow[];
  sales: SaleSummary[];
  maxDiscountPercent: number | null;
  today: string;
  /** Boletos já emitidos, por cobrança (FIN4b.2). */
  boletos: Record<string, { issuedAt: string; feeCents: number }>;
  /** Cobranças cuja adquirente cobra a taxa do boleto na emissão. */
  boletoIssuableIds: string[];
  canReceive: boolean;
  canReverse: boolean;
  canRenegotiate: boolean;
  /** Gerente da unidade / Admin Master — quem libera desconto acima do teto. */
  canAuthorize: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<ReceivableFilter>("todas");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [renegotiating, setRenegotiating] = useState(false);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [decisionApprove, setDecisionApprove] = useState(true);
  const [decisionNote, setDecisionNote] = useState("");
  /** Documento aberto no resumo ("a que se refere esta cobrança"). */
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);
  /** Qual cobrança foi clicada — para o resumo dizer "parcela 2 de 4". */
  const [openFromId, setOpenFromId] = useState<string | null>(null);
  /** Filtro por documento: cliente com várias vendas acha o que precisa. */
  const [codeFilter, setCodeFilter] = useState<string>("");
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
    () =>
      allViews.filter(
        (v) =>
          inPeriod(v.dueDate, period) &&
          (!codeFilter || v.sourceCode === codeFilter)
      ),
    [allViews, period, codeFilter]
  );
  /** Os documentos que este cliente tem, para o seletor. */
  const codeOptions = useMemo(() => {
    const seen = new Map<string, number>();
    for (const v of allViews) {
      if (!v.sourceCode) continue;
      seen.set(v.sourceCode, (seen.get(v.sourceCode) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [allViews]);
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

  /**
   * FIN4b.2 — registra que o boleto foi gerado. A taxa é lançada AGORA porque
   * é agora que ela sai do caixa: o banco cobra a emissão pago ou não. A baixa
   * desta cobrança não cobra a taxa de novo.
   */
  function issueBoleto(id: string) {
    startTransition(async () => {
      const r = await registerBoletoIssue({
        clientId,
        installmentId: id,
        issuedAt: today,
      });
      if (r.ok) {
        toast.success(
          r.waived
            ? "Emissão registrada — sem taxa (franquia do mês)."
            : `Emissão registrada — taxa de ${formatBRL(r.feeCents ?? 0)}.`
        );
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

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
        const base = quita
          ? "Recebimento registrado — cobrança quitada."
          : "Recebimento parcial registrado.";
        // FIN4c: o cliente pagou o bruto, mas a clínica recebe o líquido — e
        // não hoje. Dizer isso na hora evita a surpresa no extrato.
        const fee = r.fee;
        toast.success(
          fee && fee.feeCents > 0
            ? `${base} Taxa de ${formatBRL(fee.feeCents)} — líquido ${formatBRL(fee.netCents)}${
                fee.settlementDate ? ` em ${fmtDate(fee.settlementDate)}` : ""
              }.`
            : base
        );
        setPayingId(null);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  const selectedViews = allViews.filter(
    (v) => picked.has(v.id) && canRenegotiateInstallment(v)
  );

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setStep(
    renegotiationId: string,
    step: "contract" | "payment_issued" | "payment_confirmed",
    value: boolean
  ) {
    startTransition(async () => {
      const r = await setRenegotiationStep({
        clientId,
        renegotiationId,
        step,
        value,
      });
      if (r.ok) router.refresh();
      else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function decide() {
    if (!decisionId) return;
    startTransition(async () => {
      const r = await authorizeRenegotiation({
        clientId,
        renegotiationId: decisionId,
        approve: decisionApprove,
        note: decisionNote,
      });
      if (r.ok) {
        toast.success(
          decisionApprove
            ? "Renegociação autorizada e aplicada."
            : "Renegociação recusada."
        );
        setDecisionId(null);
        setDecisionNote("");
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

        {/* Filtro por documento (venda ou renegociação). */}
        {codeOptions.length > 1 && (
          <>
            <span className="ml-2 text-[11px] font-medium text-muted-foreground">
              Documento
            </span>
            <select
              value={codeFilter}
              onChange={(e) => setCodeFilter(e.target.value)}
              className="h-8 rounded-lg border border-input bg-background px-2 font-mono text-xs"
            >
              <option value="">Todos ({codeOptions.length})</option>
              {codeOptions.map(([code, n]) => (
                <option key={code} value={code}>
                  {code} · {n}x
                </option>
              ))}
            </select>
          </>
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
          {/* FIN2: barra da renegociação — aparece ao marcar cobranças. */}
          {canRenegotiate && selectedViews.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2 text-xs">
              <span>
                <strong>{selectedViews.length}</strong> cobrança
                {selectedViews.length === 1 ? "" : "s"} marcada
                {selectedViews.length === 1 ? "" : "s"} ·{" "}
                <strong className="tabular-nums">
                  {formatBRL(
                    selectedViews.reduce(
                      (s, v) => s + v.updatedBalanceCents,
                      0
                    )
                  )}
                </strong>{" "}
                devidos hoje
              </span>
              <span className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px]"
                  onClick={() => setPicked(new Set())}
                >
                  Limpar
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => setRenegotiating(true)}
                >
                  <Handshake className="mr-1 size-3.5" />
                  Renegociar
                </Button>
              </span>
            </div>
          )}
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
                  {canRenegotiate && canRenegotiateInstallment(v) ? (
                    <input
                      type="checkbox"
                      className="size-3.5 shrink-0 accent-primary"
                      checked={picked.has(v.id)}
                      onChange={() => togglePick(v.id)}
                      aria-label={`Marcar cobrança ${v.seq} para renegociar`}
                    />
                  ) : (
                    canRenegotiate && <span className="size-3.5 shrink-0" />
                  )}
                  <span className="w-6 text-center text-xs text-muted-foreground">
                    {v.seq}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">
                      {v.kind === "entrada" ? "Entrada" : "Parcela"} ·{" "}
                      {fmtDate(v.dueDate)}
                    </span>
                    {/* FIN2.1: o código diz a que a cobrança se refere e abre
                        o resumo da venda. */}
                    {v.sourceCode && (
                      <button
                        type="button"
                        onClick={() => {
                          setOpenSourceId(v.sourceId);
                          setOpenFromId(v.id);
                        }}
                        title="Ver a que esta cobrança se refere"
                        className="ml-2 rounded border border-border bg-muted/60 px-1 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                      >
                        {v.sourceCode}
                      </button>
                    )}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {v.origin === "direct_sale"
                        ? "Venda direta"
                        : v.origin === "renegotiation"
                          ? "Renegociação"
                          : "Negociação"}
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
                    {/* FIN4b.2: o boleto já custou na emissão — a baixa não
                        cobra de novo. */}
                    {boletos[v.id] && (
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        Boleto emitido em {fmtDate(boletos[v.id].issuedAt)}
                        {boletos[v.id].feeCents > 0
                          ? ` — taxa de ${formatBRL(boletos[v.id].feeCents)} já lançada`
                          : " — sem taxa (franquia do mês)"}
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
                    {canReceive &&
                      v.isOpen &&
                      !boletos[v.id] &&
                      boletoIssuableIds.includes(v.id) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          title="A adquirente cobra a taxa do boleto ao gerar o documento"
                          onClick={() => issueBoleto(v.id)}
                        >
                          Registrar emissão
                        </Button>
                      )}
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
                        // FIN4c: o que a adquirente levou e quando o dinheiro cai.
                        r.acquirerFeeCents > 0 &&
                          `taxa ${formatBRL(r.acquirerFeeCents)} · líquido ${formatBRL(
                            r.amountCents - r.acquirerFeeCents
                          )}`,
                        r.acquirerFeeChargedAtIssue &&
                          "taxa já paga na emissão",
                        r.settlementDate &&
                          r.settlementDate !== r.receivedAt &&
                          `cai em ${fmtDate(r.settlementDate)}`,
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

      {/* FIN2.1: o resumo do documento que gerou a cobrança. */}
      <Dialog
        open={openSourceId !== null}
        onOpenChange={(o) => !o && setOpenSourceId(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>A que esta cobrança se refere</DialogTitle>
          </DialogHeader>
          {(() => {
            const sale = sales.find((s) => s.id === openSourceId);
            if (sale) {
              return (
                <div className="space-y-2 text-sm">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{sale.code ?? "—"}</span> ·{" "}
                    {sale.kind === "direct_sale"
                      ? "Venda direta"
                      : "Plano de tratamento"}{" "}
                    · {new Date(sale.createdAt).toLocaleDateString("pt-BR")}
                  </p>
                  <ul className="space-y-1">
                    {sale.items.map((it, i) => (
                      <li
                        key={i}
                        className="flex items-start justify-between gap-2 border-b border-dashed pb-1 text-xs last:border-0"
                      >
                        <span>
                          {it.quantity > 1 && `${it.quantity}× `}
                          {it.description}
                          {it.discountCents > 0 && (
                            <span className="block text-[11px] text-emerald-700">
                              benefício do programa −{" "}
                              {formatBRL(it.discountCents)}
                              {it.finalCents === 0 && " (sem custo)"}
                            </span>
                          )}
                        </span>
                        <span className="whitespace-nowrap text-right tabular-nums">
                          {it.discountCents > 0 && (
                            <span className="block text-[11px] text-muted-foreground line-through">
                              {formatBRL(it.quantity * it.unitPriceCents)}
                            </span>
                          )}
                          <span className="font-medium">
                            {formatBRL(it.finalCents)}
                          </span>
                        </span>
                      </li>
                    ))}
                    {sale.items.length === 0 && (
                      <li className="text-xs text-muted-foreground">
                        Esta venda não tem procedimentos lançados.
                      </li>
                    )}
                  </ul>
                  <p className="flex justify-between border-t pt-1 font-semibold tabular-nums">
                    <span>Total da venda</span>
                    <span>{formatBRL(sale.totalCents)}</span>
                  </p>

                  {/* Como esta venda foi cobrada, e onde está a parcela
                      que o usuário clicou. */}
                  {(() => {
                    const cobrancas = allViews
                      .filter((v) => v.sourceId === sale.id)
                      .sort((a, b) => a.seq - b.seq);
                    if (cobrancas.length === 0) return null;
                    const pos = cobrancas.findIndex((v) => v.id === openFromId);
                    return (
                      <div className="rounded-lg border bg-muted/30 p-2">
                        <p className="mb-1 text-[11px] font-semibold">
                          Cobranças desta venda ({cobrancas.length})
                          {pos >= 0 && (
                            <span className="ml-1 font-normal text-primary">
                              — você clicou na {pos + 1}ª de{" "}
                              {cobrancas.length}
                            </span>
                          )}
                        </p>
                        <ul className="space-y-0.5 text-[11px]">
                          {cobrancas.map((v) => (
                            <li
                              key={v.id}
                              className={cn(
                                "flex flex-wrap items-center justify-between gap-2 rounded px-1",
                                v.id === openFromId &&
                                  "bg-primary/10 font-medium text-primary"
                              )}
                            >
                              <span>
                                {v.kind === "entrada"
                                  ? "Entrada"
                                  : `Parcela ${v.seq}`}{" "}
                                · venc. {fmtDate(v.dueDate)} ·{" "}
                                {INSTALLMENT_STATUS_LABELS[v.status]}
                              </span>
                              <span className="tabular-nums">
                                {formatBRL(v.amountCents)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()}
                </div>
              );
            }
            const reneg = renegotiations.find((r) => r.id === openSourceId);
            if (reneg) {
              return (
                <div className="space-y-2 text-sm">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{reneg.code ?? "—"}</span> ·
                    Renegociação ·{" "}
                    {new Date(reneg.createdAt).toLocaleDateString("pt-BR")}
                    {reneg.byName && ` · ${reneg.byName}`}
                  </p>
                  <ul className="space-y-0.5 text-xs tabular-nums">
                    <li className="flex justify-between">
                      <span>Valor que faltava das parcelas</span>
                      <span>{formatBRL(reneg.originalPrincipalCents)}</span>
                    </li>
                    {reneg.originalBenefitCents > 0 && (
                      <li className="flex justify-between">
                        <span>Benefício perdido por atraso</span>
                        <span>+ {formatBRL(reneg.originalBenefitCents)}</span>
                      </li>
                    )}
                    {reneg.originalFeeCents > 0 && (
                      <li className="flex justify-between">
                        <span>Multa</span>
                        <span>+ {formatBRL(reneg.originalFeeCents)}</span>
                      </li>
                    )}
                    {reneg.originalInterestCents > 0 && (
                      <li className="flex justify-between">
                        <span>Juros do atraso</span>
                        <span>+ {formatBRL(reneg.originalInterestCents)}</span>
                      </li>
                    )}
                    {reneg.discountCents > 0 && (
                      <li className="flex justify-between text-destructive">
                        <span>Desconto concedido</span>
                        <span>− {formatBRL(reneg.discountCents)}</span>
                      </li>
                    )}
                    {reneg.financedInterestCents > 0 && (
                      <li className="flex justify-between">
                        <span>
                          Juros do parcelamento (
                          {reneg.monthlyInterestPercent}% ao mês)
                        </span>
                        <span>+ {formatBRL(reneg.financedInterestCents)}</span>
                      </li>
                    )}
                    <li className="flex justify-between border-t pt-0.5 font-semibold">
                      <span>Total renegociado</span>
                      <span>{formatBRL(reneg.newTotalCents)}</span>
                    </li>
                  </ul>
                  {reneg.reason && (
                    <p className="text-xs">Motivo: {reneg.reason}</p>
                  )}

                  {/* Quais cobranças entraram — e de qual venda vieram. */}
                  {(() => {
                    const antigas = allViews.filter(
                      (v) => v.renegotiatedById === reneg.id
                    );
                    if (antigas.length === 0) return null;
                    return (
                      <div className="rounded-lg border bg-muted/30 p-2">
                        <p className="mb-1 text-[11px] font-semibold">
                          Cobranças substituídas ({antigas.length})
                        </p>
                        <ul className="space-y-0.5 text-[11px]">
                          {antigas.map((v) => (
                            <li
                              key={v.id}
                              className="flex flex-wrap items-center justify-between gap-2"
                            >
                              <span>
                                {v.kind === "entrada"
                                  ? "Entrada"
                                  : `Parcela ${v.seq}`}{" "}
                                · venc. {fmtDate(v.dueDate)}
                                {v.sourceCode && (
                                  <span className="ml-1 font-mono text-muted-foreground">
                                    {v.sourceCode}
                                  </span>
                                )}
                              </span>
                              <span className="tabular-nums">
                                {formatBRL(v.amountCents)}
                                {v.paidAmountCents > 0 && (
                                  <span className="text-muted-foreground">
                                    {" "}
                                    (pago {formatBRL(v.paidAmountCents)})
                                  </span>
                                )}
                              </span>
                            </li>
                          ))}
                          <li className="flex justify-between border-t pt-0.5 font-medium">
                            <span>Valor original somado</span>
                            <span className="tabular-nums">
                              {formatBRL(
                                antigas.reduce((s, v) => s + v.amountCents, 0)
                              )}
                            </span>
                          </li>
                        </ul>
                      </div>
                    );
                  })()}

                  {/* E as cobranças novas que nasceram dela. */}
                  {(() => {
                    const novas = allViews.filter(
                      (v) => v.sourceId === reneg.id
                    );
                    if (novas.length === 0) return null;
                    return (
                      <div className="rounded-lg border bg-muted/30 p-2">
                        <p className="mb-1 text-[11px] font-semibold">
                          Novas cobranças ({novas.length})
                        </p>
                        <ul className="space-y-0.5 text-[11px]">
                          {novas.map((v) => (
                            <li
                              key={v.id}
                              className="flex flex-wrap items-center justify-between gap-2"
                            >
                              <span>
                                {v.kind === "entrada"
                                  ? "Entrada"
                                  : `Parcela ${v.seq}`}{" "}
                                · venc. {fmtDate(v.dueDate)} ·{" "}
                                {INSTALLMENT_STATUS_LABELS[v.status]}
                              </span>
                              <span className="tabular-nums">
                                {formatBRL(v.amountCents)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()}
                </div>
              );
            }
            return (
              <p className="text-sm text-muted-foreground">
                Não encontrei o documento desta cobrança.
              </p>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenSourceId(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* FIN2: renegociações — o documento que explica de onde veio o valor. */}
      {renegotiations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Handshake className="size-4 text-primary" />
              Renegociações
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {renegotiations.map((r) => (
              <div
                key={r.id}
                className={cn(
                  "rounded-lg border p-2.5 text-xs",
                  r.status === "aguardando_autorizacao" &&
                    "border-amber-300 bg-amber-50",
                  r.status === "recusada" && "opacity-60"
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {r.code && (
                      <span className="mr-1 font-mono text-[10px] text-muted-foreground">
                        {r.code}
                      </span>
                    )}
                    {new Date(r.createdAt).toLocaleDateString("pt-BR")}
                    {r.byName && ` · ${r.byName}`}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {RENEGOTIATION_STATUS_LABELS[r.status]}
                  </Badge>
                </div>
                <p className="mt-1 tabular-nums">
                  Dívida apurada {formatBRL(r.originalTotalCents)} → novo
                  parcelamento {formatBRL(r.newTotalCents)}
                  {r.discountCents > 0 && (
                    <span className="text-destructive">
                      {" "}
                      · desconto {formatBRL(r.discountCents)} (
                      {r.discountPercent}%)
                    </span>
                  )}
                  {r.discountCents < 0 && (
                    <span> · acréscimo {formatBRL(-r.discountCents)}</span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Composição: parcelas{" "}
                  {formatBRL(r.originalPrincipalCents)}
                  {r.originalBenefitCents > 0 &&
                    ` + benefício perdido ${formatBRL(r.originalBenefitCents)}`}
                  {r.originalFeeCents > 0 &&
                    ` + multa ${formatBRL(r.originalFeeCents)}`}
                  {r.originalInterestCents > 0 &&
                    ` + juros ${formatBRL(r.originalInterestCents)}`}
                  {r.financedInterestCents > 0 &&
                    ` + juros do parcelamento ${formatBRL(r.financedInterestCents)} (${r.monthlyInterestPercent}% ao mês)`}
                </p>
                {r.reason && (
                  <p className="mt-0.5 text-[11px]">Motivo: {r.reason}</p>
                )}
                {r.authorizedByName && (
                  <p className="text-[11px] text-muted-foreground">
                    Decisão de {r.authorizedByName}
                    {r.authorizationNote && ` — ${r.authorizationNote}`}
                  </p>
                )}
                {/* FIN2.4: fechamento do acordo — mesmas etapas da venda. */}
                {r.status === "aplicada" && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
                    <a
                      href={`/renegociacoes/${r.id}/acordo`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-medium hover:border-primary hover:text-primary"
                    >
                      <FileText className="size-3.5" />
                      Termo do acordo
                    </a>
                    {(
                      [
                        ["contract", "Acordo assinado", r.contractSigned],
                        ["payment_issued", "Cobrança emitida", r.paymentIssued],
                        [
                          "payment_confirmed",
                          "Pagamento confirmado",
                          r.paymentConfirmed,
                        ],
                      ] as const
                    ).map(([step, label, done]) => (
                      <label
                        key={step}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px]",
                          done
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                            : "border-border",
                          !canReceive && "opacity-60"
                        )}
                      >
                        <input
                          type="checkbox"
                          className="size-3 accent-emerald-600"
                          checked={done}
                          disabled={!canReceive || isPending}
                          onChange={(e) =>
                            setStep(r.id, step, e.target.checked)
                          }
                        />
                        {label}
                      </label>
                    ))}
                    {r.closedAt && (
                      <Badge className="bg-emerald-600 text-[10px] text-white">
                        Acordo fechado
                      </Badge>
                    )}
                  </div>
                )}

                {r.status === "aguardando_autorizacao" && canAuthorize && (
                  <div className="mt-2 flex gap-1">
                    <Button
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => {
                        setDecisionId(r.id);
                        setDecisionApprove(true);
                        setDecisionNote("");
                      }}
                    >
                      Autorizar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      onClick={() => {
                        setDecisionId(r.id);
                        setDecisionApprove(false);
                        setDecisionNote("");
                      }}
                    >
                      Recusar
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* FIN2: montar a renegociação. */}
      {canRenegotiate && (
        <RenegotiationDialog
          open={renegotiating}
          onOpenChange={(o) => {
            setRenegotiating(o);
            if (!o) setPicked(new Set());
          }}
          clientId={clientId}
          selected={selectedViews}
          today={today}
          maxDiscountPercent={maxDiscountPercent}
          isManager={canAuthorize}
        />
      )}

      {/* FIN2: decisão do Gerente sobre um desconto. */}
      <Dialog
        open={decisionId !== null}
        onOpenChange={(o) => !o && setDecisionId(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {decisionApprove ? "Autorizar renegociação" : "Recusar renegociação"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {decisionApprove
              ? "As cobranças antigas passam a valer como renegociadas e as novas entram na ficha."
              : "Nada muda nas cobranças. A renegociação fica registrada como recusada."}
          </p>
          <textarea
            value={decisionNote}
            onChange={(e) => setDecisionNote(e.target.value)}
            placeholder="Observação (opcional)"
            className="min-h-16 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDecisionId(null)}>
              Cancelar
            </Button>
            <Button disabled={isPending} onClick={decide}>
              {decisionApprove ? "Autorizar" : "Recusar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
