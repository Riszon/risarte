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
  Gift,
  PartyPopper,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
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
import { PaymentScheduleEditor } from "@/components/payment-schedule-editor";
import { buildSchedule, type ScheduleEntry } from "@/lib/payments";
import { savePaymentSchedule } from "../payment-schedule-actions";

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
  items: {
    /** Brinde do programa a entregar (ex.: escova nova). */
    giftLabel?: string | null;
    /** Aviso do programa neste item (ex.: benefício já usado / libera em ...). */
    benefitNote?: string | null;
    description: string;
    quantity: number;
    unitPriceCents: number;
    programDiscountCents: number;
    finalCents: number;
  }[];
  rule: CommercialRule;
  /** Condições do plano do cliente (PPR+) — acima da regra da unidade. */
  programConditions?: {
    planName: string;
    cashDiscountPercent: number;
    maxInstallments: number;
    minInstallmentCents: number;
    tiers: { upToInstallments: number; discountPercent: number }[];
  } | null;
  canClose: boolean;
  isManager: boolean;
  /** Cliente de programa com desconto automático → sem desconto manual (§7.5). */
  isProgramMember: boolean;
  /** Quem fez cada passo do fechamento (para o detalhe). */
  contractSignedByName: string | null;
  paymentConfirmedByName: string | null;
  /** I9: plano de cobrança (entrada + parcelas) já salvo. */
  schedule?: ScheduleEntry[];
  /** I9b: entrada já salva (para reabrir a tela no mesmo formato). */
  downPaymentCents?: number;
  /** I8: parcela mínima do meio escolhido (para validar o plano). */
  minInstallmentCents?: number | null;
};

