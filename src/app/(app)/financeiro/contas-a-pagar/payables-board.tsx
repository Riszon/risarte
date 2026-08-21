"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarSync,
  Check,
  History,
  Plus,
  RotateCcw,
  ShieldAlert,
  Sliders,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import type { ChartAccount } from "@/lib/finance/accounts";
import {
  countPayablesByFilter,
  matchesPayableFilter,
  payableErrors,
  payablePaymentErrors,
  PAYABLE_FILTERS,
  PAYABLE_STATUS_LABELS,
  requiresApproval,
  resolveApproval,
  summarizePayables,
  viewPayable,
  type ApprovalRule,
  type Payable,
  type PayableFilter,
  type PayablePaymentEntry,
  type PayableStatus,
} from "@/lib/finance/payables";
import {
  PERIOD_PRESETS,
  periodLabel,
  resolvePeriod,
  type PeriodPreset,
} from "@/lib/finance/receivables";
import {
  approvePayable,
  cancelPayable,
  registerPayablePayment,
  reversePayablePayment,
  savePayable,
} from "../payables-actions";
import { ApprovalRulesDialog } from "./approval-rules-dialog";
import {
  RecurrencesDialog,
  type RecurrenceRow,
} from "./recurrences-dialog";

export type PaymentRow = {
  id: string;
  payableId: string;
  amountCents: number;
  feeCents: number;
  interestCents: number;
  paidAt: string;
  paymentMethod: string | null;
  reference: string | null;
  reversed: boolean;
  reversalOf: string | null;
  reversalReason: string | null;
  byName: string | null;
};

const STATUS_STYLE: Record<PayableStatus, string> = {
  aguardando_autorizacao: "border-amber-300 bg-amber-50 text-amber-800",
  aberta: "border-border bg-muted text-muted-foreground",
  parcial: "border-sky-300 bg-sky-50 text-sky-800",
  paga: "border-emerald-300 bg-emerald-50 text-emerald-800",
  cancelada: "border-border bg-muted text-muted-foreground",
  recusada: "border-destructive/40 bg-destructive/5 text-destructive",
};

