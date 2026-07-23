"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  CircleDot,
  Settings2,
  ShoppingCart,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";

/** Centavos → "1234,56" para preencher o campo de valor. */
function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from "@/lib/commercial";
import {
  createDirectSale,
  markDirectSale,
  setProcedureDirectSale,
} from "./actions";

export type SaleProcedure = { id: string; name: string; priceCents: number };
export type DirectSaleRow = {
  id: string;
  clientName: string | null;
  description: string;
  valueCents: number;
  paymentMethod: PaymentMethod | null;
  paid: boolean;
  paidByName: string | null;
  launched: boolean;
  launchedByName: string | null;
  cancelled: boolean;
  createdByName: string | null;
  createdAt: string;
};

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

export function VendaDiretaClient({
  canManage,
  isAdmin,
  procedures,
  sales,
  allProcedures,
}: {
  canManage: boolean;
  isAdmin: boolean;
  procedures: SaleProcedure[];
  sales: DirectSaleRow[];
  allProcedures: { id: string; name: string; directSale: boolean }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [clientName, setClientName] = useState("");
  const [procedureId, setProcedureId] = useState("");
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [showConfig, setShowConfig] = useState(false);

  function pickProcedure(id: string) {
    setProcedureId(id);
    const p = procedures.find((x) => x.id === id);
    if (p) {
      setDescription(p.name);
      if (p.priceCents > 0) setValue(centsToInput(p.priceCents));
    }
  }

  function submit() {
    startTransition(async () => {
      const r = await createDirectSale({
        clientName,
        procedureId,
        description,
        value,
        paymentMethod,
        notes,
      });
      if (r.ok) {
        toast.success("Venda direta registrada.");
        setClientName("");
        setProcedureId("");
        setDescription("");
        setValue("");
        setPaymentMethod("");
        setNotes("");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function mark(id: string, field: "paid" | "launched" | "cancelled", v: boolean) {
    startTransition(async () => {
      const r = await markDirectSale(id, field, v);
      if (r.ok) router.refresh();
      else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function toggleProc(id: string, v: boolean) {
    startTransition(async () => {
      const r = await setProcedureDirectSale(id, v);
      if (r.ok) router.refresh();
      else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <div className="space-y-4">
      {/* Nova venda direta. */}
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-base">
              <ShoppingCart className="size-4" />
              Nova venda direta
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">
                  Cliente (opcional)
                </span>
                <Input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Nome do cliente / avulso"
                />
              </label>
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">
                  Procedimento
                </span>
                <select
                  value={procedureId}
                  onChange={(e) => pickProcedure(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Escolher da lista...</option>
                  {procedures.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.priceCents > 0 ? ` — ${formatBRL(p.priceCents)}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">Descrição</span>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex.: limpeza, urgência, restauração..."
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">Valor</span>
                <Input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  inputMode="decimal"
                  placeholder="R$ 0,00"
                />
              </label>
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">Pagamento</span>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Escolher...</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">
                Observações (opcional)
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1 min-h-14 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
              />
            </label>
            <Button disabled={isPending} onClick={submit}>
              Registrar venda direta
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Configuração da lista (Admin). */}
      {isAdmin && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <Settings2 className="size-4" />
              Procedimentos vendáveis (lista configurável)
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowConfig((v) => !v)}
            >
              {showConfig ? "Ocultar" : "Configurar"}
            </Button>
          </CardHeader>
          {showConfig && (
            <CardContent>
              <p className="mb-2 text-xs text-muted-foreground">
                Marque quais procedimentos podem ser vendidos direto na clínica.
              </p>
              <div className="grid gap-1 sm:grid-cols-2">
                {allProcedures.map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={p.directSale}
                      disabled={isPending}
                      onChange={(e) => toggleProc(p.id, e.target.checked)}
                    />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  </label>
                ))}
                {allProcedures.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Nenhum procedimento cadastrado.
                  </p>
                )}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Vendas registradas. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-base">
            <Wallet className="size-4" />
            Vendas diretas registradas
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sales.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nenhuma venda direta registrada ainda.
            </p>
          ) : (
            <ul className="space-y-2">
              {sales.map((s) => (
                <li
                  key={s.id}
                  className={cn(
                    "rounded-lg border p-3 text-sm",
                    s.cancelled && "opacity-60"
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {s.description}
                        {s.cancelled && (
                          <span className="ml-2 text-xs text-rose-600">
                            (cancelada)
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.clientName ? `${s.clientName} · ` : ""}
                        {new Date(s.createdAt).toLocaleDateString("pt-BR")}
                        {s.createdByName ? ` · por ${s.createdByName}` : ""}
                        {s.paymentMethod
                          ? ` · ${PAYMENT_METHOD_LABELS[s.paymentMethod]}`
                          : ""}
                      </p>
                    </div>
                    <span className="text-base font-semibold tabular-nums">
                      {formatBRL(s.valueCents)}
                    </span>
                  </div>
                  {canManage && !s.cancelled && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StepButton
                        label="Pagamento (recepção)"
                        done={s.paid}
                        byName={s.paidByName}
                        disabled={isPending}
                        onToggle={(v) => mark(s.id, "paid", v)}
                      />
                      <StepButton
                        label="Lançar procedimento (coordenador)"
                        done={s.launched}
                        byName={s.launchedByName}
                        disabled={isPending}
                        onToggle={(v) => mark(s.id, "launched", v)}
                      />
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => mark(s.id, "cancelled", true)}
                        className="ml-auto text-xs text-rose-600 hover:underline"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StepButton({
  label,
  done,
  byName,
  disabled,
  onToggle,
}: {
  label: string;
  done: boolean;
  byName: string | null;
  disabled: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onToggle(!done)}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
        done
          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
          : "hover:bg-muted"
      )}
      title={byName ? `por ${byName}` : undefined}
    >
      {done ? (
        <CheckCircle2 className="size-3.5" />
      ) : (
        <CircleDot className="size-3.5 text-muted-foreground" />
      )}
      {label}
    </button>
  );
}
