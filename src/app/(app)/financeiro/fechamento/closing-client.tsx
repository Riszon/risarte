"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, Lock, LockOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import {
  closeBlock,
  closeBlockMessage,
  highSeverity,
  monthName,
  MONTH_NAMES,
  type ChecklistItem,
  type MonthStatus,
} from "@/lib/finance/closing";
import { closePeriod, reopenPeriod } from "./actions";

const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs";

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function MonthChip({
  m,
  active,
  onPick,
}: {
  m: MonthStatus;
  active: boolean;
  onPick: () => void;
}) {
  const closed = m.status === "closed";
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
        active && "ring-2 ring-primary",
        closed
          ? "border-emerald-600/40 bg-emerald-50 text-emerald-800"
          : m.entries > 0
            ? "border-amber-500/40 bg-amber-50 text-amber-800"
            : "text-muted-foreground"
      )}
    >
      {closed ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
      {monthName(m.month).slice(0, 3)}
      {m.entries > 0 && <span className="opacity-60">· {m.entries}</span>}
    </button>
  );
}

export function ClosingView({
  clinicId,
  year,
  month,
  today,
  months,
  checklist,
  canClose,
  canReopen,
}: {
  clinicId: string;
  year: number;
  month: number;
  today: string;
  months: MonthStatus[];
  checklist: ChecklistItem[];
  canClose: boolean;
  canReopen: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);

  function apply(next: Partial<{ ano: number; mes: number }>) {
    const params = new URLSearchParams({
      ano: String(next.ano ?? year),
      mes: String(next.mes ?? month),
    });
    startTransition(() => router.push(`/financeiro/fechamento?${params}`));
  }

  const target = months.find((m) => m.month === month);
  const block = closeBlock({ year, month, months, today });
  const blockMsg = closeBlockMessage(block);
  const high = highSeverity(checklist);
  const isClosed = target?.status === "closed";

  function doClose() {
    startTransition(async () => {
      const r = await closePeriod({ clinicId, year, month });
      if (r.ok) {
        toast.success(`${monthName(month)} de ${year} fechado.`);
        setConfirming(false);
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function doReopen() {
    startTransition(async () => {
      const r = await reopenPeriod({ clinicId, year, month, reason });
      if (r.ok) {
        toast.success("Período reaberto.");
        setReason("");
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <div className={cn("space-y-4", isPending && "opacity-70")}>
      {/* -- O ANO ------------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <Label className="text-[11px]">Ano</Label>
              <Input
                className="h-8 w-24"
                type="number"
                value={year}
                onChange={(e) => apply({ ano: Number(e.target.value) })}
              />
            </label>
            <label className="block">
              <Label className="text-[11px]">Mês</Label>
              <select
                value={month}
                onChange={(e) => apply({ mes: Number(e.target.value) })}
                className={cn(selectClass, "w-36")}
              >
                {MONTH_NAMES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <p className="ml-auto text-[11px] text-muted-foreground">
              O número ao lado do mês é a quantidade de lançamentos nele.
            </p>
          </div>

          <div className="flex flex-wrap gap-1">
            {months.map((m) => (
              <MonthChip
                key={m.month}
                m={m}
                active={m.month === month}
                onPick={() => apply({ mes: m.month })}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* -- O MÊS EM FOCO ----------------------------------------------- */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">
            {monthName(month)} de {year}
          </h2>

          {isClosed ? (
            <div className="space-y-2">
              <p className="flex items-center gap-2 rounded-lg border border-emerald-600/40 bg-emerald-50 p-3 text-sm text-emerald-900">
                <Lock className="size-4 shrink-0" />
                <span>
                  <strong>Fechado</strong>
                  {target?.closedByName && ` por ${target.closedByName}`}
                  {target?.closedAt && ` em ${fmtWhen(target.closedAt)}`}. Novos
                  lançamentos de competência neste mês são recusados.
                </span>
              </p>

              {target?.reopenReason && (
                <p className="text-[11px] text-muted-foreground">
                  Já foi reaberto em {fmtWhen(target.reopenedAt)} — motivo
                  registrado: &quot;{target.reopenReason}&quot;
                </p>
              )}

              {canReopen ? (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block flex-1">
                    <Label className="text-[11px]">
                      Motivo da reabertura (fica registrado)
                    </Label>
                    <Input
                      className="h-8"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Ex.: nota de fornecedor chegou atrasada"
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!reason.trim()}
                    onClick={doReopen}
                  >
                    Reabrir
                  </Button>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Só a Franqueadora reabre um período fechado — quem fechou não
                  reabre, é o que separa um controle de um botão.
                </p>
              )}
            </div>
          ) : (
            <>
              {/* -- A CONFERÊNCIA ---------------------------------------- */}
              {checklist.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-emerald-800">
                  <Check className="size-4" />
                  Nada pendente neste mês.
                </p>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Pendências do mês — <strong>nenhuma bloqueia</strong> o
                    fechamento:
                  </p>
                  {checklist.map((c) => (
                    <div
                      key={c.key}
                      className={cn(
                        "flex flex-wrap items-baseline justify-between gap-2 rounded border p-2 text-xs",
                        c.severity === "alta"
                          ? "border-destructive/40 bg-destructive/5"
                          : "border-amber-500/40 bg-amber-500/5"
                      )}
                    >
                      <span className="flex items-center gap-1">
                        {c.severity === "alta" && (
                          <AlertTriangle className="size-3 text-destructive" />
                        )}
                        {c.label}
                      </span>
                      <span className="tabular-nums">
                        {c.items} {c.items === 1 ? "item" : "itens"}
                        {c.amountCents > 0 && ` · ${formatBRL(c.amountCents)}`}
                      </span>
                    </div>
                  ))}
                  {high.length > 0 && (
                    <p className="text-[11px] text-destructive">
                      O item em vermelho deixa o <strong>resultado do mês
                      subestimado</strong> se você fechar assim — corrigir
                      depois exige reabrir o período.
                    </p>
                  )}
                </div>
              )}

              {/* -- FECHAR ----------------------------------------------- */}
              {blockMsg ? (
                <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                  {blockMsg}
                </p>
              ) : !canClose ? (
                <p className="text-[11px] text-muted-foreground">
                  Você não tem permissão para fechar o mês desta unidade.
                </p>
              ) : confirming ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                  <span>
                    Fechar {monthName(month)} de {year}
                    {checklist.length > 0 && " com as pendências acima"}?
                  </span>
                  <Button size="sm" onClick={doClose}>
                    Sim, fechar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirming(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              ) : (
                <Button size="sm" onClick={() => setConfirming(true)}>
                  {checklist.length > 0
                    ? "Fechar mesmo assim"
                    : `Fechar ${monthName(month)}`}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-[10px] text-muted-foreground">
        <strong>O que a trava recusa:</strong> lançamento novo ou alterado de
        competência no mês fechado — venda, conta a pagar, depreciação, consumo
        de material. <strong>O que continua livre:</strong> receber uma parcela,
        pagar uma conta e conciliar o extrato, porque nada disso muda o resultado
        do mês fechado. Fechar fora de ordem não é permitido: se um mês anterior
        ainda tem movimento em aberto, ele fecha primeiro.
      </p>
    </div>
  );
}
