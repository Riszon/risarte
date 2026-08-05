"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarSync, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import type { ChartAccount } from "@/lib/finance/accounts";
import { generateRecurringPayables, saveRecurrence } from "../payables-actions";

export type RecurrenceRow = {
  id: string;
  supplierId: string | null;
  supplierName: string | null;
  accountCode: string;
  accountName: string | null;
  costCenterId: string | null;
  description: string;
  amountCents: number;
  dueDay: number;
  startMonth: string;
  endMonth: string | null;
  active: boolean;
};

const EMPTY: RecurrenceRow = {
  id: "",
  supplierId: null,
  supplierName: null,
  accountCode: "",
  accountName: null,
  costCenterId: null,
  description: "",
  amountCents: 0,
  dueDay: 10,
  startMonth: "",
  endMonth: null,
  active: true,
};

function monthLabel(iso: string): string {
  const [y, m] = iso.split("-");
  return `${m}/${y}`;
}

/**
 * FIN3 — despesas recorrentes: aluguel, software, contabilidade. Cadastra uma
 * vez com o dia do vencimento; o botão gera as contas do mês. A mesma
 * recorrência nunca gera duas contas para a mesma competência (índice único no
 * banco), então clicar de novo é seguro.
 */
export function RecurrencesDialog({
  open,
  onOpenChange,
  clinicId,
  recurrences,
  suppliers,
  accounts,
  costCenters,
  today,
  canEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clinicId: string;
  recurrences: RecurrenceRow[];
  suppliers: { id: string; name: string }[];
  accounts: ChartAccount[];
  costCenters: { id: string; name: string }[];
  today: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<RecurrenceRow | null>(null);
  const [amount, setAmount] = useState("");
  const [month, setMonth] = useState(today.slice(0, 7));

  function openForm(r: RecurrenceRow) {
    setEditing({
      ...r,
      startMonth: r.startMonth || today.slice(0, 7) + "-01",
    });
    setAmount(
      r.amountCents ? (r.amountCents / 100).toFixed(2).replace(".", ",") : ""
    );
  }

  function save() {
    if (!editing) return;
    startTransition(async () => {
      const r = await saveRecurrence({
        id: editing.id || null,
        clinicId,
        supplierId: editing.supplierId,
        accountCode: editing.accountCode,
        costCenterId: editing.costCenterId,
        description: editing.description,
        amountCents: parseBRLToCents(amount) ?? 0,
        dueDay: editing.dueDay,
        startMonth: editing.startMonth,
        endMonth: editing.endMonth,
        active: editing.active,
      });
      if (r.ok) {
        toast.success("Despesa recorrente salva.");
        setEditing(null);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function generate() {
    startTransition(async () => {
      const r = await generateRecurringPayables({
        clinicId,
        month: `${month}-01`,
      });
      if (r.ok) {
        toast.success(
          r.created === 0
            ? "Nenhuma conta nova — as deste mês já estavam geradas."
            : r.created === 1
              ? "1 conta gerada."
              : `${r.created} contas geradas.`
        );
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Despesas recorrentes</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Aluguel, software, contabilidade: cadastra uma vez e o sistema gera a
          conta do mês. A mesma despesa nunca gera duas contas para o mesmo mês
          — clicar em gerar de novo é seguro.
        </p>

        {/* Gerar as contas do mês. */}
        <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
          <label className="block">
            <Label className="text-[11px]">Mês</Label>
            <Input
              className="h-9"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
          <Button
            size="sm"
            className="h-9"
            disabled={isPending || !canEdit}
            onClick={generate}
          >
            <CalendarSync className="mr-1 size-4" />
            Gerar contas de {monthLabel(`${month}-01`)}
          </Button>
        </div>

        {/* Lista. */}
        <ul className="space-y-1 text-xs">
          {recurrences.length === 0 && (
            <li className="rounded-lg border p-2 text-muted-foreground">
              Nenhuma despesa recorrente cadastrada.
            </li>
          )}
          {recurrences.map((r) => (
            <li
              key={r.id}
              className={cn(
                "flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2",
                !r.active && "opacity-60"
              )}
            >
              <span className="min-w-0 flex-1">
                <strong>{r.description}</strong>
                <span className="block text-[11px] text-muted-foreground">
                  {r.accountCode} {r.accountName}
                  {r.supplierName && ` · ${r.supplierName}`} · todo dia{" "}
                  {r.dueDay} · desde {monthLabel(r.startMonth)}
                  {r.endMonth && ` até ${monthLabel(r.endMonth)}`}
                </span>
              </span>
              <span className="tabular-nums">{formatBRL(r.amountCents)}</span>
              {!r.active && (
                <Badge variant="outline" className="text-[10px]">
                  Inativa
                </Badge>
              )}
              {canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px]"
                  onClick={() => openForm(r)}
                >
                  Editar
                </Button>
              )}
            </li>
          ))}
        </ul>

        {canEdit && !editing && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => openForm({ ...EMPTY })}
          >
            <Plus className="mr-1 size-4" />
            Nova despesa recorrente
          </Button>
        )}

        {/* Formulário. */}
        {editing && (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-xs font-semibold">
              {editing.id ? "Editar" : "Nova"} despesa recorrente
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <Label className="text-[11px]">Descrição</Label>
                <Input
                  className="h-9"
                  value={editing.description}
                  onChange={(e) =>
                    setEditing({ ...editing, description: e.target.value })
                  }
                  placeholder="Ex.: aluguel da unidade"
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Conta</Label>
                <select
                  value={editing.accountCode}
                  onChange={(e) =>
                    setEditing({ ...editing, accountCode: e.target.value })
                  }
                  className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                >
                  <option value="">— escolha —</option>
                  {accounts.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <Label className="text-[11px]">Fornecedor</Label>
                <select
                  value={editing.supplierId ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      supplierId: e.target.value || null,
                    })
                  }
                  className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                >
                  <option value="">— sem fornecedor —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <Label className="text-[11px]">Centro de custo</Label>
                <select
                  value={editing.costCenterId ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      costCenterId: e.target.value || null,
                    })
                  }
                  className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                >
                  <option value="">— sem centro —</option>
                  {costCenters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <Label className="text-[11px]">Valor (R$)</Label>
                <Input
                  className="h-9"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Vence todo dia</Label>
                <Input
                  className="h-9"
                  type="number"
                  min={1}
                  max={31}
                  value={editing.dueDay}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      dueDay: Number(e.target.value) || 1,
                    })
                  }
                />
                <span className="text-[10px] text-muted-foreground">
                  Dia 31 em mês curto cai no último dia.
                </span>
              </label>
              <label className="block">
                <Label className="text-[11px]">A partir de</Label>
                <Input
                  className="h-9"
                  type="month"
                  value={editing.startMonth.slice(0, 7)}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      startMonth: `${e.target.value}-01`,
                    })
                  }
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Até (opcional)</Label>
                <Input
                  className="h-9"
                  type="month"
                  value={editing.endMonth?.slice(0, 7) ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      endMonth: e.target.value ? `${e.target.value}-01` : null,
                    })
                  }
                />
              </label>
              <label className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={editing.active}
                  onChange={(e) =>
                    setEditing({ ...editing, active: e.target.checked })
                  }
                />
                <span className="text-xs">
                  Ativa (desmarque para parar de gerar)
                </span>
              </label>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={isPending} onClick={save}>
                Salvar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(null)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
