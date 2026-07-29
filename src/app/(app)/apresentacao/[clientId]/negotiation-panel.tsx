"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  BadgePercent,
  CheckCircle2,
  CornerUpLeft,
  Handshake,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GutBadge } from "@/components/gut-badge";
import { PlanHistoryDialog } from "@/components/plan-history-dialog";
import type { PlanEvent } from "@/lib/planning";
import { sortByGutDesc } from "@/lib/gut";
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
import {
  NEGOTIATION_STATUS_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  automaticDiscountPercent,
  minInstallmentCentsFor,
  negotiationViolations,
  type CommercialRule,
  type NegotiationStatus,
  type PaymentMethod,
} from "@/lib/commercial";
import { buildSchedule, type ScheduleEntry } from "@/lib/payments";
import { PaymentScheduleEditor } from "@/components/payment-schedule-editor";
import { savePaymentSchedule } from "@/app/(app)/comercial/payment-schedule-actions";
import {
  acceptNegotiation,
  returnToPlanning,
  reviewNegotiationAction,
  savePlanNegotiation,
} from "./negotiation-actions";

export type NegotiationOption = {
  id: string;
  title: string;
  isPrimary: boolean;
  items: {
    id: string;
    description: string;
    quantity: number;
    unitPriceCents: number;
    /** Procedimento do catálogo — usado para saber se o plano já cobre. */
    procedureId?: string | null;
    gutGravity: number | null;
    gutUrgency: number | null;
    gutTendency: number | null;
  }[];
};

export type NegotiationData = {
  id: string;
  optionId: string;
  status: NegotiationStatus;
  adjustmentCents: number;
  paymentMethod: PaymentMethod | null;
  installments: number;
  partialReason: string | null;
  clientIsDecider: boolean | null;
  deciderNotes: string | null;
  notes: string | null;
  ruleViolations: string | null;
  ruleAuthorized: boolean;
  authorizationNote: string | null;
  finalCents: number;
  /** J1: entrada já salva (para reabrir a tela no mesmo formato). */
  downPaymentCents: number;
  /** J1: cobranças (entrada + parcelas) já gravadas. */
  schedule: ScheduleEntry[];
  excludedItemIds: string[];
};

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";
const inputClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

type AdjustMode = "none" | "discount_percent" | "discount_amount" | "surcharge";
/** J1: formato do pagamento — mesma pergunta da venda direta. */
type PayMode = "avista" | "parcelado" | "entrada";

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

const STATUS_PILL: Record<NegotiationStatus, string> = {
  em_negociacao: "border-primary/30 bg-primary/10 text-primary",
  aguardando_autorizacao: "border-amber-300 bg-amber-50 text-amber-800",
  aceita: "border-emerald-300 bg-emerald-50 text-emerald-800",
  devolvida: "border-border bg-muted text-muted-foreground",
  perdida: "border-rose-300 bg-rose-50 text-rose-800",
};

