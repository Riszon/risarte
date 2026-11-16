"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import {
  buildSchedule,
  scheduleErrors,
  scheduleTotalCents,
  type ScheduleEntry,
} from "@/lib/payments";
import { PaymentScheduleEditor } from "@/components/payment-schedule-editor";
import {
  financedPlan,
  renegotiationBase,
  renegotiationErrors,
  renegotiationOutcome,
} from "@/lib/finance/renegotiation";
import type { InstallmentView } from "@/lib/finance/receivables";
import { saveRenegotiation } from "./receivables-actions";
import { addDaysIso } from "@/lib/dates";
import { descontoPorComponente } from "@/lib/renegociacao/desconto";
import { FRASE_DA_ESPERA } from "@/lib/renegociacao/termo-texto";

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * FIN2 — a renegociação. A dívida apurada é **tudo o que é devido hoje**; o que
 * for perdoado é desconto, tem o teto da regra comercial da unidade e fica
 * registrado com motivo e autor (decisões do dono, 04/08/2026).
 */
export function RenegotiationDialog({
  open,
  onOpenChange,
  clientId,
  selected,
  today,
  maxDiscountPercent,
  isManager,
  maquininhaLigada = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  selected: InstallmentView[];
  today: string;
  maxDiscountPercent: number | null;
  isManager: boolean;
  /** 4017: a maquininha só com a chave da rede ligada. */
  maquininhaLigada?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [downPayment, setDownPayment] = useState("0,00");
  const [count, setCount] = useState(3);
  // O 1º vencimento novo nasce uma semana à frente: o banco recusa hoje (o termo
  // ficaria sem prazo para ser assinado, FIRST_DUE_TOO_SOON), e amanhã é o mínimo.
  const [firstDue, setFirstDue] = useState(addDaysIso(today, 7));
  const [method, setMethod] = useState("boleto");
  // 4017: a descrição da permuta e a forma dos boletos (null = a da venda de origem).
  const [descricao, setDescricao] = useState("");
  const [forma, setForma] = useState<"mensal" | "todos" | null>(null);
  const [rate, setRate] = useState("0");
  const [reason, setReason] = useState("");
  const [entries, setEntries] = useState<ScheduleEntry[] | null>(null);

  const base = useMemo(() => renegotiationBase(selected), [selected]);

  const downCents = parseBRLToCents(downPayment) ?? 0;
  const monthlyPercent = Math.max(0, Number(rate.replace(",", ".")) || 0);
  // Juros do parcelamento: quanto mais tempo para quitar, mais o cliente paga.
  const financed = useMemo(
    () =>
      financedPlan(
        Math.max(0, base.totalCents - downCents),
        monthlyPercent,
        Math.max(1, count)
      ),
    [base.totalCents, downCents, monthlyPercent, count]
  );

  // O parcelamento sugerido cobre a dívida (mais os juros, se houver); o
  // usuário edita à vontade — é a diferença que vira desconto ou acréscimo.
  const suggested = useMemo(
    () =>
      buildSchedule({
        totalCents: downCents + financed.financedTotalCents,
        downPaymentCents: downCents,
        installments: Math.max(1, count),
        firstDueDate: firstDue,
      }),
    [downCents, financed.financedTotalCents, count, firstDue]
  );
  const current = entries ?? suggested;
  const newTotal = scheduleTotalCents(current);

  const outcome = renegotiationOutcome({
    originalCents: base.totalCents,
    newCents: newTotal,
    maxDiscountPercent,
    isManager,
  });

  const errors = renegotiationErrors({
    selectedCount: base.count,
    originalCents: base.totalCents,
    newCents: newTotal,
    // O total do novo plano é livre (a diferença é o desconto); aqui só
    // checamos valores, datas e a entrada única.
    scheduleErrors: scheduleErrors(current, { totalCents: newTotal }),
  });
  const needsReason = outcome.discountCents !== 0 && !reason.trim();
  const needsDescricao = method === "permuta" && descricao.trim().length < 3;
  // 4017 (2a): o desconto abate juros, depois multa, benefício e principal.
  const divisao = descontoPorComponente(
    { principal: base.principalCents, beneficio: base.benefitCents, multa: base.lateFeeCents, juros: base.interestCents },
    Math.max(0, outcome.discountCents)
  );

  function save() {
    startTransition(async () => {
      // 4017: salvar não muda as parcelas antigas nem cancela boleto: o acordo
      // espera a assinatura do termo (ou, antes, a autorização do Gerente).
      const r = await saveRenegotiation({
        clientId,
        installmentIds: selected.map((v) => v.id),
        entries: current.map((e) => ({
          kind: e.kind,
          due_date: e.dueDate,
          amount_cents: e.amountCents,
          payment_method: method || null,
          descricao: method === "permuta" ? descricao.trim() : null,
        })),
        reason,
        monthlyInterestPercent: monthlyPercent,
        boletoMode: method === "boleto" ? forma : null,
      });
      if (r.ok) {
        toast.success(
          outcome.needsAuthorization
            ? "Renegociação enviada para autorização do Gerente. Depois dela, envie o termo para o cliente assinar."
            : "Renegociação salva. Agora envie o termo para o cliente assinar: até lá, nada muda nas parcelas antigas."
        );
        onOpenChange(false);
        setEntries(null);
        setReason("");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Renegociar cobranças</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* 1) A dívida apurada hoje. */}
          <div className="space-y-1 rounded-lg border bg-muted/30 p-3">
            <p className="text-xs font-semibold">
              Dívida apurada hoje ({base.count} cobrança
              {base.count === 1 ? "" : "s"}
              {base.lateCount > 0 && `, ${base.lateCount} vencida${base.lateCount === 1 ? "" : "s"}`})
            </p>
            <ul className="space-y-0.5 text-xs tabular-nums">
              <li className="flex justify-between">
                <span>Valor que falta das parcelas</span>
                <span>{formatBRL(base.principalCents)}</span>
              </li>
              {base.benefitCents > 0 && (
                <li className="flex justify-between text-destructive">
                  <span>Benefício perdido por atraso</span>
                  <span>+ {formatBRL(base.benefitCents)}</span>
                </li>
              )}
              {base.lateFeeCents > 0 && (
                <li className="flex justify-between text-destructive">
                  <span>Multa</span>
                  <span>+ {formatBRL(base.lateFeeCents)}</span>
                </li>
              )}
              {base.interestCents > 0 && (
                <li className="flex justify-between text-destructive">
                  <span>Juros</span>
                  <span>+ {formatBRL(base.interestCents)}</span>
                </li>
              )}
              <li className="flex justify-between border-t pt-0.5 font-semibold">
                <span>Total devido</span>
                <span>{formatBRL(base.totalCents)}</span>
              </li>
            </ul>
            <ul className="mt-1 space-y-0.5 border-t pt-1 text-[11px] text-muted-foreground">
              {selected.map((v) => (
                <li key={v.id} className="flex justify-between gap-2">
                  <span>
                    {v.kind === "entrada" ? "Entrada" : `Parcela ${v.seq}`} ·{" "}
                    {fmtDate(v.dueDate)}
                  </span>
                  <span className="tabular-nums">
                    {formatBRL(v.updatedBalanceCents)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* 2) O novo parcelamento. */}
          <div className="grid gap-2 sm:grid-cols-5">
            <div>
              <Label className="text-[11px]">Entrada (R$)</Label>
              <Input
                className="h-9 text-sm"
                inputMode="decimal"
                value={downPayment}
                onChange={(e) => {
                  setDownPayment(e.target.value);
                  setEntries(null);
                }}
              />
            </div>
            <div>
              <Label className="text-[11px]">Parcelas</Label>
              <Input
                className="h-9 text-sm"
                type="number"
                min={1}
                max={48}
                value={count}
                onChange={(e) => {
                  setCount(Number(e.target.value) || 1);
                  setEntries(null);
                }}
              />
            </div>
            <div>
              <Label className="text-[11px]">Juros ao mês (%)</Label>
              <Input
                className="h-9 text-sm"
                inputMode="decimal"
                value={rate}
                onChange={(e) => {
                  setRate(e.target.value);
                  setEntries(null);
                }}
              />
            </div>
            <div>
              <Label className="text-[11px]">1º vencimento</Label>
              <Input
                className="h-9 text-sm"
                type="date"
                min={addDaysIso(today, 1)}
                value={firstDue}
                onChange={(e) => {
                  setFirstDue(e.target.value);
                  setEntries(null);
                }}
              />
            </div>
            <div>
              <Label className="text-[11px]">Forma de pagamento</Label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
              >
                {/* 4017 (19.28.6): os meios da venda direta nova. */}
                <option value="boleto">Boleto</option>
                <option value="pix">PIX</option>
                <option value="cartao">Cartão à vista</option>
                <option value="cartao_parcelado_asaas">Cartão parcelado (Asaas)</option>
                <option value="dinheiro">Dinheiro</option>
                {isManager && <option value="permuta">Permuta</option>}
                {maquininhaLigada && <option value="cartao_parcelado">Cartão parcelado (maquininha)</option>}
              </select>
            </div>
          </div>

          {method === "permuta" && (
            <div>
              <Label className="text-[11px]">O que é a permuta (obrigatório)</Label>
              <Input
                className="h-9 text-sm"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Ex.: serviço de marcenaria na recepção"
              />
            </div>
          )}

          {method === "boleto" && (
            <div className="space-y-1 rounded-lg border p-2 text-xs">
              <p className="font-semibold">Forma dos boletos</p>
              {(
                [
                  [null, "A da venda de origem"],
                  ["mensal", "Um boleto por mês"],
                  ["todos", "Todos os boletos agora"],
                ] as const
              ).map(([v, label]) => (
                <label key={label} className="mr-3 inline-flex items-center gap-1">
                  <input type="radio" checked={forma === v} onChange={() => setForma(v)} className="accent-primary" />
                  {label}
                </label>
              ))}
              <p className="text-[11px] text-muted-foreground">
                Os boletos novos nascem quando o cliente assinar o termo. Em &quot;Todos os boletos agora&quot;, eles aparecem
                no mesmo link da lista da venda.
              </p>
            </div>
          )}

          {financed.interestCents > 0 && (
            <p className="rounded-lg border border-border bg-muted/30 p-2 text-xs">
              Parcelando {count}× a {monthlyPercent}% ao mês, o cliente paga{" "}
              <strong>{formatBRL(financed.installmentCents)}</strong> por
              parcela — <strong>{formatBRL(financed.interestCents)}</strong> de
              juros pelo tempo até quitar. Alongar o prazo aumenta esse valor.
            </p>
          )}

          <PaymentScheduleEditor
            entries={current}
            onChange={setEntries}
            totalCents={newTotal}
          />

          {/* 3) O resultado: desconto ou acréscimo. */}
          <div className="space-y-1 rounded-lg border p-3 text-xs tabular-nums">
            <p className="flex justify-between">
              <span>Dívida apurada</span>
              <span>{formatBRL(outcome.originalCents)}</span>
            </p>
            <p className="flex justify-between">
              <span>Novo parcelamento</span>
              <span>{formatBRL(outcome.newCents)}</span>
            </p>
            {outcome.discountCents > 0 && (
              <p className="flex justify-between font-semibold text-destructive">
                <span>Desconto concedido ({outcome.discountPercent}%)</span>
                <span>− {formatBRL(outcome.discountCents)}</span>
              </p>
            )}
            {outcome.discountCents < 0 && (
              <p className="flex justify-between font-semibold">
                <span>
                  Juros do parcelamento
                  {monthlyPercent > 0 && ` (${monthlyPercent}% ao mês)`}
                </span>
                <span>+ {formatBRL(-outcome.discountCents)}</span>
              </p>
            )}
            {outcome.discountCents > 0 && (
              <p className="text-[11px] font-normal text-muted-foreground">
                O desconto abate, nesta ordem: juros {formatBRL(divisao.juros)} · multa {formatBRL(divisao.multa)} ·
                benefício {formatBRL(divisao.beneficio)} · principal {formatBRL(divisao.principal)}
              </p>
            )}
            {maxDiscountPercent !== null && (
              <p className="text-[11px] font-normal text-muted-foreground">
                Teto de desconto da unidade: {maxDiscountPercent}%
              </p>
            )}
          </div>

          {outcome.needsAuthorization && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                Este desconto precisa de <strong>autorização do Gerente</strong>{" "}
                da unidade. A renegociação fica registrada e, só depois de ele
                aprovar, o termo vai para o cliente assinar.
              </span>
            </p>
          )}

          <div>
            <Label className="text-[11px]">
              Motivo {outcome.discountCents !== 0 && "(obrigatório)"}
            </Label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: cliente desempregado, acordo de quitação em 3x..."
              className="min-h-16 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
            />
          </div>

          <p className="rounded-lg border bg-muted/30 p-2 text-[11px] text-muted-foreground">
            Salvar não muda as parcelas de hoje. O acordo só vale quando o cliente assinar o termo (até 5 dias, nunca
            depois do 1º vencimento novo). {FRASE_DA_ESPERA}
          </p>

          {errors.length > 0 && (
            <ul className="space-y-0.5 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              {errors.map((e) => (
                <li key={e}>• {e}</li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={isPending || errors.length > 0 || needsReason || needsDescricao}
            onClick={save}
          >
            <Check className="mr-1 size-4" />
            {outcome.needsAuthorization ? "Enviar para autorização" : "Salvar o acordo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
