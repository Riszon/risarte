"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import type { Breakeven, BreakevenRole } from "@/lib/finance/breakeven";
import type { Bridge } from "@/lib/finance/bridge";

const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs";

const ROLE_LABELS: Record<BreakevenRole, string> = {
  receita: "Receita",
  deducao: "Deduções",
  variavel: "Custos variáveis",
  fixo: "Custos fixos",
  depreciacao: "Depreciação",
  receita_financeira: "Receitas financeiras",
  fora: "Fora da conta",
};

const ROLE_ORDER: BreakevenRole[] = [
  "receita",
  "deducao",
  "variavel",
  "fixo",
  "depreciacao",
  "receita_financeira",
];

function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`;
}

function Big({
  label,
  value,
  hint,
  danger,
}: {
  label: string;
  value: string;
  hint?: string;
  danger?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-lg font-semibold tabular-nums",
          danger && "text-destructive"
        )}
      >
        {value}
      </p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: number;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-2 border-t py-1.5 text-sm",
        strong && "border-t-2 font-semibold",
        muted && "text-muted-foreground"
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{formatBRL(value)}</span>
    </div>
  );
}

export function BreakevenView({
  from,
  to,
  days,
  costCenterId,
  costCenters,
  breakeven,
  turnDay,
  bridge,
}: {
  from: string;
  to: string;
  days: number;
  costCenterId: string;
  costCenters: { id: string; name: string }[];
  breakeven: Breakeven;
  turnDay: number | null;
  bridge: Bridge;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [openRole, setOpenRole] = useState<BreakevenRole | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);

  function apply(next: Partial<{ de: string; ate: string; centro: string }>) {
    const params = new URLSearchParams({
      de: next.de ?? from,
      ate: next.ate ?? to,
      centro: next.centro ?? costCenterId,
    });
    startTransition(() =>
      router.push(`/financeiro/ponto-de-equilibrio?${params}`)
    );
  }

  const b = breakeven;

  return (
    <div className={cn("space-y-4", isPending && "opacity-70")}>
      {/* -- FILTROS ------------------------------------------------------ */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <label className="block">
            <Label className="text-[11px]">De</Label>
            <Input
              className="h-8 w-40"
              type="date"
              value={from}
              onChange={(e) => apply({ de: e.target.value })}
            />
          </label>
          <label className="block">
            <Label className="text-[11px]">Até</Label>
            <Input
              className="h-8 w-40"
              type="date"
              value={to}
              onChange={(e) => apply({ ate: e.target.value })}
            />
          </label>
          <label className="block">
            <Label className="text-[11px]">Centro de custo</Label>
            <select
              value={costCenterId}
              onChange={(e) => apply({ centro: e.target.value })}
              className={cn(selectClass, "w-48")}
            >
              <option value="">Todos</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <p className="ml-auto text-[11px] text-muted-foreground">
            {days} {days === 1 ? "dia" : "dias"} no período
          </p>
        </CardContent>
      </Card>

      {/* -- O NÚMERO ----------------------------------------------------- */}
      {b.semSolucao ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p>
            {b.receitaLiquidaCents <= 0 ? (
              <>
                <strong>Sem faturamento no período</strong> — não há ponto de
                equilíbrio para calcular.
              </>
            ) : (
              <>
                <strong>
                  Os custos variáveis comem toda a receita (margem de
                  contribuição de {formatBRL(b.margemContribuicaoCents)}).
                </strong>{" "}
                Não existe faturamento que resolva: cada real vendido piora o
                resultado. O problema está no preço ou nos custos diretos, não
                no volume.
              </>
            )}
          </p>
        </div>
      ) : (
        <Card>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
            <Big
              label="Ponto de equilíbrio"
              value={formatBRL(b.pontoEquilibrioCents ?? 0)}
              hint="para o resultado zerar"
            />
            <Big
              label="Ponto de equilíbrio de caixa"
              value={formatBRL(b.pontoEquilibrioCaixaCents ?? 0)}
              hint="sem a depreciação"
            />
            <Big
              label="Margem de contribuição"
              value={pct(b.margemPercent)}
              hint={`${formatBRL(b.margemContribuicaoCents)} de cada real`}
            />
            <Big
              label="Margem de segurança"
              value={pct(b.margemSegurancaPercent)}
              danger={(b.margemSegurancaCents ?? 0) < 0}
              hint={
                (b.margemSegurancaCents ?? 0) < 0
                  ? `faltaram ${formatBRL(Math.abs(b.margemSegurancaCents ?? 0))}`
                  : "o quanto pode cair"
              }
            />
          </CardContent>
        </Card>
      )}

      {turnDay !== null && (
        <p className="rounded-lg border bg-muted/30 p-3 text-sm">
          No ritmo do período, o faturamento passou do ponto de equilíbrio por
          volta do <strong>dia {turnDay}</strong> de {days}. É uma régua, não uma
          previsão — o movimento não é igual todo dia —, mas virar no dia 12 ou
          no dia 28 é uma diferença enorme de folga para o mesmo lucro no fim.
        </p>
      )}

      {/* -- A ESTRUTURA -------------------------------------------------- */}
      <Card>
        <CardContent className="p-4">
          <h2 className="pb-1 text-sm font-semibold">A estrutura do período</h2>
          {ROLE_ORDER.map((role) => {
            const rows = b.lines.filter((l) => l.role === role);
            if (rows.length === 0) return null;
            const total = rows.reduce((s, l) => s + l.amountCents, 0);
            const isOpen = openRole === role;
            return (
              <div key={role}>
                <button
                  type="button"
                  onClick={() => setOpenRole(isOpen ? null : role)}
                  className="flex w-full items-baseline justify-between gap-2 border-t py-1.5 text-left text-sm hover:bg-muted/60"
                >
                  <span className="flex items-center gap-1">
                    {isOpen ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                    {ROLE_LABELS[role]}
                  </span>
                  <span className="tabular-nums">{formatBRL(total)}</span>
                </button>
                {isOpen && (
                  <ul className="ml-4 space-y-0.5 rounded-lg border bg-muted/20 p-2 text-[11px]">
                    {rows.map((l) => (
                      <li
                        key={l.accountCode}
                        className="flex justify-between gap-2"
                      >
                        <span>
                          <span className="text-muted-foreground">
                            {l.accountCode}
                          </span>{" "}
                          {l.accountName}
                        </span>
                        <span className="tabular-nums">
                          {formatBRL(l.amountCents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}

          <Row
            label="= Margem de contribuição"
            value={b.margemContribuicaoCents}
            strong
          />
          <Row label="− Custo fixo total" value={-b.custoFixoTotalCents} />
          <Row label="= Resultado" value={b.resultadoCents} strong />

          <p className="pt-2 text-[10px] text-muted-foreground">
            <strong>Variável</strong> é o custo que acompanha o faturamento
            (material, repasse, taxa do cartão, imposto); <strong>fixo</strong> é
            o que existe mesmo com a cadeira vazia. Se alguma conta estiver do
            lado errado, corrija no <strong>Plano de contas</strong> — o número
            aqui muda junto.
          </p>
        </CardContent>
      </Card>

      {/* -- DO LUCRO AO CAIXA -------------------------------------------- */}
      <Card>
        <CardContent className="p-4">
          <h2 className="text-sm font-semibold">Do lucro ao caixa</h2>
          <p className="pb-2 text-[11px] text-muted-foreground">
            Por que o dinheiro que sobrou não é o lucro do período. Cada linha é
            uma diferença de tempo entre o fato e o dinheiro.
          </p>

          <Row label="Lucro do período" value={bridge.lucroCents} strong />

          {bridge.steps.map((s) => {
            const isOpen = openStep === s.key;
            return (
              <div key={s.key}>
                <button
                  type="button"
                  onClick={() => setOpenStep(isOpen ? null : s.key)}
                  className="flex w-full items-baseline justify-between gap-2 border-t py-1.5 text-left text-sm hover:bg-muted/60"
                >
                  <span className="flex items-center gap-1">
                    {isOpen ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                    {s.amountCents >= 0 ? "+ " : "− "}
                    {s.label}
                  </span>
                  <span
                    className={cn(
                      "tabular-nums",
                      s.amountCents < 0 && "text-destructive"
                    )}
                  >
                    {formatBRL(s.amountCents)}
                  </span>
                </button>
                {isOpen && (
                  <ul className="ml-4 space-y-0.5 rounded-lg border bg-muted/20 p-2 text-[11px]">
                    {s.details.map((d) => (
                      <li
                        key={d.accountCode}
                        className="flex justify-between gap-2"
                      >
                        <span>
                          <span className="text-muted-foreground">
                            {d.accountCode}
                          </span>{" "}
                          {d.accountName}
                        </span>
                        <span className="tabular-nums">
                          {formatBRL(d.amountCents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}

          <Row
            label="= Variação do caixa no período"
            value={bridge.caixaCents}
            strong
          />

          {bridge.residualCents !== 0 && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-[11px]">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
              <p>
                Sobrou <strong>{formatBRL(bridge.residualCents)}</strong> sem
                explicação. A ponte fecha por construção, então uma diferença
                aqui significa lançamento fora da classificação — vale avisar.
              </p>
            </div>
          )}

          <p className="pt-2 text-[10px] text-muted-foreground">
            Lucro alto com caixa caindo quase sempre é venda parcelada: o
            resultado reconhece a venda inteira no mês, e o dinheiro chega ao
            longo dos meses seguintes. Não é erro — é o motivo de as duas telas
            existirem.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
