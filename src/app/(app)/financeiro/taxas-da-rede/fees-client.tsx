"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2Off, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import {
  feeLabel,
  simulateMonth,
  totalFixedCents,
  totalPercent,
  type NetworkFeeRule,
} from "@/lib/finance/network-fees";
import {
  chargeFixedFeesNow,
  clearNetworkFeeOverride,
  saveNetworkFee,
} from "./actions";

const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export type FeeSummaryRow = {
  fee: string;
  label: string;
  kind: "percent" | "fixed";
  percent: number;
  isOverride: boolean;
  baseCents: number;
  amountCents: number;
  receipts: number;
  payableStatus: string | null;
};

function pct(v: number): string {
  return `${v.toFixed(2).replace(".", ",")}%`;
}

function parseNumber(text: string): number {
  const n = Number(text.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Uma linha editável da configuração. */
function RuleRow({
  rule,
  scope,
  canEdit,
  onSave,
  onClear,
}: {
  rule: NetworkFeeRule;
  scope: "rede" | "unidade";
  canEdit: boolean;
  onSave: (next: NetworkFeeRule) => void;
  onClear?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [percent, setPercent] = useState(String(rule.percent).replace(".", ","));
  const [amount, setAmount] = useState(
    (rule.amountCents / 100).toFixed(2).replace(".", ",")
  );
  const [dueDay, setDueDay] = useState(String(rule.dueDay));
  const [active, setActive] = useState(rule.active);
  const [note, setNote] = useState(rule.note);

  const label = feeLabel(rule.fee);

  if (!editing) {
    return (
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-t py-1.5 text-sm">
        <span className="flex items-center gap-2">
          {label}
          {scope === "unidade" && rule.isOverride && (
            <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800">
              acordo próprio
            </span>
          )}
          {scope === "unidade" && !rule.isOverride && (
            <span className="text-[10px] text-muted-foreground">
              segue a rede
            </span>
          )}
          {!rule.active && (
            <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
              desligada
            </span>
          )}
        </span>
        <span className="flex items-center gap-3 tabular-nums">
          <span className="w-24 text-right">
            {rule.kind === "percent"
              ? pct(rule.percent)
              : formatBRL(rule.amountCents)}
          </span>
          <span className="w-24 text-right text-xs text-muted-foreground">
            vence dia {rule.dueDay}
          </span>
          {canEdit && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(true)}
                title="Editar"
              >
                <Pencil className="size-3" />
              </Button>
              {scope === "unidade" && rule.isOverride && onClear && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onClear}
                  title="Voltar ao padrão da rede"
                >
                  <Link2Off className="size-3" />
                </Button>
              )}
            </>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t py-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap items-end gap-2">
        {rule.kind === "percent" ? (
          <label className="block">
            <Label className="text-[11px]">% sobre o recebido</Label>
            <Input
              className="h-8 w-24"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
          </label>
        ) : (
          <label className="block">
            <Label className="text-[11px]">Valor mensal (R$)</Label>
            <Input
              className="h-8 w-28"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
        )}
        <label className="block">
          <Label className="text-[11px]">Vence dia</Label>
          <Input
            className="h-8 w-20"
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1 pb-1 text-xs">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Cobrar
        </label>
        <label className="block flex-1">
          <Label className="text-[11px]">
            {scope === "unidade"
              ? "Motivo do acordo diferente (fica registrado)"
              : "Observação"}
          </Label>
          <Input
            className="h-8"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              scope === "unidade"
                ? "Ex.: carência de royalty nos 12 primeiros meses"
                : ""
            }
          />
        </label>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => {
            onSave({
              ...rule,
              percent: parseNumber(percent),
              amountCents: Math.round(parseNumber(amount) * 100),
              dueDay: Number(dueDay) || 10,
              active,
              note,
            });
            setEditing(false);
          }}
        >
          Salvar
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function NetworkFeesView({
  isNetworkAdmin,
  network,
  unit,
  unitId,
  units,
  year,
  month,
  summary,
}: {
  isNetworkAdmin: boolean;
  network: NetworkFeeRule[];
  unit: NetworkFeeRule[];
  unitId: string | null;
  units: { id: string; name: string }[];
  year: number;
  month: number;
  summary: FeeSummaryRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [simulate, setSimulate] = useState("50.000,00");

  function apply(
    next: Partial<{ ano: number; mes: number; unidade: string }>
  ) {
    const params = new URLSearchParams({
      ano: String(next.ano ?? year),
      mes: String(next.mes ?? month),
      unidade: next.unidade ?? unitId ?? "",
    });
    startTransition(() => router.push(`/financeiro/taxas-da-rede?${params}`));
  }

  function save(clinicId: string | null, next: NetworkFeeRule) {
    startTransition(async () => {
      const r = await saveNetworkFee({
        clinicId,
        fee: next.fee,
        kind: next.kind,
        percent: next.percent,
        amountCents: next.amountCents,
        dueDay: next.dueDay,
        active: next.active,
        note: next.note,
      });
      if (r.ok) toast.success("Taxa salva.");
      else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function clear(fee: string) {
    if (!unitId) return;
    startTransition(async () => {
      const r = await clearNetworkFeeOverride({ clinicId: unitId, fee });
      if (r.ok) toast.success("Voltou ao padrão da rede.");
      else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function runFixed() {
    startTransition(async () => {
      const r = await chargeFixedFeesNow({ year, month });
      if (r.ok) toast.success(`${r.count ?? 0} taxas fixas geradas.`);
      else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  const sim = simulateMonth(unit, Math.round(parseNumber(simulate) * 100));
  const totalApurado = summary.reduce((s, r) => s + r.amountCents, 0);

  return (
    <div className={cn("space-y-4", isPending && "opacity-70")}>
      {/* -- FILTROS ------------------------------------------------------ */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          {isNetworkAdmin && units.length > 1 && (
            <label className="block">
              <Label className="text-[11px]">Unidade</Label>
              <select
                value={unitId ?? ""}
                onChange={(e) => apply({ unidade: e.target.value })}
                className={cn(selectClass, "w-52")}
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          )}
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
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </CardContent>
      </Card>

      {/* -- O QUE VALE PARA ESTA UNIDADE -------------------------------- */}
      <Card>
        <CardContent className="p-4">
          <h2 className="text-sm font-semibold">O que vale para esta unidade</h2>
          <p className="pb-1 text-[11px] text-muted-foreground">
            É esta a referência do split: cada baixa de parcela cobra estes
            percentuais sobre o valor recebido.
          </p>
          {unit.map((r) => (
            <RuleRow
              key={r.fee}
              rule={r}
              scope="unidade"
              canEdit={isNetworkAdmin && !!unitId}
              onSave={(next) => save(unitId, next)}
              onClear={() => clear(r.fee)}
            />
          ))}

          <div className="mt-3 flex flex-wrap items-end gap-3 border-t pt-3">
            <div>
              <p className="text-[11px] text-muted-foreground">
                Sobre cada real recebido
              </p>
              <p className="text-lg font-semibold tabular-nums">
                {pct(totalPercent(unit))}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Fixo por mês</p>
              <p className="text-lg font-semibold tabular-nums">
                {formatBRL(totalFixedCents(unit))}
              </p>
            </div>
            <label className="block">
              <Label className="text-[11px]">Se receber no mês (R$)</Label>
              <Input
                className="h-8 w-32"
                value={simulate}
                onChange={(e) => setSimulate(e.target.value)}
              />
            </label>
            <p className="pb-1 text-sm">
              paga{" "}
              <strong className="tabular-nums">
                {formatBRL(sim.totalCents)}
              </strong>{" "}
              <span className="text-[11px] text-muted-foreground">
                ({formatBRL(sim.percentCents)} de percentual +{" "}
                {formatBRL(sim.fixedCents)} de fixo)
              </span>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* -- O APURADO NO MÊS -------------------------------------------- */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Apurado em {MONTHS[month - 1]} de {year}
            </h2>
            {isNetworkAdmin && (
              <Button size="sm" variant="outline" onClick={runFixed}>
                Gerar taxas fixas do mês
              </Button>
            )}
          </div>

          {summary.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">
              Nada apurado neste mês.
            </p>
          ) : (
            <>
              <div className="flex justify-between pb-1 pt-2 text-[10px] uppercase text-muted-foreground">
                <span>Taxa</span>
                <span className="flex gap-3">
                  <span className="w-20 text-right">Base recebida</span>
                  <span className="w-16 text-right">Baixas</span>
                  <span className="w-24 text-right">Valor</span>
                  <span className="w-20 text-right">Conta</span>
                </span>
              </div>
              {summary.map((s) => (
                <div
                  key={s.fee}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-t py-1 text-xs"
                >
                  <span>
                    {s.label}
                    {s.kind === "percent" && s.percent > 0 && (
                      <span className="ml-1 text-muted-foreground">
                        ({pct(s.percent)})
                      </span>
                    )}
                  </span>
                  <span className="flex gap-3 tabular-nums">
                    <span className="w-20 text-right text-muted-foreground">
                      {s.kind === "percent" ? formatBRL(s.baseCents) : "—"}
                    </span>
                    <span className="w-16 text-right text-muted-foreground">
                      {s.kind === "percent" ? s.receipts : "—"}
                    </span>
                    <span className="w-24 text-right">
                      {formatBRL(s.amountCents)}
                    </span>
                    <span className="w-20 text-right text-muted-foreground">
                      {s.payableStatus ?? "—"}
                    </span>
                  </span>
                </div>
              ))}
              <div className="flex justify-between border-t-2 py-1.5 text-sm font-semibold">
                <span>Total do mês</span>
                <span className="tabular-nums">{formatBRL(totalApurado)}</span>
              </div>
            </>
          )}

          <p className="pt-2 text-[10px] text-muted-foreground">
            Cada taxa vira <strong>uma conta a pagar por mês</strong>, que cresce
            conforme os recebimentos entram — é por lá que ela aparece no fluxo
            de caixa e na DRE. Hoje o split{" "}
            <strong>não é retido pela adquirente</strong> (o ASAAS ainda não está
            plugado): a unidade recebe tudo e paga a rede pela conta. Quando o
            ASAAS entrar, este mesmo cálculo vira o valor retido.
          </p>
        </CardContent>
      </Card>

      {/* -- O PADRÃO DA REDE -------------------------------------------- */}
      {isNetworkAdmin && (
        <Card>
          <CardContent className="p-4">
            <h2 className="text-sm font-semibold">Padrão da rede</h2>
            <p className="pb-1 text-[11px] text-muted-foreground">
              Vale para toda unidade que não tem acordo próprio. Mudar aqui{" "}
              <strong>não recalcula o que já foi cobrado</strong> — o percentual
              fica congelado em cada baixa no momento em que ela acontece.
            </p>
            {network.map((r) => (
              <RuleRow
                key={r.fee}
                rule={r}
                scope="rede"
                canEdit
                onSave={(next) => save(null, next)}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
