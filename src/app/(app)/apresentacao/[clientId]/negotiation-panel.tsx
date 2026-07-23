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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  negotiationViolations,
  type CommercialRule,
  type NegotiationStatus,
  type PaymentMethod,
} from "@/lib/commercial";
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
    gut: number | null;
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
  excludedItemIds: string[];
};

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";
const inputClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

type AdjustMode = "none" | "discount_percent" | "discount_amount" | "surcharge";

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
  canEdit,
  canAuthorize,
}: {
  clientId: string;
  planId: string;
  options: NegotiationOption[];
  negotiation: NegotiationData | null;
  rule: CommercialRule;
  canEdit: boolean;
  canAuthorize: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const primary = options.find((o) => o.isPrimary) ?? options[0] ?? null;
  const [optionId, setOptionId] = useState(
    negotiation?.optionId ?? primary?.id ?? ""
  );
  const option = options.find((o) => o.id === optionId) ?? primary;

  const [excluded, setExcluded] = useState<Set<string>>(
    new Set(negotiation?.excludedItemIds ?? [])
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
  const locked = status === "aceita" || status === "devolvida" || !canEdit;

  function toggleItem(id: string) {
    if (locked) return;
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Totais ao vivo.
  const subtotalCents = useMemo(() => {
    if (!option) return 0;
    return option.items
      .filter((i) => !excluded.has(i.id))
      .reduce((s, i) => s + i.quantity * i.unitPriceCents, 0);
  }, [option, excluded]);

  const adjustmentCents = useMemo(() => {
    if (adjustMode === "none") return 0;
    if (adjustMode === "discount_percent") {
      const pct = Number(adjustValue.replace(",", "."));
      if (!Number.isFinite(pct) || pct <= 0) return 0;
      return -Math.round((subtotalCents * pct) / 100);
    }
    const cents = parseBRLToCents(adjustValue) ?? 0;
    return adjustMode === "discount_amount" ? -cents : cents;
  }, [adjustMode, adjustValue, subtotalCents]);

  const finalCents = subtotalCents + adjustmentCents;
  const installmentsNum = Math.max(1, Number.parseInt(installments, 10) || 1);
  const isPartial = option
    ? option.items.some((i) => excluded.has(i.id))
    : false;

  // Pré-checagem da regra (o servidor revalida sempre).
  const liveViolations = useMemo(
    () =>
      negotiationViolations(
        {
          subtotalCents,
          adjustmentCents,
          installments: installmentsNum,
          paymentMethod: paymentMethod || null,
        },
        rule
      ),
    [subtotalCents, adjustmentCents, installmentsNum, paymentMethod, rule]
  );

  function save() {
    if (!option) return;
    startTransition(async () => {
      const r = await savePlanNegotiation(clientId, {
        planId,
        optionId: option.id,
        allItemIds: option.items.map((i) => i.id),
        excludedItemIds: option.items
          .filter((i) => excluded.has(i.id))
          .map((i) => i.id),
        adjustmentCents,
        paymentMethod: paymentMethod || null,
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
          allItemIds: option.items.map((i) => i.id),
          excludedItemIds: option.items
            .filter((i) => excluded.has(i.id))
            .map((i) => i.id),
          adjustmentCents,
          paymentMethod: paymentMethod || null,
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
              onChange={(e) => {
                setOptionId(e.target.value);
                setExcluded(new Set());
              }}
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
            Procedimentos — desmarque o que o cliente NÃO aprovou (a prioridade
            GUT ajuda a decidir o que pode sair):
          </p>
          <ul className="space-y-1">
            {option.items.map((i) => {
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
                  {i.gut != null && (
                    <Badge variant="outline" className="text-[10px]">
                      GUT {i.gut}
                    </Badge>
                  )}
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

        {/* Condições: ajuste + pagamento + parcelas. */}
        <div className="grid gap-3 sm:grid-cols-2">
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
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">Pagamento</span>
              <select
                value={paymentMethod}
                onChange={(e) =>
                  setPaymentMethod(e.target.value as PaymentMethod | "")
                }
                disabled={locked}
                className={cn(selectClass, "w-full")}
              >
                <option value="">Escolher...</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">Parcelas</span>
              <input
                value={installments}
                onChange={(e) => setInstallments(e.target.value)}
                disabled={locked}
                inputMode="numeric"
                className={inputClass}
              />
            </label>
          </div>
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
            {adjustmentCents !== 0 && (
              <>
                {" "}
                · {adjustmentCents < 0 ? "desconto" : "acréscimo"}{" "}
                {formatBRL(Math.abs(adjustmentCents))}
              </>
            )}
            {installmentsNum > 1 && finalCents > 0 && (
              <>
                {" "}
                · {installmentsNum}x de {formatBRL(Math.round(finalCents / installmentsNum))}
              </>
            )}
          </span>
          <span className="text-base font-semibold">{formatBRL(finalCents)}</span>
        </div>

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
          canEdit &&
          status !== "devolvida" && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={isPending} onClick={save}>
                Salvar negociação
              </Button>
              {negotiation && (
                <Button
                  variant="outline"
                  disabled={isPending || status === "aguardando_autorizacao"}
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
