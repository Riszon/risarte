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
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
  programDiscountCents: number;
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
  /** Cliente de programa com desconto automático → sem desconto manual (§7.5). */
  isProgramMember: boolean;
};

type AdjustMode = "none" | "desc_reais" | "desc_pct" | "acresc";

/** Centavos → "1234,56" para preencher o campo. */
function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export const DIRECT_SALE_STATUS_STYLE: Record<
  DirectSaleStatus | "cancelada",
  string
> = {
  aguardando_fechamento: "border-amber-300 bg-amber-50 text-amber-800",
  cobranca_emitida: "border-sky-300 bg-sky-50 text-sky-800",
  concluida: "border-emerald-300 bg-emerald-50 text-emerald-800",
  cancelada: "border-border bg-muted text-muted-foreground",
};
export const DIRECT_SALE_STATUS_LABEL: Record<
  DirectSaleStatus | "cancelada",
  string
> = {
  ...DIRECT_SALE_STATUS_LABELS,
  cancelada: "Cancelada",
};

export function SaleItem({
  sale,
  defaultExpanded = false,
  showClientLink = true,
}: {
  sale: DirectSaleRow;
  defaultExpanded?: boolean;
  showClientLink?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const [method, setMethod] = useState<string>(sale.paymentMethod ?? "");
  const [installments, setInstallments] = useState(String(sale.installments));
  // Ajuste como UM controle: nenhum / desconto R$ / desconto % / acréscimo R$.
  const initialMode: AdjustMode =
    sale.discountCents > 0
      ? "desc_reais"
      : sale.surchargeCents > 0
        ? "acresc"
        : "none";
  const [adjustMode, setAdjustMode] = useState<AdjustMode>(initialMode);
  const [adjustValue, setAdjustValue] = useState<string>(
    sale.discountCents > 0
      ? centsToInput(sale.discountCents)
      : sale.surchargeCents > 0
        ? centsToInput(sale.surchargeCents)
        : ""
  );

  const methods: PaymentMethod[] = useMemo(
    () => sale.rule.allowedMethods ?? [...PAYMENT_METHODS],
    [sale.rule.allowedMethods]
  );
  const maxInstallments = sale.rule.maxInstallments ?? 12;
  // Base do desconto = preço cheio já sem o benefício do programa.
  const baseCents = Math.max(0, sale.subtotalCents - sale.programDiscountCents);
  const maxDiscountCents =
    sale.rule.maxDiscountPercent != null
      ? Math.round((baseCents * sale.rule.maxDiscountPercent) / 100)
      : null;

  // Prévia ao vivo do novo total.
  const preview = useMemo(() => {
    const num = Number((adjustValue || "0").replace(",", ".")) || 0;
    let discountCents = 0;
    let surchargeCents = 0;
    if (adjustMode === "desc_reais") discountCents = Math.round(num * 100);
    else if (adjustMode === "desc_pct")
      discountCents = Math.round((baseCents * num) / 100);
    else if (adjustMode === "acresc") surchargeCents = Math.round(num * 100);
    const final = Math.max(0, baseCents - discountCents + surchargeCents);
    return { discountCents, surchargeCents, final };
  }, [adjustMode, adjustValue, baseCents]);

  function saveConditions() {
    startTransition(async () => {
      const r = await setDirectSaleConditions(sale.id, {
        paymentMethod: method,
        installments: Number.parseInt(installments, 10) || 1,
        discountReais:
          preview.discountCents > 0 ? centsToInput(preview.discountCents) : "",
        surchargeReais:
          preview.surchargeCents > 0 ? centsToInput(preview.surchargeCents) : "",
      });
      if (r.ok) {
        toast.success("Condições salvas.");
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
                DIRECT_SALE_STATUS_STYLE[sale.status]
              )}
            >
              {DIRECT_SALE_STATUS_LABEL[sale.status]}
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
            className={cn(
              "size-4 transition-transform",
              expanded && "rotate-180"
            )}
          />
        </div>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 border-t pt-3">
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
          {showClientLink && sale.clientId && (
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
              <div className="rounded-lg border bg-muted/20 p-2">
                <p className="mb-1.5 text-xs font-medium">
                  Condições de pagamento
                </p>
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
                </div>

                {/* Ajuste: UM controle (nenhum / desconto / acréscimo). */}
                {sale.isProgramMember ? (
                  <p className="mt-2 rounded-md border border-gold/40 bg-gold/5 p-1.5 text-[11px] text-gold-foreground">
                    ★ Cliente de programa — o desconto automático já foi
                    aplicado. Sem desconto manual.
                  </p>
                ) : (
                  <div className="mt-2">
                    <span className="text-xs text-muted-foreground">Ajuste</span>
                    <div className="mt-0.5 flex gap-2">
                      <select
                        value={adjustMode}
                        onChange={(e) =>
                          setAdjustMode(e.target.value as AdjustMode)
                        }
                        className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                      >
                        <option value="none">Sem ajuste</option>
                        <option value="desc_reais">Desconto (R$)</option>
                        <option value="desc_pct">Desconto (%)</option>
                        {sale.isManager && (
                          <option value="acresc">Acréscimo (R$)</option>
                        )}
                      </select>
                      {adjustMode !== "none" && (
                        <input
                          value={adjustValue}
                          onChange={(e) => setAdjustValue(e.target.value)}
                          inputMode="decimal"
                          placeholder={adjustMode === "desc_pct" ? "%" : "R$"}
                          className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
                        />
                      )}
                    </div>
                    {(adjustMode === "desc_reais" ||
                      adjustMode === "desc_pct") &&
                      maxDiscountCents != null && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Desconto máximo: {formatBRL(maxDiscountCents)} (
                          {sale.rule.maxDiscountPercent}% de{" "}
                          {formatBRL(baseCents)})
                        </p>
                      )}
                    {(adjustMode === "desc_reais" ||
                      adjustMode === "desc_pct") &&
                      maxDiscountCents == null && (
                        <p className="mt-1 text-[11px] text-rose-700">
                          A rede não configurou desconto — não é permitido
                          desconto nesta unidade.
                        </p>
                      )}
                  </div>
                )}

                {/* Prévia do novo total. */}
                <div className="mt-2 flex items-center justify-between rounded-md bg-background px-2 py-1 text-xs">
                  <span className="text-muted-foreground">Novo total</span>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatBRL(preview.final)}
                  </span>
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
        done
          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
          : "hover:bg-muted"
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
