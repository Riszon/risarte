"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  CircleDot,
  FileSignature,
  PartyPopper,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type CommercialRule,
  type PaymentMethod,
} from "@/lib/commercial";
import {
  DIRECT_SALE_STATUS_LABELS,
  type DirectSaleStatus,
} from "@/lib/direct-sale";
import {
  cancelDirectSale,
  closeDirectSaleStep,
  setDirectSaleConditions,
} from "./actions";

export type DirectSaleRow = {
  id: string;
  clinicId: string;
  clinicName: string | null;
  clientId: string | null;
  clientName: string | null;
  subtotalCents: number;
  discountCents: number;
  surchargeCents: number;
  finalCents: number;
  installments: number;
  paymentMethod: PaymentMethod | null;
  contractSigned: boolean;
  paymentIssued: boolean;
  paymentConfirmed: boolean;
  cancelled: boolean;
  status: DirectSaleStatus | "cancelada";
  attendanceDoneBefore: boolean;
  createdByName: string | null;
  createdAt: string;
  items: { description: string; quantity: number; finalCents: number }[];
  rule: CommercialRule;
  canClose: boolean;
  isManager: boolean;
};

const STATUS_STYLE: Record<DirectSaleStatus | "cancelada", string> = {
  aguardando_fechamento: "border-amber-300 bg-amber-50 text-amber-800",
  cobranca_emitida: "border-sky-300 bg-sky-50 text-sky-800",
  concluida: "border-emerald-300 bg-emerald-50 text-emerald-800",
  cancelada: "border-border bg-muted text-muted-foreground",
};
const STATUS_LABEL: Record<DirectSaleStatus | "cancelada", string> = {
  ...DIRECT_SALE_STATUS_LABELS,
  cancelada: "Cancelada",
};

