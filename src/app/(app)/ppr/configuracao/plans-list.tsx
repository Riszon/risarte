"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Plus, ToggleLeft, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { createPprPlan, togglePprPlan } from "./actions";

export type PprPlanRow = {
  id: string;
  name: string;
  description: string | null;
  monthly_cents: number;
  allows_dependents: boolean;
  included_dependents: number;
  allows_extra_dependents: boolean;
  extra_dependent_cents: number;
  max_dependents: number | null;
  cash_discount_percent: number;
  max_installments: number;
  min_installment_cents: number;
  is_active: boolean;
  sort_order: number;
  social_enabled: boolean;
};

export function PprPlansList({ plans }: { plans: PprPlanRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);

  function toggle(plan: PprPlanRow) {
    startTransition(async () => {
      const r = await togglePprPlan(plan.id, !plan.is_active);
      if (!r.ok) toast.error(r.error ?? "Não foi possível alterar.");
      else {
        toast.success(plan.is_active ? "Plano desativado." : "Plano ativado.");
        router.refresh();
      }
    });
  }

  function create(form: FormData) {
    startTransition(async () => {
      const r = await createPprPlan(form);
      if (!r.ok) toast.error(r.error ?? "Não foi possível criar.");
      else {
        toast.success("Plano criado. Agora configure os detalhes.");
        setAdding(false);
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">Planos</CardTitle>
          <p className="text-sm text-muted-foreground">
            Clique em um plano para editar valores, vantagens, parcelamento e
            benefícios por procedimento.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
          <Plus className="mr-1 size-3.5" />
          Novo plano
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && (
          <form
            action={create}
            className="grid gap-2 rounded-xl border border-dashed p-3 sm:grid-cols-[1fr_auto_auto]"
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs">
                <span className="text-muted-foreground">Nome do plano</span>
                <Input name="name" placeholder="Ex.: Plano Premium" required />
              </label>
              <label className="text-xs">
                <span className="text-muted-foreground">Mensalidade (R$)</span>
                <Input name="monthly" placeholder="0,00" inputMode="decimal" />
              </label>
              <label className="text-xs sm:col-span-2">
                <span className="text-muted-foreground">Descrição (opcional)</span>
                <Input name="description" placeholder="Uma linha sobre o plano" />
              </label>
            </div>
            <Button type="submit" size="sm" disabled={isPending} className="self-end">
              Criar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="self-end"
              onClick={() => setAdding(false)}
            >
              Cancelar
            </Button>
          </form>
        )}

        {plans.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum plano cadastrado.
          </p>
        ) : (
          <ul className="space-y-2">
            {plans.map((p) => (
              <li
                key={p.id}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3",
                  !p.is_active && "opacity-60"
                )}
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {p.name}
                    {!p.is_active && (
                      <span className="rounded-full border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                        inativo
                      </span>
                    )}
                    {p.social_enabled && (
                      <span className="rounded-full border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] text-gold-foreground">
                        Riso+ Social
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatBRL(p.monthly_cents)}/mês ·{" "}
                    {p.allows_dependents
                      ? `${p.included_dependents} dependente(s) incluído(s)`
                      : "individual"}{" "}
                    · à vista {p.cash_discount_percent}% · até {p.max_installments}×
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => toggle(p)}
                    title={p.is_active ? "Desativar plano" : "Ativar plano"}
                  >
                    {p.is_active ? (
                      <ToggleRight className="size-4 text-emerald-600" />
                    ) : (
                      <ToggleLeft className="size-4" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href={`/ppr/configuracao/${p.id}`} />}
                  >
                    <Pencil className="mr-1 size-3.5" />
                    Editar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
