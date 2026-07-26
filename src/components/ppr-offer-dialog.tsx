"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { HeartPulse, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import {
  PPR_RECURRING_METHODS,
  PPR_RECURRING_METHOD_LABELS,
  PPR_RELATIONSHIPS,
  PPR_STATUS_LABELS,
  type PprRecurringMethod,
  type PprSaleOrigin,
} from "@/lib/ppr/constants";
import type { PprOfferContext, PprOfferPlan } from "@/lib/ppr/offer-loader";
import { createPprMembership } from "@/app/(app)/ppr/actions";

const selectClass =
  "mt-0.5 h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

type DependentDraft = {
  fullName: string;
  cpf: string;
  birthDate: string;
  relationship: string;
};

/**
 * Botão "Oferecer PPR+" — vende o programa dentro do fluxo comercial ou da
 * venda direta. Mostra o selo quando o cliente já participa.
 */
export function PprOfferButton({
  clientId,
  clientName,
  clinicId,
  origin,
  context,
  size = "sm",
}: {
  clientId: string;
  clientName: string;
  clinicId: string;
  origin: PprSaleOrigin;
  context: PprOfferContext;
  size?: "sm" | "default";
}) {
  const { canSell, plans, membership } = context;

  if (membership) {
    return (
      <Button
        size={size}
        variant="outline"
        nativeButton={false}
        render={<Link href={`/ppr/adesoes/${membership.id}`} />}
        className="border-gold/50 text-gold-foreground"
      >
        <HeartPulse className="mr-1 size-3.5" />
        PPR+ {membership.planName} · {PPR_STATUS_LABELS[membership.status]}
      </Button>
    );
  }
  if (!canSell || plans.length === 0) return null;

  return (
    <PprOfferDialog
      clientId={clientId}
      clientName={clientName}
      clinicId={clinicId}
      origin={origin}
      plans={plans}
      size={size}
    />
  );
}