export function VendaDiretaClient({
  sales,
  showExceptions,
}: {
  sales: DirectSaleRow[];
  showExceptions: boolean;
}) {
  const pending = sales.filter(
    (s) => !s.cancelled && s.status !== "concluida"
  );
  const done = sales.filter((s) => s.status === "concluida");
  const cancelled = sales.filter((s) => s.cancelled);
  const exceptions = sales.filter(
    (s) => s.attendanceDoneBefore && !s.cancelled
  );

  const totalConcluded = done.reduce((sum, s) => sum + s.finalCents, 0);

  return (
    <div className="space-y-4">
      {/* Resumo rápido. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Pendências" value={String(pending.length)} amber={pending.length > 0} />
        <Stat label="Concluídas" value={String(done.length)} />
        <Stat label="Total concluído" value={formatBRL(totalConcluded)} />
        <Stat label="Canceladas" value={String(cancelled.length)} />
      </div>

      {/* Painel de exceções (atendeu antes de vender). */}
      {showExceptions && exceptions.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-base text-amber-900">
              <TriangleAlert className="size-4" />
              Atendeu antes de vender ({exceptions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-xs text-muted-foreground">
              Estas vendas foram lançadas <strong>depois</strong> do atendimento.
              O certo é vender antes de atender — acompanhe para corrigir o fluxo
              da unidade.
            </p>
            <ul className="space-y-1 text-sm">
              {exceptions.map((s) => (
                <li key={s.id} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {s.clientName ?? "Cliente"}
                    {s.clinicName ? ` · ${s.clinicName}` : ""} ·{" "}
                    {new Date(s.createdAt).toLocaleDateString("pt-BR")}
                  </span>
                  <span className="tabular-nums">{formatBRL(s.finalCents)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <SaleList title="Aguardando / em fechamento" sales={pending} empty="Nenhuma venda pendente." />
      <SaleList title="Concluídas" sales={done} empty="Nenhuma venda concluída no período." collapsed />
      {cancelled.length > 0 && (
        <SaleList title="Canceladas" sales={cancelled} empty="" collapsed />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  amber,
}: {
  label: string;
  value: string;
  amber?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        amber && "border-amber-300 bg-amber-50"
      )}
    >
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function SaleList({
  title,
  sales,
  empty,
  collapsed = false,
}: {
  title: string;
  sales: DirectSaleRow[];
  empty: string;
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2"
        >
          <CardTitle className="text-base">
            {title} ({sales.length})
          </CardTitle>
          <ChevronDown
            className={cn("size-4 transition-transform", open && "rotate-180")}
          />
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-2">
          {sales.length === 0 ? (
            <p className="py-2 text-center text-sm text-muted-foreground">
              {empty}
            </p>
          ) : (
            sales.map((s) => <SaleItem key={s.id} sale={s} />)
          )}
        </CardContent>
      )}
    </Card>
  );
}

function SaleItem({ sale }: { sale: DirectSaleRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);

  const [method, setMethod] = useState<string>(sale.paymentMethod ?? "");
  const [installments, setInstallments] = useState(String(sale.installments));
  const [discount, setDiscount] = useState("");
  const [surcharge, setSurcharge] = useState("");

  const methods: PaymentMethod[] = useMemo(
    () => sale.rule.allowedMethods ?? [...PAYMENT_METHODS],
    [sale.rule.allowedMethods]
  );
  const maxInstallments = sale.rule.maxInstallments ?? 12;

  function saveConditions() {
    startTransition(async () => {
      const r = await setDirectSaleConditions(sale.id, {
        paymentMethod: method,
        installments: Number.parseInt(installments, 10) || 1,
        discountReais: discount,
        surchargeReais: surcharge,
      });
      if (r.ok) {
        toast.success("Condições salvas.");
        setDiscount("");
        setSurcharge("");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function step(
    which: "contract" | "payment_issued" | "payment_confirmed",
    value: boolean
  ) {
    startTransition(async () => {
      const r = await closeDirectSaleStep(sale.id, which, value);
      if (r.ok) {
        if (r.closed) toast.success("Venda direta CONCLUÍDA! 🎉");
        else toast.success("Fechamento atualizado.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function cancel() {
    startTransition(async () => {
      const r = await cancelDirectSale(sale.id);
      if (r.ok) {
        toast.success("Venda cancelada.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  const zero = sale.finalCents <= 0;

  return (
    <div className="rounded-lg border p-3 text-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
      >
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            {sale.clientName ?? "Cliente avulso"}
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                STATUS_STYLE[sale.status]
              )}
            >
              {STATUS_LABEL[sale.status]}
            </span>
            {sale.attendanceDoneBefore && (
              <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">
                exceção
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {sale.clinicName ? `${sale.clinicName} · ` : ""}
            {new Date(sale.createdAt).toLocaleDateString("pt-BR")}
            {sale.createdByName ? ` · por ${sale.createdByName}` : ""} ·{" "}
            {sale.items.length} proc.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold tabular-nums">
            {formatBRL(sale.finalCents)}
          </span>
          <ChevronDown
            className={cn("size-4 transition-transform", expanded && "rotate-180")}
          />
        </div>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 border-t pt-3">
          {/* Itens. */}
          <ul className="space-y-0.5 text-xs">
            {sale.items.map((i, idx) => (
              <li key={idx} className="flex justify-between">
                <span>
                  {i.description}
                  {i.quantity > 1 ? ` ×${i.quantity}` : ""}
                </span>
                <span className="tabular-nums">{formatBRL(i.finalCents)}</span>
              </li>
            ))}
          </ul>
          {sale.clientId && (
            <Link
              href={`/prontuarios/${sale.clientId}`}
              className="inline-block text-xs text-primary hover:underline"
            >
              Abrir prontuário →
            </Link>
          )}

          {sale.cancelled ? (
            <p className="text-xs text-muted-foreground">Venda cancelada.</p>
          ) : sale.status === "concluida" ? (
            <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-emerald-900">
              <PartyPopper className="size-4" />
              <span className="text-sm font-medium">
                Venda concluída — contrato assinado e pagamento confirmado.
              </span>
            </div>
          ) : !sale.canClose ? (
            <p className="flex items-center gap-1.5 rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
              <Wallet className="size-3.5" />
              Aguardando a recepção ou o gerente definir o pagamento e fechar.
            </p>
          ) : (
            <>
              {/* Condições de pagamento (só quem fecha). */}
              <div className="rounded-lg border bg-muted/20 p-2">
                <p className="mb-1.5 text-xs font-medium">Condições de pagamento</p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs">
                    <span className="text-muted-foreground">Forma</span>
                    <select
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                      className="mt-0.5 h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                    >
                      <option value="">Escolher...</option>
                      {methods.map((m) => (
                        <option key={m} value={m}>
                          {PAYMENT_METHOD_LABELS[m]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs">
                    <span className="text-muted-foreground">
                      Parcelas (máx. {maxInstallments})
                    </span>
                    <input
                      value={installments}
                      onChange={(e) => setInstallments(e.target.value)}
                      inputMode="numeric"
                      className="mt-0.5 h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="text-muted-foreground">
                      Desconto (R$){" "}
                      {sale.rule.maxDiscountPercent != null
                        ? `— máx ${sale.rule.maxDiscountPercent}%`
                        : "— não permitido"}
                    </span>
                    <input
                      value={discount}
                      onChange={(e) => setDiscount(e.target.value)}
                      inputMode="decimal"
                      placeholder="0,00"
                      className="mt-0.5 h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="text-muted-foreground">
                      Acréscimo (R$){sale.isManager ? "" : " — só Gerente"}
                    </span>
                    <input
                      value={surcharge}
                      onChange={(e) => setSurcharge(e.target.value)}
                      inputMode="decimal"
                      placeholder="0,00"
                      disabled={!sale.isManager}
                      className="mt-0.5 h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-50"
                    />
                  </label>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 text-xs"
                  disabled={isPending}
                  onClick={saveConditions}
                >
                  Salvar condições
                </Button>
              </div>

              {/* Fechamento (regra de ouro em dois passos). */}
              <div className="space-y-1.5">
                <p className="text-xs font-medium">
                  Fechamento (assinatura + pagamento)
                </p>
                <StepRow
                  icon={<FileSignature className="size-3.5" />}
                  label="Contrato assinado"
                  done={sale.contractSigned}
                  disabled={isPending}
                  onToggle={(v) => step("contract", v)}
                />
                <StepRow
                  icon={<Wallet className="size-3.5" />}
                  label={
                    zero
                      ? "Cobrança emitida (R$ 0 — já conta como pago)"
                      : "Cobrança emitida"
                  }
                  done={sale.paymentIssued}
                  disabled={isPending}
                  onToggle={(v) => step("payment_issued", v)}
                />
                {!zero && (
                  <StepRow
                    icon={<Wallet className="size-3.5" />}
                    label="Pagamento confirmado"
                    done={sale.paymentConfirmed}
                    disabled={isPending || !sale.paymentIssued}
                    onToggle={(v) => step("payment_confirmed", v)}
                  />
                )}
              </div>

              <button
                type="button"
                disabled={isPending}
                onClick={cancel}
                className="text-xs text-rose-600 hover:underline"
              >
                Cancelar venda
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StepRow({
  icon,
  label,
  done,
  disabled,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  done: boolean;
  disabled: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onToggle(!done)}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors disabled:opacity-50",
        done ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "hover:bg-muted"
      )}
    >
      {done ? (
        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
      ) : (
        <CircleDot className="size-4 shrink-0 text-muted-foreground" />
      )}
      {icon}
      <span className="flex-1 text-left">{label}</span>
      <span className="text-xs text-muted-foreground">
        {done ? "desmarcar" : "marcar"}
      </span>
    </button>
  );
}