const METHODS = [
  { value: "pix", label: "PIX" },
  { value: "boleto", label: "Boleto" },
  { value: "transferencia", label: "Transferência" },
  { value: "debito_automatico", label: "Débito automático" },
  { value: "cartao", label: "Cartão" },
  { value: "dinheiro", label: "Dinheiro" },
];

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** FIN3 — o quadro das contas a pagar: lançar, autorizar, pagar e estornar. */
export function PayablesBoard({
  clinicId,
  payables,
  payments,
  paymentEntries,
  suppliers,
  accounts,
  costCenters,
  rules,
  recurrences,
  discounts,
  today,
  canManage,
  canConfigureNetworkRules,
  currentUserId,
  isFinanceStaff,
}: {
  clinicId: string;
  payables: Payable[];
  payments: PaymentRow[];
  paymentEntries: PayablePaymentEntry[];
  suppliers: { id: string; name: string }[];
  accounts: ChartAccount[];
  costCenters: { id: string; name: string }[];
  rules: ApprovalRule[];
  recurrences: RecurrenceRow[];
  /** Abatimento por pagar em dia, por conta. Vazio = sem desconto. */
  discounts: Record<string, number>;
  today: string;
  canManage: boolean;
  canConfigureNetworkRules: boolean;
  currentUserId: string;
  isFinanceStaff: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<PayableFilter>("todas");
  const [preset, setPreset] = useState<PeriodPreset>("tudo");
  const [customStart, setCustomStart] = useState(today.slice(0, 8) + "01");
  const [customEnd, setCustomEnd] = useState(today);
  const [supplierFilter, setSupplierFilter] = useState("");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [recurrencesOpen, setRecurrencesOpen] = useState(false);

  // Diálogos
  const [creating, setCreating] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [decisionApprove, setDecisionApprove] = useState(true);
  const [decisionNote, setDecisionNote] = useState("");
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");

  // Formulário de lançamento
  const [supplierId, setSupplierId] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(today);
  const [accrualDate, setAccrualDate] = useState(today);
  const [documentNumber, setDocumentNumber] = useState("");
  const [notes, setNotes] = useState("");

  // Formulário de pagamento
  const [payAmount, setPayAmount] = useState("");
  const [payFee, setPayFee] = useState("0,00");
  const [payInterest, setPayInterest] = useState("0,00");
  const [paidAt, setPaidAt] = useState(today);
  const [payMethod, setPayMethod] = useState("pix");
  const [payReference, setPayReference] = useState("");
  const [payNotes, setPayNotes] = useState("");
  // Abatimento aplicado nesta baixa. A tela sugere; a régua que vale é a do
  // banco, que recusa desconto acima do concedido.
  const [payDiscount, setPayDiscount] = useState(0);

  const period = useMemo(
    () => resolvePeriod(preset, today, { start: customStart, end: customEnd }),
    [preset, today, customStart, customEnd]
  );

  const allViews = useMemo(
    () => payables.map((p) => viewPayable(p, today)),
    [payables, today]
  );
  const views = useMemo(
    () =>
      allViews.filter(
        (v) =>
          (!period || (v.dueDate >= period.start && v.dueDate < period.end)) &&
          (!supplierFilter || v.supplierId === supplierFilter)
      ),
    [allViews, period, supplierFilter]
  );
  const counts = useMemo(() => countPayablesByFilter(views), [views]);
  const shown = useMemo(
    () => views.filter((v) => matchesPayableFilter(v, filter)),
    [views, filter]
  );
  const summary = useMemo(
    () => summarizePayables(views, paymentEntries, period),
    [views, paymentEntries, period]
  );

  // Prévia da alçada enquanto o usuário digita — sem surpresa ao salvar.
  const amountCents = parseBRLToCents(amount) ?? 0;
  const previewRule = accountCode
    ? resolveApproval(rules, clinicId, accountCode)
    : null;
  const previewNeedsApproval = previewRule
    ? requiresApproval(previewRule, amountCents)
    : false;

  const formErrors = payableErrors({
    description,
    accountCode,
    amountCents,
    dueDate,
  });

  const paying = allViews.find((v) => v.id === payingId) ?? null;
  const payCents = parseBRLToCents(payAmount) ?? 0;
  const payErrors = paying
    ? payablePaymentErrors({
        amountCents: payCents,
        balanceCents: paying.balanceCents,
        paidAt,
        today,
      })
    : [];

  function resetForm() {
    setSupplierId("");
    setAccountCode("");
    setCostCenterId("");
    setDescription("");
    setAmount("");
    setDueDate(today);
    setAccrualDate(today);
    setDocumentNumber("");
    setNotes("");
  }

  function create() {
    startTransition(async () => {
      const r = await savePayable({
        clinicId,
        supplierId: supplierId || null,
        accountCode,
        costCenterId: costCenterId || null,
        description,
        amountCents,
        dueDate,
        accrualDate,
        documentNumber,
        notes,
      });
      if (r.ok) {
        toast.success(
          previewNeedsApproval
            ? "Conta lançada — aguardando autorização."
            : "Conta lançada."
        );
        setCreating(false);
        resetForm();
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function openPayment(id: string) {
    const v = allViews.find((x) => x.id === id);
    if (!v) return;
    setPayingId(id);
    // A conta nasce cheia (decisão do dono); o abatimento entra aqui, na baixa.
    const disc = discounts[id] ?? 0;
    setPayDiscount(disc);
    setPayAmount(
      (Math.max(0, v.balanceCents - disc) / 100).toFixed(2).replace(".", ",")
    );
    setPayFee("0,00");
    setPayInterest("0,00");
    setPaidAt(today);
    setPayMethod("pix");
    setPayReference("");
    setPayNotes("");
  }

  function pay() {
    if (!paying) return;
    startTransition(async () => {
      const r = await registerPayablePayment({
        payableId: paying.id,
        amountCents: payCents,
        feeCents: parseBRLToCents(payFee) ?? 0,
        interestCents: parseBRLToCents(payInterest) ?? 0,
        discountCents: payDiscount,
        paidAt,
        paymentMethod: payMethod,
        reference: payReference,
        notes: payNotes,
        clientToken: crypto.randomUUID(),
      });
      if (r.ok) {
        toast.success(
          payCents >= paying.balanceCents
            ? "Pagamento registrado — conta quitada."
            : "Pagamento parcial registrado."
        );
        setPayingId(null);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function decide() {
    if (!decisionId) return;
    startTransition(async () => {
      const r = await approvePayable({
        payableId: decisionId,
        approve: decisionApprove,
        note: decisionNote,
      });
      if (r.ok) {
        toast.success(decisionApprove ? "Conta autorizada." : "Conta recusada.");
        setDecisionId(null);
        setDecisionNote("");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function doCancel() {
    if (!cancelId) return;
    startTransition(async () => {
      const r = await cancelPayable({ payableId: cancelId, reason: cancelReason });
      if (r.ok) {
        toast.success("Conta cancelada.");
        setCancelId(null);
        setCancelReason("");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function doReverse() {
    if (!reversingId) return;
    startTransition(async () => {
      const r = await reversePayablePayment({
        paymentId: reversingId,
        reason: reverseReason,
      });
      if (r.ok) {
        toast.success("Pagamento estornado.");
        setReversingId(null);
        setReverseReason("");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  const historyOf = (id: string) => payments.filter((p) => p.payableId === id);

  return (
    <div className={cn("space-y-4", isPending && "opacity-70")}>
      {/* Filtros. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">
          Vencimento
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
        {suppliers.length > 0 && (
          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
          >
            <option value="">Todos os fornecedores</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto flex gap-1">
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setRecurrencesOpen(true)}
            >
              <CalendarSync className="mr-1 size-3.5" />
              Recorrentes
              {recurrences.filter((r) => r.active).length > 0 && (
                <span className="ml-1 tabular-nums opacity-70">
                  {recurrences.filter((r) => r.active).length}
                </span>
              )}
            </Button>
          )}
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setRulesOpen(true)}
            >
              <Sliders className="mr-1 size-3.5" />
              Alçada
            </Button>
          )}
          {canManage && (
            <Button size="sm" className="h-8" onClick={() => setCreating(true)}>
              <Plus className="mr-1 size-4" />
              Nova conta
            </Button>
          )}
        </span>
      </div>

      {/* Resumo. */}
      <div className="grid gap-2 sm:grid-cols-4">
        <Card>
          <CardContent className="p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              A pagar
            </p>
            <p className="text-xl font-semibold tabular-nums">
              {formatBRL(summary.openCents)}
            </p>
          </CardContent>
        </Card>
        <Card className={cn(summary.overdueCents > 0 && "border-destructive/50")}>
          <CardContent className="p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              Vencidas {summary.overdueCount > 0 && `(${summary.overdueCount})`}
            </p>
            <p
              className={cn(
                "text-xl font-semibold tabular-nums",
                summary.overdueCents > 0 && "text-destructive"
              )}
            >
              {formatBRL(summary.overdueCents)}
            </p>
          </CardContent>
        </Card>
        <Card className={cn(summary.awaitingCount > 0 && "border-amber-300")}>
          <CardContent className="p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              A autorizar {summary.awaitingCount > 0 && `(${summary.awaitingCount})`}
            </p>
            <p className="text-xl font-semibold tabular-nums">
              {formatBRL(summary.awaitingCents)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              Pago {periodLabel(preset, period)}
            </p>
            <p className="text-xl font-semibold tabular-nums text-emerald-700">
              {formatBRL(summary.paidCents)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Chips de situação. */}
      <div className="flex flex-wrap gap-1">
        {PAYABLE_FILTERS.map((f) => {
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
                !active && f.key === "vencidas" && n > 0 &&
                  "border-destructive/40 text-destructive"
              )}
            >
              {f.label}
              <span className="ml-1 tabular-nums opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      {/* Lista. */}
      {shown.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma conta nesta situação.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1.5">
          {shown.map((v) => {
            const hist = historyOf(v.id);
            const canDecide =
              canManage &&
              v.status === "aguardando_autorizacao" &&
              (isFinanceStaff || v.createdById !== currentUserId);
            return (
              <div
                key={v.id}
                className={cn(
                  "rounded-lg border p-2.5 text-sm",
                  v.isOverdue && "border-destructive/40 bg-destructive/5",
                  v.status === "aguardando_autorizacao" &&
                    "border-amber-300 bg-amber-50/50"
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{v.description}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      venc. {fmtDate(v.dueDate)}
                      {v.supplierName && ` · ${v.supplierName}`}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {v.accountCode} {v.accountName}
                      {v.costCenterName && ` · ${v.costCenterName}`}
                      {v.documentNumber && ` · NF ${v.documentNumber}`}
                    </span>
                    {v.isOverdue && (
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-destructive">
                        <AlertTriangle className="size-3" />
                        {v.daysLate === 1
                          ? "1 dia vencida"
                          : `${v.daysLate} dias vencida`}
                      </span>
                    )}
                    {v.status === "parcial" && (
                      <span className="mt-0.5 block text-[11px] text-sky-800">
                        Pago {formatBRL(v.paidAmountCents)} de{" "}
                        {formatBRL(v.amountCents)}
                      </span>
                    )}
                    {v.cancelReason && (
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        Cancelada: {v.cancelReason}
                      </span>
                    )}
                    {v.approvalNote && (
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {v.approvedByName && `${v.approvedByName}: `}
                        {v.approvalNote}
                      </span>
                    )}
                  </span>

                  <Badge
                    variant="outline"
                    className={cn("text-[10px]", STATUS_STYLE[v.status])}
                  >
                    {PAYABLE_STATUS_LABELS[v.status]}
                  </Badge>

                  <span className="text-right font-medium tabular-nums">
                    {formatBRL(v.isOpen ? v.balanceCents : v.amountCents)}
                  </span>

                  <div className="flex gap-1">
                    {canDecide && (
                      <>
                        <Button
                          size="sm"
                          className="h-8 text-[11px]"
                          onClick={() => {
                            setDecisionId(v.id);
                            setDecisionApprove(true);
                            setDecisionNote("");
                          }}
                        >
                          Autorizar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-[11px]"
                          onClick={() => {
                            setDecisionId(v.id);
                            setDecisionApprove(false);
                            setDecisionNote("");
                          }}
                        >
                          Recusar
                        </Button>
                      </>
                    )}
                    {canManage &&
                      v.isOpen &&
                      v.status !== "aguardando_autorizacao" && (
                        <Button
                          size="sm"
                          className="h-8"
                          onClick={() => openPayment(v.id)}
                        >
                          Pagar
                        </Button>
                      )}
                    {canManage &&
                      v.paidAmountCents === 0 &&
                      !["cancelada", "recusada", "paga"].includes(v.status) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8"
                          title="Cancelar conta"
                          onClick={() => {
                            setCancelId(v.id);
                            setCancelReason("");
                          }}
                        >
                          <X className="size-3.5" />
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
                    {hist.map((p) => (
                      <li
                        key={p.id}
                        className={cn(
                          "flex flex-wrap items-center justify-between gap-2",
                          (p.reversed || p.reversalOf) && "text-muted-foreground"
                        )}
                      >
                        <span>
                          {p.reversalOf ? "Estorno" : "Pagamento"} ·{" "}
                          {fmtDate(p.paidAt)}
                          {p.paymentMethod &&
                            ` · ${METHODS.find((m) => m.value === p.paymentMethod)?.label ?? p.paymentMethod}`}
                          {p.reference && ` · ${p.reference}`}
                          {p.byName && ` · ${p.byName}`}
                          {(p.feeCents > 0 || p.interestCents > 0) && (
                            <span className="block text-[11px]">
                              principal {formatBRL(p.amountCents)}
                              {p.feeCents > 0 &&
                                ` + multa ${formatBRL(p.feeCents)}`}
                              {p.interestCents > 0 &&
                                ` + juros ${formatBRL(p.interestCents)}`}
                            </span>
                          )}
                          {p.reversalReason && (
                            <span className="block text-[11px]">
                              Motivo: {p.reversalReason}
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              "tabular-nums",
                              p.reversalOf
                                ? "text-emerald-700"
                                : p.reversed
                                  ? "line-through"
                                  : "text-destructive"
                            )}
                          >
                            {p.reversalOf ? "+" : "−"}
                            {formatBRL(
                              p.amountCents + p.feeCents + p.interestCents
                            )}
                          </span>
                          {canManage && !p.reversed && !p.reversalOf && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-[11px]"
                              onClick={() => setReversingId(p.id)}
                            >
                              <RotateCcw className="mr-1 size-3" />
                              Estornar
                            </Button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Nova conta. */}
      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova conta a pagar</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <Label className="text-[11px]">Descrição</Label>
              <Input
                className="h-9"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex.: prótese do paciente da cadeira 2 — laboratório X"
              />
            </label>
            <label className="block">
              <Label className="text-[11px]">Fornecedor</Label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
              >
                <option value="">— sem fornecedor —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <Label className="text-[11px]">Valor (R$)</Label>
              <Input
                className="h-9"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="block sm:col-span-2">
              <Label className="text-[11px]">Conta do plano de contas</Label>
              <select
                value={accountCode}
                onChange={(e) => setAccountCode(e.target.value)}
                className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
              >
                <option value="">— escolha —</option>
                {accounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <Label className="text-[11px]">Centro de custo</Label>
              <select
                value={costCenterId}
                onChange={(e) => setCostCenterId(e.target.value)}
                className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
              >
                <option value="">— sem centro —</option>
                {costCenters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <Label className="text-[11px]">Vencimento</Label>
              <Input
                className="h-9"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </label>
            <label className="block">
              <Label className="text-[11px]">Competência</Label>
              <Input
                className="h-9"
                type="date"
                value={accrualDate}
                onChange={(e) => setAccrualDate(e.target.value)}
              />
            </label>
            <label className="block">
              <Label className="text-[11px]">Nº da nota</Label>
              <Input
                className="h-9"
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
              />
            </label>
            <label className="block">
              <Label className="text-[11px]">Observação</Label>
              <Input
                className="h-9"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>

          {previewNeedsApproval && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                Esta despesa precisa de <strong>autorização</strong>
                {previewRule?.mode === "com_autorizacao"
                  ? " — a conta escolhida sempre exige."
                  : previewRule?.thresholdCents
                    ? ` — passou do teto de ${formatBRL(previewRule.thresholdCents)}.`
                    : "."}{" "}
                Ela fica registrada e só pode ser paga depois da liberação.
              </span>
            </p>
          )}
          {previewRule?.mode === "automatica" && accountCode && (
            <p className="rounded-lg border border-border bg-muted/30 p-2 text-xs">
              Despesa <strong>automática</strong> (já contratada): não pede
              autorização e não olha o teto.
            </p>
          )}

          {formErrors.length > 0 && (
            <ul className="space-y-0.5 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              {formErrors.map((e) => (
                <li key={e}>• {e}</li>
              ))}
            </ul>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button
              disabled={isPending || formErrors.length > 0}
              onClick={create}
            >
              <Check className="mr-1 size-4" />
              Lançar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pagamento. */}
      <Dialog open={paying !== null} onOpenChange={(o) => !o && setPayingId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
          </DialogHeader>
          {paying && (
            <div className="space-y-3 text-sm">
              <p className="rounded-lg bg-muted/40 p-2 text-xs">
                {paying.description} · vencimento {fmtDate(paying.dueDate)} ·
                saldo <strong>{formatBRL(paying.balanceCents)}</strong>
              </p>

              {payDiscount > 0 && (
                <label className="flex items-start gap-2 rounded-lg border border-emerald-600/40 bg-emerald-50 p-2 text-xs text-emerald-900">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={payDiscount > 0}
                    onChange={(e) => {
                      const disc = e.target.checked
                        ? (discounts[paying.id] ?? 0)
                        : 0;
                      setPayDiscount(disc);
                      setPayAmount(
                        (Math.max(0, paying.balanceCents - disc) / 100)
                          .toFixed(2)
                          .replace(".", ",")
                      );
                    }}
                  />
                  <span>
                    <strong>
                      Desconto por pontualidade: {formatBRL(payDiscount)}
                    </strong>
                    <br />
                    Vale porque o pagamento está sendo lançado até o vencimento.
                    Quitar a conta pede{" "}
                    <strong>
                      {formatBRL(paying.balanceCents - payDiscount)}
                    </strong>{" "}
                    em dinheiro — o resto some como abatimento.
                  </span>
                </label>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <Label className="text-[11px]">Valor pago (R$)</Label>
                  <Input
                    className="h-9"
                    inputMode="decimal"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                  />
                </label>
                <label className="block">
                  <Label className="text-[11px]">Data</Label>
                  <Input
                    className="h-9"
                    type="date"
                    value={paidAt}
                    onChange={(e) => setPaidAt(e.target.value)}
                  />
                </label>
                <label className="block">
                  <Label className="text-[11px]">Multa paga (R$)</Label>
                  <Input
                    className="h-9"
                    inputMode="decimal"
                    value={payFee}
                    onChange={(e) => setPayFee(e.target.value)}
                  />
                </label>
                <label className="block">
                  <Label className="text-[11px]">Juros pagos (R$)</Label>
                  <Input
                    className="h-9"
                    inputMode="decimal"
                    value={payInterest}
                    onChange={(e) => setPayInterest(e.target.value)}
                  />
                </label>
                <label className="block">
                  <Label className="text-[11px]">Forma</Label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                    className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                  >
                    {METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <Label className="text-[11px]">Comprovante</Label>
                  <Input
                    className="h-9"
                    value={payReference}
                    onChange={(e) => setPayReference(e.target.value)}
                    placeholder="opcional"
                  />
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Multa e juros são <strong>informados</strong>: quem define é o
                fornecedor. Eles entram como despesa financeira, separados do
                custo em si.
              </p>
              {payErrors.length > 0 && (
                <ul className="space-y-0.5 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                  {payErrors.map((e) => (
                    <li key={e}>• {e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPayingId(null)}>
              Cancelar
            </Button>
            <Button disabled={isPending || payErrors.length > 0} onClick={pay}>
              <Check className="mr-1 size-4" />
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Autorização. */}
      <Dialog
        open={decisionId !== null}
        onOpenChange={(o) => !o && setDecisionId(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {decisionApprove ? "Autorizar conta" : "Recusar conta"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {decisionApprove
              ? "A conta passa a poder ser paga e a despesa entra na competência do mês."
              : "A conta fica registrada como recusada e não pode ser paga."}
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

      {/* Cancelamento. */}
      <Dialog open={cancelId !== null} onOpenChange={(o) => !o && setCancelId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar conta</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            A conta não é apagada: fica registrada como cancelada, com o motivo,
            e o lançamento de competência sai da DRE.
          </p>
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Ex.: nota cancelada pelo fornecedor; lançamento em duplicidade..."
            className="min-h-16 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCancelId(null)}>
              Voltar
            </Button>
            <Button disabled={isPending || !cancelReason.trim()} onClick={doCancel}>
              Cancelar conta
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
            <DialogTitle>Estornar pagamento</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            O pagamento não é apagado: fica no histórico com um estorno ao lado,
            e o saldo da conta volta.
          </p>
          <textarea
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
            placeholder="Ex.: pagamento em duplicidade; valor errado..."
            className="min-h-16 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReversingId(null)}>
              Cancelar
            </Button>
            <Button
              disabled={isPending || !reverseReason.trim()}
              onClick={doReverse}
            >
              Estornar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RecurrencesDialog
        open={recurrencesOpen}
        onOpenChange={setRecurrencesOpen}
        clinicId={clinicId}
        recurrences={recurrences}
        suppliers={suppliers}
        accounts={accounts}
        costCenters={costCenters}
        today={today}
        canEdit={canManage}
      />

      <ApprovalRulesDialog
        open={rulesOpen}
        onOpenChange={setRulesOpen}
        clinicId={clinicId}
        accounts={accounts}
        rules={rules}
        canConfigureNetwork={canConfigureNetworkRules}
      />
    </div>
  );
}