function PprOfferDialog({
  clientId,
  clientName,
  clinicId,
  origin,
  plans,
  size,
}: {
  clientId: string;
  clientName: string;
  clinicId: string;
  origin: PprSaleOrigin;
  plans: PprOfferPlan[];
  size: "sm" | "default";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [dependents, setDependents] = useState<DependentDraft[]>([]);
  const [method, setMethod] = useState<PprRecurringMethod>("credito_recorrente");
  const [billingDay, setBillingDay] = useState("10");

  const plan = plans.find((p) => p.id === planId) ?? plans[0];
  const maxDeps = plan?.allowsDependents
    ? plan.allowsExtraDependents
      ? (plan.maxDependents ?? 99)
      : plan.includedDependents
    : 0;
  const extras = plan
    ? Math.max(0, dependents.length - plan.includedDependents)
    : 0;
  const monthly = plan
    ? plan.monthlyCents + extras * plan.extraDependentCents
    : 0;

  function pickPlan(id: string) {
    setPlanId(id);
    const p = plans.find((x) => x.id === id);
    if (!p?.allowsDependents) setDependents([]);
  }

  function addDependent() {
    setDependents((d) => [
      ...d,
      { fullName: "", cpf: "", birthDate: "", relationship: "Filho(a)" },
    ]);
  }
  function setDep(i: number, patch: Partial<DependentDraft>) {
    setDependents((d) => d.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }

  function submit() {
    if (!plan) return;
    const filled = dependents.filter((d) => d.fullName.trim());
    if (filled.length !== dependents.length) {
      toast.error("Informe o nome de todos os dependentes.");
      return;
    }
    startTransition(async () => {
      const r = await createPprMembership({
        clinicId,
        planId: plan.id,
        holderClientId: clientId,
        origin,
        paymentMethod: method,
        billingDay: Number.parseInt(billingDay, 10) || 10,
        dependents: filled.map((d) => ({
          fullName: d.fullName.trim(),
          cpf: d.cpf,
          birthDate: d.birthDate,
          relationship: d.relationship,
        })),
      });
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível registrar a adesão.");
        return;
      }
      toast.success("Adesão registrada! Falta o contrato e a 1ª mensalidade.");
      setOpen(false);
      if (r.membershipId) router.push(`/ppr/adesoes/${r.membershipId}`);
      else router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size={size} variant="outline" className="border-gold/50">
            <HeartPulse className="mr-1 size-3.5 text-gold-foreground" />
            Oferecer PPR+
          </Button>
        }
      />
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Oferecer o PPR+ para {clientName}</DialogTitle>
          <DialogDescription>
            Programa de Prevenção Riso+ — mensalidade recorrente com consultas,
            radiografias e limpeza incluídas.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto">
          {/* Planos ------------------------------------------------------- */}
          <div className="grid gap-2 sm:grid-cols-2">
            {plans.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => pickPlan(p.id)}
                className={cn(
                  "rounded-xl border p-3 text-left transition-colors",
                  p.id === planId
                    ? "border-gold bg-gold/5 ring-1 ring-gold/40"
                    : "hover:bg-muted/40"
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatBRL(p.monthlyCents)}
                    <span className="text-[10px] font-normal text-muted-foreground">
                      /mês
                    </span>
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {p.allowsDependents
                    ? `1 titular + ${p.includedDependents} dependente(s)`
                    : "Adesão individual"}
                  {p.allowsExtraDependents &&
                    ` · extra ${formatBRL(p.extraDependentCents)}`}
                </p>
                {p.id === planId && p.perks.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {p.perks.map((k) => (
                      <li
                        key={k}
                        className="flex items-start gap-1 text-[11px] text-muted-foreground"
                      >
                        <span
                          className="mt-1.5 size-1 shrink-0 rounded-full bg-gold"
                          aria-hidden
                        />
                        {k}
                      </li>
                    ))}
                  </ul>
                )}
              </button>
            ))}
          </div>

          {/* Dependentes -------------------------------------------------- */}
          {plan?.allowsDependents && (
            <div className="rounded-xl border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Dependentes</p>
                  <p className="text-[11px] text-muted-foreground">
                    Até {maxDeps === 99 ? "sem limite" : maxDeps} ·{" "}
                    {plan.includedDependents} incluído(s) no valor
                    {plan.allowsExtraDependents &&
                      `, extras a ${formatBRL(plan.extraDependentCents)} cada`}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={dependents.length >= maxDeps}
                  onClick={addDependent}
                >
                  <Plus className="mr-1 size-3.5" />
                  Incluir
                </Button>
              </div>

              {dependents.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {dependents.map((d, i) => (
                    <li key={i} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-2">
                      <label className="text-xs sm:col-span-2">
                        <span className="text-muted-foreground">Nome completo</span>
                        <Input
                          value={d.fullName}
                          onChange={(e) => setDep(i, { fullName: e.target.value })}
                          placeholder="Nome do dependente"
                        />
                      </label>
                      <label className="text-xs">
                        <span className="text-muted-foreground">
                          CPF (opcional para menor)
                        </span>
                        <Input
                          value={d.cpf}
                          onChange={(e) => setDep(i, { cpf: e.target.value })}
                          inputMode="numeric"
                        />
                      </label>
                      <label className="text-xs">
                        <span className="text-muted-foreground">Nascimento</span>
                        <Input
                          type="date"
                          value={d.birthDate}
                          onChange={(e) => setDep(i, { birthDate: e.target.value })}
                        />
                      </label>
                      <label className="text-xs">
                        <span className="text-muted-foreground">Parentesco</span>
                        <select
                          value={d.relationship}
                          onChange={(e) =>
                            setDep(i, { relationship: e.target.value })
                          }
                          className={selectClass}
                        >
                          {PPR_RELATIONSHIPS.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="flex items-end justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setDependents((list) =>
                              list.filter((_, idx) => idx !== i)
                            )
                          }
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                Cada dependente ganha prontuário próprio nesta unidade. Se o CPF
                já for de um cliente da rede, o sistema usa o cadastro existente.
              </p>
            </div>
          )}

          {/* Pagamento ---------------------------------------------------- */}
          <div className="grid gap-3 rounded-xl border p-3 sm:grid-cols-2">
            <label className="text-xs">
              <span className="text-muted-foreground">
                Pagamento da mensalidade
              </span>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as PprRecurringMethod)}
                className={selectClass}
              >
                {PPR_RECURRING_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PPR_RECURRING_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">Dia da cobrança</span>
              <Input
                type="number"
                min={1}
                max={28}
                value={billingDay}
                onChange={(e) => setBillingDay(e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <div>
            <p className="text-xs text-muted-foreground">Mensalidade</p>
            <p className="text-xl font-semibold tabular-nums">
              {formatBRL(monthly)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                /mês
              </span>
            </p>
            {extras > 0 && (
              <p className="text-[11px] text-muted-foreground">
                inclui {extras} dependente(s) extra(s)
              </p>
            )}
          </div>
          <Button onClick={submit} disabled={isPending || !plan}>
            {isPending ? "Registrando..." : "Registrar adesão"}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          A adesão só fica <strong>ativa</strong> com o contrato assinado e a
          primeira mensalidade confirmada.
        </p>
      </DialogContent>
    </Dialog>
  );
}