type AdjustMode = "none" | "desc_reais" | "desc_pct" | "acresc";
/** I9b: formato do pagamento — uma escolha só. */
type PayMode = "avista" | "parcelado" | "entrada";

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
  // I9b: uma escolha só define o formato do pagamento.
  const initialPayMode: PayMode = (sale.schedule ?? []).some(
    (e) => e.kind === "entrada"
  )
    ? "entrada"
    : sale.installments > 1
      ? "parcelado"
      : "avista";
  const initialDownCents = sale.downPaymentCents ?? 0;
  const initialFirstDue =
    sale.schedule?.[0]?.dueDate ?? new Date().toISOString().slice(0, 10);
  const [payMode, setPayMode] = useState<PayMode>(initialPayMode);
  const [downReais, setDownReais] = useState(
    initialDownCents ? centsToInput(initialDownCents) : ""
  );
  const [firstDue, setFirstDue] = useState(initialFirstDue);
  const downCents =
    payMode === "entrada" ? (parseBRLToCents(downReais) ?? 0) : 0;
  // J4b: as cobranças vivem NA TELA (antes de salvar). O plano é DERIVADO das
  // condições; a personalização (ou o plano que veio salvo) fica guardada com a
  // "assinatura" das condições em que valia — mexer nas condições volta ao
  // plano automático, sem efeito colateral.
  const [custom, setCustom] = useState<{
    sig: string;
    entries: ScheduleEntry[];
  } | null>(
    (sale.schedule?.length ?? 0) > 0
      ? {
          sig: `${initialPayMode}|${initialDownCents}|${Math.max(1, sale.installments)}|${initialFirstDue}|${sale.finalCents}`,
          entries: sale.schedule ?? [],
        }
      : null
  );
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
  // Total a pagar antes do ajuste manual (já sem o benefício do programa).
  const payableCents = Math.max(0, sale.subtotalCents - sale.programDiscountCents);
  // Base do DESCONTO: procedimento que já tem benefício do plano não recebe
  // desconto de novo (decisão do dono, 25/07/2026).
  const coveredCents = sale.items
    .filter((i) => i.programDiscountCents > 0)
    .reduce((s, i) => s + i.finalCents, 0);
  const baseCents = Math.max(0, payableCents - coveredCents);
  const maxDiscountCents =
    sale.rule.maxDiscountPercent != null
      ? Math.round((baseCents * sale.rule.maxDiscountPercent) / 100)
      : null;

  // (a prévia do total fica mais abaixo — depois do % da faixa do plano.)

  // Condições definidas = forma de pagamento JÁ SALVA na venda. Sem isso não se
  // assina contrato nem se emite cobrança (regra do dono, 25/07/2026).
  const conditionsReady = Boolean(sale.paymentMethod);

  // Desconto do PLANO para o parcelamento escolhido (à vista usa o percentual
  // do plano; parcelado usa a faixa correspondente).
  const installmentsNum = Math.max(1, Number.parseInt(installments, 10) || 1);
  /** 1× (à vista) até o máximo liberado (plano ou unidade). */
  const installmentOptions = useMemo(
    () => Array.from({ length: Math.max(1, maxInstallments) }, (_, i) => i + 1),
    [maxInstallments]
  );
  // À VISTA = 1×, e só em PIX ou depósito (regra do dono, 26/07/2026).
  const isCash = installmentsNum === 1;
  const methodOptions = useMemo(
    () =>
      isCash
        ? methods.filter((m) => m === "pix" || m === "deposito_avista")
        : methods,
    [isCash, methods]
  );
  // Forma que não vale para o parcelamento atual simplesmente não conta.
  const effectiveMethod = methodOptions.includes(method as PaymentMethod)
    ? method
    : "";

  /** Faixas do plano em texto claro: "à vista 10% · 2× a 6× 15% · ...". */
  const tierLabels = useMemo(() => {
    const pc = sale.programConditions;
    if (!pc) return [] as string[];
    const sorted = [...pc.tiers].sort(
      (a, b) => a.upToInstallments - b.upToInstallments
    );
    const out: string[] = [`à vista (1×) ${pc.cashDiscountPercent}%`];
    let from = 2;
    for (const t of sorted) {
      if (t.upToInstallments < from) continue;
      out.push(
        from === t.upToInstallments
          ? `${from}× ${t.discountPercent}%`
          : `${from}× a ${t.upToInstallments}× ${t.discountPercent}%`
      );
      from = t.upToInstallments + 1;
    }
    if (from <= pc.maxInstallments) {
      out.push(
        from === pc.maxInstallments
          ? `${from}× sem desconto`
          : `${from}× a ${pc.maxInstallments}× sem desconto`
      );
    }
    return out;
  }, [sale.programConditions]);
  const programDiscountPercent = useMemo(() => {
    const pc = sale.programConditions;
    if (!pc) return 0;
    if (installmentsNum <= 1) return pc.cashDiscountPercent;
    const tier = [...pc.tiers]
      .sort((a, b) => a.upToInstallments - b.upToInstallments)
      .find((t) => installmentsNum <= t.upToInstallments);
    return tier ? tier.discountPercent : 0;
  }, [sale.programConditions, installmentsNum]);

  // Prévia ao vivo do novo total.
  // Cliente com PPR+: o desconto da faixa é AUTOMÁTICO — sempre recalculado
  // pelo parcelamento ESCOLHIDO AGORA (18× sem faixa = 0%). Nunca fica preso a
  // um valor gravado numa escolha anterior de parcelas (era o bug do R$ 222).
  const preview = useMemo(() => {
    if (sale.programConditions) {
      const discountCents = Math.round(
        (baseCents * programDiscountPercent) / 100
      );
      return {
        discountCents,
        surchargeCents: 0,
        final: Math.max(0, payableCents - discountCents),
      };
    }
    const num = Number((adjustValue || "0").replace(",", ".")) || 0;
    let discountCents = 0;
    let surchargeCents = 0;
    if (adjustMode === "desc_reais") discountCents = Math.round(num * 100);
    else if (adjustMode === "desc_pct")
      discountCents = Math.round((baseCents * num) / 100);
    else if (adjustMode === "acresc") surchargeCents = Math.round(num * 100);
    // O desconto sai do TOTAL a pagar, mas o percentual é calculado só sobre a
    // parte que ainda não tem benefício do plano.
    const final = Math.max(0, payableCents - discountCents + surchargeCents);
    return { discountCents, surchargeCents, final };
  }, [
    sale.programConditions,
    programDiscountPercent,
    adjustMode,
    adjustValue,
    baseCents,
    payableCents,
  ]);

  // As condições geram as cobranças AO VIVO — o dono vê o plano antes de salvar.
  const sig = `${payMode}|${downCents}|${installmentsNum}|${firstDue}|${preview.final}`;
  const autoSchedule = useMemo(
    () =>
      preview.final > 0
        ? buildSchedule({
            totalCents: preview.final,
            downPaymentCents: payMode === "entrada" ? downCents : 0,
            installments: payMode === "avista" ? 1 : installmentsNum,
            firstDueDate: firstDue,
          })
        : [],
    [preview.final, payMode, downCents, installmentsNum, firstDue]
  );
  // Plano exibido: o personalizado (enquanto as condições não mudaram) ou o
  // automático.
  const schedule = custom?.sig === sig ? custom.entries : autoSchedule;

  /**
   * J4b: UM botão só, e ele salva exatamente o que está na tela — condições +
   * as cobranças (personalizadas ou não).
   */
  function saveConditions() {
    startTransition(async () => {
      const r = await setDirectSaleConditions(sale.id, {
        paymentMethod: effectiveMethod,
        installments: installmentsNum,
        discountReais:
          preview.discountCents > 0 ? centsToInput(preview.discountCents) : "",
        surchargeReais:
          preview.surchargeCents > 0 ? centsToInput(preview.surchargeCents) : "",
      });
      if (!r.ok) {
        toast.error(r.error ?? "Algo deu errado.");
        return;
      }
      const s = await savePaymentSchedule({
        directSaleId: sale.id,
        entries: schedule.map((e, i) => ({ ...e, seq: i + 1 })),
      });
      if (s.ok) toast.success("Pagamento salvo.");
      else toast.warning(`Condições salvas. ${s.error ?? ""}`);
      router.refresh();
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
          {/* Itens: valor normal → desconto do programa → final. */}
          <ul className="space-y-0.5 text-xs">
            {sale.items.map((i, idx) => {
              const full = i.unitPriceCents * i.quantity;
              const hasProg = i.programDiscountCents > 0;
              return (
                <li key={idx} className="flex justify-between gap-2">
                  <span className="min-w-0">
                    {i.description}
                    {i.quantity > 1 ? ` ×${i.quantity}` : ""}
                    {hasProg && (
                      <span className="ml-1 text-gold">
                        ★ −{formatBRL(i.programDiscountCents)}
                      </span>
                    )}
                    {i.giftLabel && (
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-gold-foreground">
                        <Gift className="size-3" />
                        Entregar: {i.giftLabel}
                      </span>
                    )}
                    {i.benefitNote && (
                      <span className="mt-0.5 flex items-start gap-1 text-[11px] text-amber-800">
                        <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                        {i.benefitNote}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {hasProg && (
                      <span className="mr-1 text-muted-foreground line-through">
                        {formatBRL(full)}
                      </span>
                    )}
                    {formatBRL(i.finalCents)}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Resumo: programa + parcela. */}
          <div className="space-y-0.5 rounded-md bg-muted/40 px-2 py-1.5 text-xs">
            {sale.programDiscountCents > 0 && (
              <div className="flex justify-between text-gold">
                <span>★ Desconto do programa</span>
                <span className="tabular-nums">
                  − {formatBRL(sale.programDiscountCents)}
                </span>
              </div>
            )}
            {sale.discountCents > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Desconto</span>
                <span className="tabular-nums">
                  − {formatBRL(sale.discountCents)}
                </span>
              </div>
            )}
            {sale.surchargeCents > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Acréscimo</span>
                <span className="tabular-nums">
                  + {formatBRL(sale.surchargeCents)}
                </span>
              </div>
            )}
            <div className="flex justify-between font-medium">
              <span>Total</span>
              <span className="tabular-nums">{formatBRL(sale.finalCents)}</span>
            </div>
            {sale.installments > 1 && sale.finalCents > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Parcelamento</span>
                <span className="tabular-nums">
                  {sale.installments}× de{" "}
                  {formatBRL(Math.round(sale.finalCents / sale.installments))}
                </span>
              </div>
            )}
          </div>

          {/* Quem fez o fechamento (discreto). */}
          {(sale.contractSignedByName || sale.paymentConfirmedByName) && (
            <p className="text-[11px] text-muted-foreground">
              {sale.contractSignedByName &&
                `Contrato: ${sale.contractSignedByName}`}
              {sale.contractSignedByName && sale.paymentConfirmedByName
                ? " · "
                : ""}
              {sale.paymentConfirmedByName &&
                `Pagamento: ${sale.paymentConfirmedByName}`}
            </p>
          )}

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
              {/* Condições do plano do cliente — acima da regra da unidade. */}
              {sale.programConditions && (
                <div className="rounded-lg border border-gold/40 bg-gold/5 p-2 text-[11px]">
                  <p className="font-medium text-gold-foreground">
                    PPR+ {sale.programConditions.planName} — condições do plano
                  </p>
                  <p className="text-muted-foreground">
                    {tierLabels.join(" · ")}
                    {sale.programConditions.minInstallmentCents > 0 && (
                      <>
                        {" "}
                        · parcela mínima{" "}
                        {formatBRL(sale.programConditions.minInstallmentCents)}
                      </>
                    )}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2">
                    <span>
                      {isCash ? (
                        <>
                          <strong>À vista</strong>: o cliente tem direito a{" "}
                          <strong>{programDiscountPercent}%</strong>
                        </>
                      ) : (
                        <>
                          Em <strong>{installmentsNum}×</strong>, o cliente tem
                          direito a <strong>{programDiscountPercent}%</strong>
                        </>
                      )}
                      {coveredCents > 0 && (
                        <> sobre {formatBRL(baseCents)}</>
                      )}
                      .
                    </span>
                    <span className="rounded-full border border-gold/50 bg-gold/10 px-2 py-0.5 font-medium text-gold-foreground">
                      {programDiscountPercent > 0
                        ? `aplicado automaticamente: −${formatBRL(preview.discountCents)}`
                        : "sem desconto nesta quantidade de parcelas"}
                    </span>
                  </p>
                </div>
              )}

              <div className="rounded-lg border bg-muted/20 p-2">
                {/* I9b: UMA pergunta define o formato do pagamento — some a
                    contradição de escolher "à vista" e ter entrada embaixo. */}
                <p className="mb-1.5 text-xs font-medium">
                  Como o cliente vai pagar?
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["avista", "À vista"],
                      ["parcelado", "Parcelado"],
                      ["entrada", "Entrada + parcelas"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setPayMode(value);
                        if (value === "avista") setInstallments("1");
                        else if (installments === "1") setInstallments("2");
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        payMode === value
                          ? "border-primary bg-primary font-medium text-primary-foreground"
                          : "border-border hover:bg-muted"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {payMode === "entrada" && (
                    <label className="block text-xs">
                      <span className="text-muted-foreground">Entrada (R$)</span>
                      <input
                        value={downReais}
                        onChange={(e) => setDownReais(e.target.value)}
                        inputMode="decimal"
                        placeholder="0,00"
                        className="mt-0.5 h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                      />
                    </label>
                  )}
                  {payMode !== "avista" && (
                    <label className="block text-xs">
                      <span className="text-muted-foreground">
                        Parcelas (até {maxInstallments}×)
                      </span>
                      <select
                        value={installments}
                        onChange={(e) => setInstallments(e.target.value)}
                        className="mt-0.5 h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                      >
                        {installmentOptions
                          .filter((n) => n > 1)
                          .map((n) => (
                            <option key={n} value={String(n)}>
                              {n}×
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  <label className="block text-xs">
                    <span className="text-muted-foreground">
                      Forma de pagamento
                    </span>
                    <select
                      value={effectiveMethod}
                      onChange={(e) => setMethod(e.target.value)}
                      className="mt-0.5 h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                    >
                      <option value="">Escolher...</option>
                      {methodOptions.map((m) => (
                        <option key={m} value={m}>
                          {PAYMENT_METHOD_LABELS[m]}
                        </option>
                      ))}
                    </select>
                    {isCash && (
                      <span className="text-[11px] text-muted-foreground">
                        À vista só em PIX ou depósito.
                      </span>
                    )}
                  </label>
                  {payMode !== "avista" && (
                    <label className="block text-xs">
                      <span className="text-muted-foreground">
                        1º vencimento
                      </span>
                      <input
                        type="date"
                        value={firstDue}
                        onChange={(e) => setFirstDue(e.target.value)}
                        className="mt-0.5 h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                      />
                    </label>
                  )}
                </div>

                {/* Resumo do dinheiro: total cheio → descontos → final. */}
                <dl className="mt-2 space-y-0.5 rounded-md bg-background px-2 py-1.5 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">
                      Valor total (sem descontos)
                    </dt>
                    <dd className="tabular-nums">
                      {formatBRL(sale.subtotalCents)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">
                      Total de descontos
                      {sale.programDiscountCents > 0 && (
                        <span className="ml-1 text-gold">
                          (plano {formatBRL(sale.programDiscountCents)})
                        </span>
                      )}
                    </dt>
                    <dd className="tabular-nums text-gold">
                      −
                      {formatBRL(
                        sale.programDiscountCents + preview.discountCents
                      )}
                    </dd>
                  </div>
                  {preview.surchargeCents > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Acréscimo</dt>
                      <dd className="tabular-nums">
                        +{formatBRL(preview.surchargeCents)}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between border-t pt-0.5 font-semibold">
                    <dt>Valor final</dt>
                    <dd className="tabular-nums">{formatBRL(preview.final)}</dd>
                  </div>
                  {(preview.discountCents !== sale.discountCents ||
                    installmentsNum !== sale.installments ||
                    effectiveMethod !== (sale.paymentMethod ?? "")) && (
                    <p className="mt-1 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-1.5 text-[11px] text-amber-900">
                      <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                      <span>
                        <strong>Condições não salvas.</strong> O resumo do topo
                        ainda mostra {formatBRL(sale.finalCents)} — clique em{" "}
                        <strong>Salvar condições</strong> para valer.
                      </span>
                    </p>
                  )}
                  {payMode !== "avista" && (
                    <div className="flex justify-between text-muted-foreground">
                      <dt>Como fica</dt>
                      <dd className="tabular-nums">
                        {payMode === "entrada" && downCents > 0 && (
                          <>entrada {formatBRL(downCents)} + </>
                        )}
                        {installmentsNum}× de{" "}
                        {formatBRL(
                          Math.round(
                            Math.max(0, preview.final - downCents) /
                              installmentsNum
                          )
                        )}
                      </dd>
                    </div>
                  )}
                </dl>

                {/* Ajuste: UM controle (nenhum / desconto / acréscimo). */}
                {sale.isProgramMember ? (
                  <p className="mt-2 rounded-md border border-gold/40 bg-gold/5 p-1.5 text-[11px] text-gold-foreground">
                    ★ Cliente de programa — o desconto da faixa de parcelamento
                    é aplicado automaticamente conforme as parcelas escolhidas.
                    Sem desconto manual.
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
                          {coveredCents > 0 && (
                            <>
                              {" "}
                              — os procedimentos já cobertos pelo plano (
                              {formatBRL(coveredCents)}){" "}
                              <strong>não recebem desconto de novo</strong>.
                            </>
                          )}
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

                {/* J4b: as cobranças aparecem AO VIVO (antes de salvar) e
                    "Personalizar" edita ali mesmo — um único botão grava tudo. */}
                {preview.final > 0 && (
                  <div className="mt-2">
                    <PaymentScheduleEditor
                      entries={schedule}
                      onChange={(next) => setCustom({ sig, entries: next })}
                      totalCents={preview.final}
                      minInstallmentCents={sale.minInstallmentCents ?? null}
                    />
                  </div>
                )}

                <Button
                  size="sm"
                  className="mt-2 h-8 text-xs"
                  disabled={isPending || !effectiveMethod}
                  onClick={saveConditions}
                >
                  {isPending ? "Salvando…" : "Salvar pagamento"}
                </Button>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium">
                  Fechamento (assinatura + pagamento)
                </p>
                {/* Sem forma de pagamento definida não há o que assinar nem
                    cobrar (a trava também existe no banco). */}
                {!zero && !conditionsReady && (
                  <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Defina a <strong>forma de pagamento</strong> e o
                      parcelamento acima (e salve as condições) para liberar o
                      contrato e a cobrança.
                    </span>
                  </p>
                )}
                <StepRow
                  icon={<FileSignature className="size-3.5" />}
                  label="Contrato assinado"
                  done={sale.contractSigned}
                  disabled={isPending || (!zero && !conditionsReady)}
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
                  disabled={isPending || (!zero && !conditionsReady)}
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