export function NegotiationPanel({
  clientId,
  planId,
  options,
  negotiation,
  rule,
  planEvents = [],
  canEdit,
  canAuthorize,
  programConditions = null,
}: {
  clientId: string;
  planId: string;
  options: NegotiationOption[];
  negotiation: NegotiationData | null;
  rule: CommercialRule;
  planEvents?: PlanEvent[];
  canEdit: boolean;
  canAuthorize: boolean;
  /** PPR5b: condições do programa do cliente (acima da regra da rede). */
  programConditions?: {
    label: string;
    cashDiscountPercent: number;
    maxInstallments: number;
    minInstallmentCents: number;
    tiers: { upToInstallments: number; discountPercent: number }[];
    coveredProcedureIds?: string[];
  } | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const primary = options.find((o) => o.isPrimary) ?? options[0] ?? null;
  const [optionId, setOptionId] = useState(
    negotiation?.optionId ?? primary?.id ?? ""
  );
  const option = options.find((o) => o.id === optionId) ?? primary;

  // Marcações POR PLANO (opção): trocar de plano não perde o que foi assinalado
  // nos outros — tudo acompanha o plano na devolução ao planejamento.
  const [excludedByOption, setExcludedByOption] = useState<
    Record<string, string[]>
  >(() => {
    const saved = new Set(negotiation?.excludedItemIds ?? []);
    const map: Record<string, string[]> = {};
    for (const o of options) {
      map[o.id] = o.items.filter((i) => saved.has(i.id)).map((i) => i.id);
    }
    return map;
  });
  const excluded = useMemo(
    () => new Set(excludedByOption[optionId] ?? []),
    [excludedByOption, optionId]
  );
  const initialMode: AdjustMode = !negotiation
    ? "none"
    : negotiation.adjustmentCents < 0
      ? "discount_amount"
      : negotiation.adjustmentCents > 0
        ? "surcharge"
        : "none";
  const [adjustMode, setAdjustMode] = useState<AdjustMode>(initialMode);
  const [adjustValue, setAdjustValue] = useState(
    negotiation && negotiation.adjustmentCents !== 0
      ? (Math.abs(negotiation.adjustmentCents) / 100).toFixed(2).replace(".", ",")
      : ""
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">(
    negotiation?.paymentMethod ?? ""
  );
  const [installments, setInstallments] = useState(
    String(negotiation?.installments ?? 1)
  );
  // J1: formato do pagamento (mesma pergunta da venda direta).
  const [payMode, setPayMode] = useState<PayMode>(
    (negotiation?.schedule ?? []).some((e) => e.kind === "entrada")
      ? "entrada"
      : (negotiation?.installments ?? 1) > 1
        ? "parcelado"
        : "avista"
  );
  const [downReais, setDownReais] = useState(
    negotiation?.downPaymentCents
      ? centsToInput(negotiation.downPaymentCents)
      : ""
  );
  const [firstDue, setFirstDue] = useState(
    negotiation?.schedule?.[0]?.dueDate ??
      new Date().toISOString().slice(0, 10)
  );
  const downCents =
    payMode === "entrada" ? (parseBRLToCents(downReais) ?? 0) : 0;
  const [partialReason, setPartialReason] = useState(
    negotiation?.partialReason ?? ""
  );
  const [decider, setDecider] = useState<"" | "sim" | "nao">(
    negotiation?.clientIsDecider === true
      ? "sim"
      : negotiation?.clientIsDecider === false
        ? "nao"
        : ""
  );
  const [deciderNotes, setDeciderNotes] = useState(
    negotiation?.deciderNotes ?? ""
  );
  const [notes, setNotes] = useState(negotiation?.notes ?? "");
  const [returnOpen, setReturnOpen] = useState(false);
  const [considerations, setConsiderations] = useState("");
  const [authNote, setAuthNote] = useState("");

  const status = negotiation?.status ?? null;
  // "devolvida" NÃO trava: se o painel está aberto, o cliente voltou à Fase 4
  // (replanejamento concluído) — o Consultor edita e salva a NOVA rodada.
  const locked = status === "aceita" || !canEdit;

  function toggleItem(id: string) {
    if (locked) return;
    setExcludedByOption((prev) => {
      const cur = new Set(prev[optionId] ?? []);
      if (cur.has(id)) cur.delete(id);
      else cur.add(id);
      return { ...prev, [optionId]: [...cur] };
    });
  }

  // Todos os itens/exclusões de TODAS as opções (vão juntos ao salvar/devolver).
  const allItemIds = useMemo(
    () => options.flatMap((o) => o.items.map((i) => i.id)),
    [options]
  );
  const allExcludedIds = useMemo(
    () => Object.values(excludedByOption).flat(),
    [excludedByOption]
  );

  // Totais ao vivo.
  const subtotalCents = useMemo(() => {
    if (!option) return 0;
    return option.items
      .filter((i) => !excluded.has(i.id))
      .reduce((s, i) => s + i.quantity * i.unitPriceCents, 0);
  }, [option, excluded]);

  // Base do DESCONTO: procedimento que o plano já cobre não recebe desconto de
  // novo (decisão do dono, 25/07/2026).
  const coveredCents = useMemo(() => {
    if (!option || !programConditions?.coveredProcedureIds?.length) return 0;
    const covered = new Set(programConditions.coveredProcedureIds);
    return option.items
      .filter((i) => !excluded.has(i.id))
      .filter((i) => i.procedureId && covered.has(i.procedureId))
      .reduce((s, i) => s + i.quantity * i.unitPriceCents, 0);
  }, [option, excluded, programConditions]);
  const discountBaseCents = Math.max(0, subtotalCents - coveredCents);

  const adjustmentCents = useMemo(() => {
    if (adjustMode === "none") return 0;
    if (adjustMode === "discount_percent") {
      const pct = Number(adjustValue.replace(",", "."));
      if (!Number.isFinite(pct) || pct <= 0) return 0;
      return -Math.round((discountBaseCents * pct) / 100);
    }
    const cents = parseBRLToCents(adjustValue) ?? 0;
    return adjustMode === "discount_amount" ? -cents : cents;
  }, [adjustMode, adjustValue, discountBaseCents]);

  const installmentsNum = Math.max(1, Number.parseInt(installments, 10) || 1);

  // J1: desconto AUTOMÁTICO à vista da regra comercial (cliente SEM programa —
  // quem tem programa usa a faixa dele). Parcelado não tem desconto automático;
  // se o consultor der um desconto manual MAIOR, o manual prevalece.
  const autoPct = !programConditions
    ? automaticDiscountPercent(rule, installmentsNum)
    : 0;
  const autoCents = Math.round((discountBaseCents * autoPct) / 100);
  const effectiveAdjustmentCents =
    adjustMode === "surcharge"
      ? adjustmentCents
      : Math.min(adjustmentCents, -autoCents);
  const autoApplied =
    autoCents > 0 && effectiveAdjustmentCents === -autoCents;

  const finalCents = subtotalCents + effectiveAdjustmentCents;

  // J3: o Empresarial dá benefício POR PROCEDIMENTO (sem condições próprias de
  // pagamento) — o selo aparece, mas as faixas/desconto do programa não.
  const programHasTerms =
    !!programConditions &&
    (programConditions.maxInstallments > 0 ||
      programConditions.cashDiscountPercent > 0 ||
      programConditions.tiers.length > 0);

  // PPR5b: desconto que o PROGRAMA do cliente garante para a forma de pagamento
  // escolhida — à vista usa o percentual do plano, parcelado usa a faixa.
  const programDiscountPercent = useMemo(() => {
    if (!programConditions) return 0;
    if (installmentsNum <= 1) return programConditions.cashDiscountPercent;
    const tier = [...programConditions.tiers]
      .sort((a, b) => a.upToInstallments - b.upToInstallments)
      .find((t) => installmentsNum <= t.upToInstallments);
    return tier ? tier.discountPercent : 0;
  }, [programConditions, installmentsNum]);
  const programApplied =
    programDiscountPercent > 0 &&
    adjustMode === "discount_percent" &&
    Number(adjustValue.replace(",", ".")) === programDiscountPercent;

  // Parcelas viram SELETOR: 1× (à vista) até o máximo liberado (plano/unidade).
  const maxInstallmentsAllowed = Math.max(
    1,
    rule.maxInstallments ??
      (programConditions && programConditions.maxInstallments > 0
        ? programConditions.maxInstallments
        : 18)
  );
  const installmentOptions = useMemo(
    () =>
      Array.from({ length: maxInstallmentsAllowed }, (_, i) => i + 1),
    [maxInstallmentsAllowed]
  );
  // À VISTA = 1×, e só em PIX ou depósito (regra do dono, 26/07/2026).
  const isCash = installmentsNum === 1;
  const methodOptions = useMemo(() => {
    const allowed = rule.allowedMethods ?? [...PAYMENT_METHODS];
    return isCash
      ? allowed.filter((m) => m === "pix" || m === "deposito_avista")
      : allowed;
  }, [isCash, rule.allowedMethods]);
  // Sem efeito colateral: a forma escolhida que não vale para o parcelamento
  // atual simplesmente "não conta" (o seletor volta para "Escolher...").
  const effectiveMethod: PaymentMethod | "" =
    paymentMethod && methodOptions.includes(paymentMethod) ? paymentMethod : "";

  /** Faixas do plano em texto claro (evita confundir com o "à vista"). */
  const tierLabels = useMemo(() => {
    if (!programConditions || !programHasTerms) return [] as string[];
    const sorted = [...programConditions.tiers].sort(
      (a, b) => a.upToInstallments - b.upToInstallments
    );
    const out = [`à vista (1×) ${programConditions.cashDiscountPercent}%`];
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
    if (from <= programConditions.maxInstallments) {
      out.push(
        from === programConditions.maxInstallments
          ? `${from}× sem desconto`
          : `${from}× a ${programConditions.maxInstallments}× sem desconto`
      );
    }
    return out;
  }, [programConditions, programHasTerms]);
  const isPartial = option
    ? option.items.some((i) => excluded.has(i.id))
    : false;

  // Pré-checagem da regra (o servidor revalida sempre).
  const liveViolations = useMemo(
    () =>
      negotiationViolations(
        {
          subtotalCents,
          adjustmentCents: effectiveAdjustmentCents,
          installments: installmentsNum,
          paymentMethod: effectiveMethod || null,
        },
        rule
      ),
    [
      subtotalCents,
      effectiveAdjustmentCents,
      installmentsNum,
      effectiveMethod,
      rule,
    ]
  );

  // J1: parcela mínima das cobranças — a maior entre a do meio de pagamento e a
  // do programa do cliente (quando houver).
  const minInstallmentCents = (() => {
    const ruleMin = minInstallmentCentsFor(rule, effectiveMethod || null) ?? 0;
    const programMin = programConditions?.minInstallmentCents ?? 0;
    const min = Math.max(ruleMin, programMin);
    return min > 0 ? min : null;
  })();

  function save() {
    if (!option) return;
    startTransition(async () => {
      const r = await savePlanNegotiation(clientId, {
        planId,
        optionId: option.id,
        allItemIds,
        excludedItemIds: allExcludedIds,
        adjustmentCents: effectiveAdjustmentCents,
        paymentMethod: effectiveMethod || null,
        installments: installmentsNum,
        partialReason,
        clientIsDecider: decider === "" ? null : decider === "sim",
        deciderNotes,
        notes,
      });
      if (!r.ok) {
        toast.error(r.error ?? "Algo deu errado.");
        return;
      }
      // J1: no mesmo clique, gera e grava as cobranças (entrada + parcelas) —
      // igual à venda direta, um botão só.
      if (r.negotiationId && finalCents > 0) {
        const entries = buildSchedule({
          totalCents: finalCents,
          downPaymentCents: downCents,
          installments: payMode === "avista" ? 1 : installmentsNum,
          firstDueDate: firstDue,
        });
        const s = await savePaymentSchedule({
          negotiationId: r.negotiationId,
          entries,
        });
        if (!s.ok) {
          toast.warning(`Negociação salva. ${s.error ?? ""}`);
          router.refresh();
          return;
        }
      }
      if (r.violations && r.violations.length > 0) {
        toast.warning(
          "Fora da regra comercial — enviado ao Gerente da unidade para autorização."
        );
      } else {
        toast.success("Negociação salva.");
      }
      router.refresh();
    });
  }

  function accept() {
    if (!negotiation) return;
    startTransition(async () => {
      const r = await acceptNegotiation(clientId, negotiation.id);
      if (r.ok) {
        toast.success(
          "Aceite registrado! O Assistente Comercial foi avisado para o fechamento."
        );
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function review(approve: boolean) {
    if (!negotiation) return;
    startTransition(async () => {
      const r = await reviewNegotiationAction(
        clientId,
        negotiation.id,
        approve,
        authNote
      );
      if (r.ok) {
        toast.success(approve ? "Negociação autorizada." : "Autorização negada.");
        setAuthNote("");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function doReturn() {
    startTransition(async () => {
      // 1º) Salva a negociação como está (os procedimentos assinalados/excluídos
      // acompanham o plano — não se perdem na devolução).
      if (canEdit && option && status !== "aceita") {
        const saved = await savePlanNegotiation(clientId, {
          planId,
          optionId: option.id,
          allItemIds,
          excludedItemIds: allExcludedIds,
          adjustmentCents: effectiveAdjustmentCents,
          paymentMethod: effectiveMethod || null,
          installments: installmentsNum,
          partialReason,
          clientIsDecider: decider === "" ? null : decider === "sim",
          deciderNotes,
          notes,
        });
        if (!saved.ok) {
          toast.error(saved.error ?? "Não foi possível salvar a negociação.");
          return;
        }
      }
      // 2º) Devolve com as considerações obrigatórias.
      const r = await returnToPlanning(clientId, considerations);
      if (r.ok) {
        toast.success("Devolvido ao Centro de Planejamento com suas considerações.");
        setReturnOpen(false);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  if (!option) return null;

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5 text-base">
            <Handshake className="size-4" />
            Negociação
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {/* Histórico do plano — o Consultor e o Gerente entendem o caminho
                do plano (quem criou/aprovou/devolveu) antes de decidir. */}
            <PlanHistoryDialog events={planEvents} />
            {status && (
              <span
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                  STATUS_PILL[status]
                )}
              >
                {NEGOTIATION_STATUS_LABELS[status]}
              </span>
            )}
          </div>
        </div>
        {/* Regra comercial vigente. */}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <BadgePercent className="size-3.5" />
          Regra da unidade:
          <span>
            desconto máx.{" "}
            {rule.maxDiscountPercent != null
              ? `${rule.maxDiscountPercent}%`
              : "sem limite"}
          </span>
          <span>
            parcelas máx.{" "}
            {rule.maxInstallments != null ? `${rule.maxInstallments}x` : "sem limite"}
          </span>
          <span>
            meios:{" "}
            {rule.allowedMethods
              ? rule.allowedMethods.map((m) => PAYMENT_METHOD_LABELS[m]).join(", ")
              : "todos"}
          </span>
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Autorização pendente — caixa do Gerente. */}
        {status === "aguardando_autorizacao" && (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
              <ShieldAlert className="size-4" />
              Fora da regra comercial — aguardando autorização do Gerente
            </p>
            {negotiation?.ruleViolations && (
              <p className="text-xs text-amber-900">{negotiation.ruleViolations}</p>
            )}
            {canAuthorize && (
              <div className="space-y-2 border-t border-amber-200 pt-2">
                <textarea
                  value={authNote}
                  onChange={(e) => setAuthNote(e.target.value)}
                  placeholder="Observação (obrigatória ao negar)..."
                  className="min-h-16 w-full rounded-lg border border-input bg-white p-2 text-sm"
                />
                <div className="flex gap-2">
                  <Button size="sm" disabled={isPending} onClick={() => review(true)}>
                    Autorizar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => review(false)}
                  >
                    Negar
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Nova rodada após a devolução (replanejamento concluído). */}
        {status === "devolvida" && canEdit && (
          <p className="flex items-start gap-1.5 rounded-md border border-primary/30 bg-primary/5 p-2 text-xs">
            <CornerUpLeft className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>
              <strong>Nova rodada de negociação:</strong> a anterior foi
              devolvida ao Centro de Planejamento e o plano foi reaprovado.
              Revise os procedimentos e as condições e <strong>salve</strong> —
              o aceite só fica disponível depois de salvar.
            </span>
          </p>
        )}

        {/* Resposta do Gerente (última decisão). */}
        {status === "em_negociacao" && negotiation?.authorizationNote && (
          <p className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
            Observação do Gerente: {negotiation.authorizationNote}
          </p>
        )}

        {/* Escolha do plano (principal × secundários aprovados). */}
        {options.length > 1 && (
          <label className="block text-sm">
            <span className="text-xs text-muted-foreground">
              Plano em negociação (secundários são a carta na manga):
            </span>
            <select
              value={optionId}
              onChange={(e) => setOptionId(e.target.value)}
              disabled={locked}
              className={cn(selectClass, "w-full")}
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.isPrimary ? "★ Principal — " : "Secundário — "}
                  {o.title}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* Procedimentos: desmarcar = cliente NÃO aprovou (aprovação parcial). */}
        <div>
          <p className="mb-1 text-xs text-muted-foreground">
            Procedimentos em ordem de prioridade (matriz GUT) — desmarque o que
            o cliente NÃO aprovou. As marcações feitas em outros planos deste
            cliente são preservadas ao trocar de plano.
          </p>
          <ul className="space-y-1">
            {sortByGutDesc(option.items).map((i) => {
              const out = excluded.has(i.id);
              return (
                <li
                  key={i.id}
                  className={cn(
                    "flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm",
                    out && "border-rose-200 bg-rose-50/60"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={!out}
                    onChange={() => toggleItem(i.id)}
                    disabled={locked}
                    aria-label={`Incluir ${i.description}`}
                  />
                  <span className={cn("min-w-0 flex-1", out && "line-through opacity-70")}>
                    {i.description}
                    {i.quantity > 1 ? ` ×${i.quantity}` : ""}
                  </span>
                  <GutBadge item={i} />
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatBRL(i.quantity * i.unitPriceCents)}
                  </span>
                </li>
              );
            })}
          </ul>
          {isPartial && (
            <div className="mt-2">
              <label className="block text-xs font-medium text-rose-700">
                Motivo da aprovação parcial (obrigatório):
              </label>
              <textarea
                value={partialReason}
                onChange={(e) => setPartialReason(e.target.value)}
                disabled={locked}
                placeholder="Ex.: cliente optou por fazer primeiro os procedimentos prioritários por questões financeiras..."
                className="mt-1 min-h-16 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
              />
            </div>
          )}
        </div>

        {/* PPR5b/J3: condições do programa do cliente — acima da regra da
            rede. Empresarial (benefício por procedimento) mostra só o selo e a
            trava do desconto. */}
        {programConditions && !programHasTerms && (
          <div className="rounded-lg border border-gold/40 bg-gold/5 p-3 text-xs">
            <p className="font-medium text-gold-foreground">
              {programConditions.label} — cliente do programa
            </p>
            <p className="mt-0.5 text-muted-foreground">
              Os benefícios do programa são por procedimento e já entram no
              orçamento.
              {coveredCents > 0 && (
                <>
                  {" "}
                  Procedimentos cobertos ({formatBRL(coveredCents)}){" "}
                  <strong>não recebem desconto de novo</strong> — descontos
                  valem só sobre {formatBRL(discountBaseCents)}.
                </>
              )}
            </p>
          </div>
        )}
        {programConditions && programHasTerms && (
          <div className="rounded-lg border border-gold/40 bg-gold/5 p-3 text-xs">
            <p className="font-medium text-gold-foreground">
              {programConditions.label} — condições do programa
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {tierLabels.join(" · ")}
              {programConditions.minInstallmentCents > 0 && (
                <> · parcela mínima {formatBRL(programConditions.minInstallmentCents)}</>
              )}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-2">
              <span>
                {isCash ? (
                  <>
                    <strong>À vista</strong>, o cliente tem direito a{" "}
                  </>
                ) : (
                  <>
                    Em <strong>{installmentsNum}×</strong>, o cliente tem direito
                    a{" "}
                  </>
                )}
                <strong>{programDiscountPercent}%</strong> de desconto
                {coveredCents > 0 && (
                  <>
                    {" "}
                    sobre <strong>{formatBRL(discountBaseCents)}</strong> — os
                    procedimentos já cobertos pelo plano (
                    {formatBRL(coveredCents)}) não recebem desconto de novo
                  </>
                )}
                .
              </span>
              {!locked && programDiscountPercent > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setAdjustMode("discount_percent");
                    setAdjustValue(String(programDiscountPercent));
                  }}
                  className={cn(
                    "rounded-full border px-2 py-0.5 font-medium transition-colors",
                    programApplied
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-gold bg-gold text-gold-foreground"
                  )}
                >
                  {programApplied ? "desconto aplicado ✓" : "aplicar desconto"}
                </button>
              )}
            </p>
            {/* Mudou as parcelas depois de aplicar? O % antigo deixa de valer. */}
            {adjustMode === "discount_percent" &&
              Number(adjustValue.replace(",", ".")) > programDiscountPercent && (
                <p className="mt-1 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-1.5 text-[11px] text-amber-900">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    O desconto aplicado (
                    {Number(adjustValue.replace(",", "."))}%) é{" "}
                    <strong>maior que o da faixa de {installmentsNum}×</strong> (
                    {programDiscountPercent}%). Clique em &quot;aplicar
                    desconto&quot; para corrigir — ou a negociação vai para
                    autorização do Gerente.
                  </span>
                </p>
              )}
          </div>
        )}

        {/* J1: UMA pergunta define o formato do pagamento (igual à venda
            direta) — os campos aparecem conforme a escolha. */}
        <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
          <p className="text-xs font-medium">Como o cliente vai pagar?</p>
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
                disabled={locked}
                onClick={() => {
                  setPayMode(value);
                  if (value === "avista") setInstallments("1");
                  else if (installments === "1") setInstallments("2");
                }}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  payMode === value
                    ? "border-primary bg-primary font-medium text-primary-foreground"
                    : "border-border hover:bg-muted",
                  locked && "opacity-60"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {payMode === "entrada" && (
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">
                  Entrada (R$)
                </span>
                <input
                  value={downReais}
                  onChange={(e) => setDownReais(e.target.value)}
                  disabled={locked}
                  inputMode="decimal"
                  placeholder="0,00"
                  className={inputClass}
                />
              </label>
            )}
            {payMode !== "avista" && (
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">
                  Parcelas (até {maxInstallmentsAllowed}×)
                </span>
                <select
                  value={installments}
                  onChange={(e) => setInstallments(e.target.value)}
                  disabled={locked}
                  className={cn(selectClass, "w-full")}
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
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">
                Pagamento{isCash ? " (à vista)" : ""}
              </span>
              <select
                value={effectiveMethod}
                onChange={(e) =>
                  setPaymentMethod(e.target.value as PaymentMethod | "")
                }
                disabled={locked}
                className={cn(selectClass, "w-full")}
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
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">
                  1º vencimento
                </span>
                <input
                  type="date"
                  value={firstDue}
                  onChange={(e) => setFirstDue(e.target.value)}
                  disabled={locked}
                  className={inputClass}
                />
              </label>
            )}
          </div>

          {/* Ajuste manual (desconto/acréscimo) — dentro do teto da unidade. */}
          <label className="block text-sm">
            <span className="text-xs text-muted-foreground">Ajuste</span>
            <div className="flex gap-2">
              <select
                value={adjustMode}
                onChange={(e) => setAdjustMode(e.target.value as AdjustMode)}
                disabled={locked}
                className={selectClass}
              >
                <option value="none">Sem ajuste</option>
                <option value="discount_percent">Desconto (%)</option>
                <option value="discount_amount">Desconto (R$)</option>
                <option value="surcharge">Acréscimo (R$)</option>
              </select>
              {adjustMode !== "none" && (
                <input
                  value={adjustValue}
                  onChange={(e) => setAdjustValue(e.target.value)}
                  disabled={locked}
                  inputMode="decimal"
                  placeholder={adjustMode === "discount_percent" ? "%" : "R$"}
                  className={cn(inputClass, "flex-1")}
                />
              )}
            </div>
          </label>

          {/* J1: à vista com desconto automático da regra comercial. */}
          {autoApplied && (
            <p className="rounded-md border border-emerald-300 bg-emerald-50 p-1.5 text-[11px] text-emerald-900">
              Desconto automático à vista ({autoPct}%):{" "}
              <strong>−{formatBRL(autoCents)}</strong> — já aplicado no total.
            </p>
          )}
        </div>

        {/* Principal decisor. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-xs text-muted-foreground">
              O cliente é o principal decisor?
            </span>
            <select
              value={decider}
              onChange={(e) => setDecider(e.target.value as "" | "sim" | "nao")}
              disabled={locked}
              className={cn(selectClass, "w-full")}
            >
              <option value="">Não informado</option>
              <option value="sim">Sim</option>
              <option value="nao">Não</option>
            </select>
          </label>
          {decider === "nao" && (
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">
                Quem decide? (nome/relação)
              </span>
              <input
                value={deciderNotes}
                onChange={(e) => setDeciderNotes(e.target.value)}
                disabled={locked}
                className={inputClass}
              />
            </label>
          )}
        </div>

        {/* Observações do consultor. */}
        <label className="block text-sm">
          <span className="text-xs text-muted-foreground">
            Observações da negociação
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={locked}
            className="mt-1 min-h-14 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
          />
        </label>

        {/* Totais. */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            Subtotal {formatBRL(subtotalCents)}
            {effectiveAdjustmentCents !== 0 && (
              <>
                {" "}
                · {effectiveAdjustmentCents < 0 ? "desconto" : "acréscimo"}{" "}
                {formatBRL(Math.abs(effectiveAdjustmentCents))}
              </>
            )}
            {payMode !== "avista" && finalCents > 0 && (
              <>
                {" "}
                · como fica:{" "}
                {payMode === "entrada" && downCents > 0 && (
                  <>entrada {formatBRL(downCents)} + </>
                )}
                {installmentsNum}× de{" "}
                {formatBRL(
                  Math.round(
                    Math.max(0, finalCents - downCents) / installmentsNum
                  )
                )}
              </>
            )}
          </span>
          <span className="text-base font-semibold">{formatBRL(finalCents)}</span>
        </div>

        {/* J1: cobranças já salvas, em leitura — "Personalizar" edita data e
            valor (editar uma recalcula as seguintes). */}
        {negotiation &&
          negotiation.finalCents > 0 &&
          (negotiation.schedule?.length ?? 0) > 0 && (
            <PaymentScheduleEditor
              negotiationId={negotiation.id}
              totalCents={negotiation.finalCents}
              minInstallmentCents={minInstallmentCents}
              initial={negotiation.schedule}
              downPaymentCents={negotiation.downPaymentCents}
              installments={negotiation.installments}
              readOnly={locked}
            />
          )}

        {/* Aviso ao consultor: fora da regra (antes mesmo de salvar). */}
        {!locked && liveViolations.length > 0 && (
          <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Fora da regra comercial: {liveViolations.join("; ")}. Ao salvar, o
              Gerente da unidade será acionado para autorizar.
            </span>
          </p>
        )}

        {/* Ações. */}
        {status === "aceita" ? (
          <p className="flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-800">
            <CheckCircle2 className="size-4" />
            Cliente aceitou — aguardando o fechamento pelo Assistente Comercial
            (contrato + pagamento).
          </p>
        ) : (
          canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={isPending} onClick={save}>
                Salvar negociação
              </Button>
              {negotiation && (
                <Button
                  variant="outline"
                  disabled={
                    isPending ||
                    status === "aguardando_autorizacao" ||
                    status === "devolvida"
                  }
                  onClick={accept}
                >
                  <CheckCircle2 className="mr-1 size-4" />
                  Cliente aceitou
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={isPending}
                onClick={() => setReturnOpen(true)}
              >
                <CornerUpLeft className="mr-1 size-4" />
                Devolver ao planejamento
              </Button>
            </div>
          )
        )}
      </CardContent>

      {/* Devolução ao Centro de Planejamento — considerações obrigatórias. */}
      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Devolver ao Centro de Planejamento</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            O cliente volta à Fase 3 e o Dentista Planner recebe as suas
            considerações (obrigatórias) para refazer o planejamento.
          </p>
          <textarea
            value={considerations}
            onChange={(e) => setConsiderations(e.target.value)}
            placeholder="O que o cliente não aprovou e o que você sugere mudar no plano..."
            className="min-h-24 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReturnOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={isPending || !considerations.trim()}
              onClick={doReturn}
            >
              Devolver com considerações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
