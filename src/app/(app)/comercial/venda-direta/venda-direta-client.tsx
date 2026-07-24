"use client";

import { useState } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { SaleItem, type DirectSaleRow } from "./direct-sale-item";

export type { DirectSaleRow } from "./direct-sale-item";

export function VendaDiretaClient({
  sales,
  showExceptions,
}: {
  sales: DirectSaleRow[];
  showExceptions: boolean;
}) {
  const pending = sales.filter((s) => !s.cancelled && s.status !== "concluida");
  const done = sales.filter((s) => s.status === "concluida");
  const cancelled = sales.filter((s) => s.cancelled);
  const exceptions = sales.filter((s) => s.attendanceDoneBefore && !s.cancelled);

  const totalConcluded = done.reduce((sum, s) => sum + s.finalCents, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Pendências" value={String(pending.length)} amber={pending.length > 0} />
        <Stat label="Concluídas" value={String(done.length)} />
        <Stat label="Total concluído" value={formatBRL(totalConcluded)} />
        <Stat label="Canceladas" value={String(cancelled.length)} />
      </div>

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

      <SaleList
        title="Aguardando / em fechamento"
        sales={pending}
        empty="Nenhuma venda pendente."
      />
      <SaleList
        title="Concluídas"
        sales={done}
        empty="Nenhuma venda concluída no período."
        collapsed
      />
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
