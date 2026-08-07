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
  automaticDiscountPercent,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
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
import { FlowSection } from "@/components/commercial/flow-section";
import { MoneySummary } from "@/components/commercial/money-summary";
import {
  PaymentFields,
  type PayMode,
} from "@/components/commercial/payment-fields";
import { buildSchedule, type ScheduleEntry } from "@/lib/payments";
import { savePaymentSchedule } from "../payment-schedule-actions";
import { todayInBrazil } from "@/lib/dates";

export type DirectSaleRow = {
  id: string;
  /** VD-00001 — nasce no fechamento e amarra as cobranças (FIN2.2). */
  code: string | null;
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
    sale.schedule?.[0]?.dueDate ?? todayInBrazil();
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
  // O desconto AUTOMÁTICO à vista é gravado no mesmo campo do manual. Ao
  // reabrir a venda não podemos relê-lo como manual: ele ficaria congelado e
  // seguiria valendo mesmo depois de trocar para parcelado, onde não vale.
  const savedAutoDiscountCents = (() => {
    if (sale.isProgramMember || sale.programConditions) return 0;
    const pct = automaticDiscountPercent(sale.rule, sale.installments);
    if (pct <= 0) return 0;
    return Math.round(
      (Math.max(0, sale.subtotalCents - sale.programDiscountCents) * pct) / 100
    );
  })();
  const savedManualDiscount =
    sale.discountCents > 0 && sale.discountCents !== savedAutoDiscountCents
      ? sale.discountCents
      : 0;

  // Ajuste como UM controle: nenhum / desconto R$ / desconto % / acréscimo R$.
  const initialMode: AdjustMode =
    savedManualDiscount > 0
      ? "desc_reais"
      : sale.surchargeCents > 0
        ? "acresc"
        : "none";
  const [adjustMode, setAdjustMode] = useState<AdjustMode>(initialMode);
  const [adjustValue, setAdjustValue] = useState<string>(
    savedManualDiscount > 0
      ? centsToInput(savedManualDiscount)
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
        autoPercent: programDiscountPercent,
        isAuto: discountCents > 0,
      };
    }
    const num = Number((adjustValue || "0").replace(",", ".")) || 0;
    let discountCents = 0;
    let surchargeCents = 0;
    if (adjustMode === "desc_reais") discountCents = Math.round(num * 100);
    else if (adjustMode === "desc_pct")
      discountCents = Math.round((baseCents * num) / 100);
    else if (adjustMode === "acresc") surchargeCents = Math.round(num * 100);

    // DESCONTO AUTOMÁTICO À VISTA da regra comercial. O servidor já aplicava
    // isso ao salvar; a tela não — e o resultado era o cabeçalho com um valor
    // e o painel com outro, sem explicação, e o plano de cobranças recusado
    // por não fechar com a venda (bug do dono, 05/08/2026).
    // O manual maior que o automático prevalece, igual ao servidor.
    const autoPercent = sale.isProgramMember
      ? 0
      : automaticDiscountPercent(sale.rule, installmentsNum);
    const autoCents =
      autoPercent > 0 ? Math.round((payableCents * autoPercent) / 100) : 0;
    const isAuto = autoCents > 0 && autoCents >= discountCents;
    discountCents = Math.max(discountCents, autoCents);

    const final = Math.max(0, payableCents - discountCents + surchargeCents);
    return { discountCents, surchargeCents, final, autoPercent, isAuto };
  }, [
    sale.programConditions,
    sale.isProgramMember,
    sale.rule,
    programDiscountPercent,
    adjustMode,
    adjustValue,
    baseCents,
    payableCents,
    installmentsNum,
  ]);

  /**
   * Venda fechada: o rodapé do resumo diz o parcelamento **e o meio de
   * pagamento**. Faltava o meio (achado do dono, 06/08/2026) — dava para ver
   * "2× de R$ 465,00" sem saber se era boleto, PIX ou cartão, que é justamente
   * o que muda taxa, prazo e risco do benefício.
   */
  const closedPaymentFooter =
    [
      sale.finalCents > 0
        ? sale.installments > 1
          ? `${sale.installments}× de ${formatBRL(
              Math.round(sale.finalCents / sale.installments)
            )}`
          : "À vista"
        : null,
      sale.paymentMethod ? PAYMENT_METHOD_LABELS[sale.paymentMethod] : null,
    ]
      .filter(Boolean)
      .join(" · ") || null;

  // J6: selo do passo 2 — o que está na tela ainda não foi gravado.
  const unsavedConditions =
    preview.discountCents !== sale.discountCents ||
    installmentsNum !== sale.installments ||
    effectiveMethod !== (sale.paymentMethod ?? "");

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
            {/* FIN2.2: o código da venda amarra o financeiro à venda. */}
            {sale.code && (
              <span className="rounded border border-border bg-muted/60 px-1 font-mono text-[10px] text-muted-foreground">
                {sale.code}
              </span>
            )}
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
        <div className="mt-3 space-y-4 border-t pt-3">
          {/* PASSO 1 — o que foi vendido. */}
          <FlowSection
            step={1}
            title="O que foi vendido"
            hint={`${sale.items.length} procedimento(s) lançado(s) na clínica`}
          >
            <ul className="space-y-1 text-xs">
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

            {showClientLink && sale.clientId && (
              <Link
                href={`/prontuarios/${sale.clientId}`}
                className="inline-block text-xs text-primary hover:underline"
              >
                Abrir prontuário →
              </Link>
            )}
          </FlowSection>

          {sale.cancelled || sale.status === "concluida" || !sale.canClose ? (
            <>
              {/* Fechado/cancelado/sem permissão: mostra o dinheiro COMO ESTÁ
                  salvo, sem campos de edição. */}
              <div className="pl-7">
                <MoneySummary
                  rows={[
                    { label: "Valor dos procedimentos", cents: sale.subtotalCents },
                    {
                      label: "Desconto do programa",
                      cents: sale.programDiscountCents,
                      tone: "program",
                    },
                    { label: "Desconto", cents: sale.discountCents, tone: "discount" },
                    {
                      label: "Acréscimo",
                      cents: sale.surchargeCents,
                      tone: "surcharge",
                    },
                  ]}
                  totalCents={sale.finalCents}
                  footer={closedPaymentFooter}
                />
              </div>
              {sale.cancelled ? (
                <p className="pl-7 text-xs text-muted-foreground">
                  Venda cancelada — os procedimentos dela foram cancelados no
                  prontuário.
                </p>
              ) : sale.status === "concluida" ? (
                <div className="ml-7 flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-2 text-emerald-900">
                  <PartyPopper className="size-4" />
                  <span className="text-sm font-medium">
                    Venda concluída — contrato assinado e pagamento confirmado.
                  </span>
                </div>
              ) : (
                <p className="ml-7 flex items-center gap-1.5 rounded-lg border bg-muted/40 p-2 text-xs text-muted-foreground">
                  <Wallet className="size-3.5" />
                  Aguardando a recepção ou o gerente definir o pagamento e
                  fechar.
                </p>
              )}
              {(sale.contractSignedByName || sale.paymentConfirmedByName) && (
                <p className="pl-7 text-[11px] text-muted-foreground">
                  {sale.contractSignedByName &&
                    `Contrato: ${sale.contractSignedByName}`}
                  {sale.contractSignedByName && sale.paymentConfirmedByName
                    ? " · "
                    : ""}
                  {sale.paymentConfirmedByName &&
                    `Pagamento: ${sale.paymentConfirmedByName}`}
                </p>
              )}
            </>
          ) : (
            <>
              {/* PASSO 2 — o pagamento. Uma pergunta, um resumo, um botão. */}
              <FlowSection
                step={2}
                title="Como o cliente vai pagar"
                hint="Escolha o formato: os campos e as cobranças se ajustam sozinhos"
                aside={
                  unsavedConditions ? (
                    <span className="flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                      <TriangleAlert className="size-3" />
                      não salvo
                    </span>
                  ) : conditionsReady ? (
                    <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                      salvo
                    </span>
                  ) : null
                }
              >
                {/* Condições do programa do cliente — acima da regra da unidade. */}
                {sale.programConditions && (
                  <div className="rounded-lg border border-gold/40 bg-gold/5 p-2 text-[11px]">
                    <p className="font-medium text-gold-foreground">
                      ★ PPR+ {sale.programConditions.planName}
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
                    <p className="mt-1">
                      {isCash ? "À vista" : `Em ${installmentsNum}×`}, o cliente
                      tem direito a{" "}
                      <strong>{programDiscountPercent}%</strong>
                      {coveredCents > 0 && <> sobre {formatBRL(baseCents)}</>} —{" "}
                      {programDiscountPercent > 0 ? (
                        <strong>
                          aplicado automaticamente (−
                          {formatBRL(preview.discountCents)})
                        </strong>
                      ) : (
                        "sem desconto nesta quantidade de parcelas"
                      )}
                      .
                    </p>
                  </div>
                )}

                <PaymentFields
                  payMode={payMode}
                  onPayModeChange={(mode) => {
                    setPayMode(mode);
                    if (mode === "avista") setInstallments("1");
                    else if (installments === "1") setInstallments("2");
                  }}
                  downReais={downReais}
                  onDownReaisChange={setDownReais}
                  installments={installments}
                  onInstallmentsChange={setInstallments}
                  maxInstallments={maxInstallments}
                  method={effectiveMethod as PaymentMethod | ""}
                  onMethodChange={(m) => setMethod(m)}
                  methodOptions={methodOptions}
                  firstDue={firstDue}
                  onFirstDueChange={setFirstDue}
                />

                {/* Ajuste manual — só para quem não tem desconto automático. */}
                {sale.isProgramMember ? (
                  <p className="rounded-lg border border-gold/40 bg-gold/5 p-2 text-[11px] text-gold-foreground">
                    ★ Cliente de programa — o desconto é automático conforme as
                    parcelas escolhidas. Sem desconto manual.
                  </p>
                ) : (
                  <div>
                    <span className="text-[11px] font-medium text-muted-foreground">
                      Ajuste
                    </span>
                    <div className="mt-0.5 flex gap-2">
                      <select
                        value={adjustMode}
                        onChange={(e) =>
                          setAdjustMode(e.target.value as AdjustMode)
                        }
                        className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
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
                          className="h-9 flex-1 rounded-lg border border-input bg-background px-2 text-sm"
                        />
                      )}
                    </div>
                    {(adjustMode === "desc_reais" ||
                      adjustMode === "desc_pct") &&
                      (maxDiscountCents != null ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Desconto máximo: {formatBRL(maxDiscountCents)} (
                          {sale.rule.maxDiscountPercent}% de{" "}
                          {formatBRL(baseCents)})
                          {coveredCents > 0 && (
                            <>
                              {" "}
                              — procedimentos já cobertos pelo plano (
                              {formatBRL(coveredCents)}){" "}
                              <strong>não recebem desconto de novo</strong>.
                            </>
                          )}
                        </p>
                      ) : (
                        <p className="mt-1 text-[11px] text-rose-700">
                          A rede não configurou desconto — não é permitido
                          desconto nesta unidade.
                        </p>
                      ))}

                    {/* O desconto automático precisa se explicar: era ele que
                        derrubava o total "sem motivo aparente". */}
                    {preview.isAuto && !sale.programConditions && (
                      <p className="mt-1 text-[11px] text-emerald-800">
                        À vista, a regra da unidade dá{" "}
                        <strong>{preview.autoPercent}% automático</strong> —{" "}
                        {formatBRL(preview.discountCents)} já estão no total
                        abaixo. Parcelando, esse desconto não vale.
                      </p>
                    )}
                  </div>
                )}

                {/* UM resumo do dinheiro. */}
                <MoneySummary
                  rows={[
                    {
                      label: "Valor dos procedimentos",
                      cents: sale.subtotalCents,
                    },
                    {
                      label: "Desconto do programa",
                      cents: sale.programDiscountCents,
                      tone: "program",
                    },
                    {
                      // O nome diz de ONDE vem o desconto — era o que faltava
                      // quando o total aparecia menor "sem explicação".
                      label: preview.isAuto
                        ? sale.programConditions
                          ? `Desconto do plano (${preview.autoPercent}%)`
                          : `Desconto à vista (${preview.autoPercent}%)`
                        : "Desconto",
                      cents: preview.discountCents,
                      tone: "discount",
                    },
                    {
                      label: "Acréscimo",
                      cents: preview.surchargeCents,
                      tone: "surcharge",
                    },
                  ]}
                  totalCents={preview.final}
                  footer={
                    payMode === "avista"
                      ? null
                      : `${
                          payMode === "entrada" && downCents > 0
                            ? `entrada ${formatBRL(downCents)} + `
                            : ""
                        }${installmentsNum}× de ${formatBRL(
                          Math.round(
                            Math.max(0, preview.final - downCents) /
                              installmentsNum
                          )
                        )}`
                  }
                />

                {/* Cobranças ao vivo (antes de salvar). */}
                {preview.final > 0 && (
                  <PaymentScheduleEditor
                    entries={schedule}
                    onChange={(next) => setCustom({ sig, entries: next })}
                    totalCents={preview.final}
                    minInstallmentCents={sale.minInstallmentCents ?? null}
                  />
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    className="h-9"
                    disabled={isPending || !effectiveMethod}
                    onClick={saveConditions}
                  >
                    {isPending ? "Salvando…" : "Salvar pagamento"}
                  </Button>
                  {unsavedConditions && (
                    <span className="text-[11px] text-muted-foreground">
                      O valor no topo do cartão só muda depois de salvar.
                    </span>
                  )}
                </div>
              </FlowSection>

              {/* PASSO 3 — fechamento. */}
              <FlowSection
                step={3}
                title="Fechamento"
                hint="Só é venda com documento assinado E pagamento confirmado"
              >
                {!zero && !conditionsReady && (
                  <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Salve o pagamento no passo 2 para liberar o contrato e a
                      cobrança.
                    </span>
                  </p>
                )}
                <div className="space-y-1.5">
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
              </FlowSection>

              {/* Ação destrutiva: discreta e no fim. */}
              <div className="border-t pt-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={cancel}
                  className="text-xs text-muted-foreground hover:text-rose-600 hover:underline"
                >
                  Cancelar venda
                </button>
              </div>
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
