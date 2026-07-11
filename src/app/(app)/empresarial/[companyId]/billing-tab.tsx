"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatBRL } from "@/lib/pricing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  BILLING_STATUS_LABELS,
  BILLING_TYPE_LABELS,
  type BillingStatus,
  type BillingType,
} from "@/lib/empresarial/constants";
import {
  generateBilling,
  markBillingPaid,
  runOverdueCheck,
} from "./billing-actions";

export type BillingView = {
  id: string;
  billingType: BillingType;
  referenceMonth: string | null;
  totalCents: number;
  status: BillingStatus;
  dueDate: string | null;
  paidAt: string | null;
  splitRisarteCents: number | null;
  splitRislifeCents: number | null;
};

const STATUS_VARIANT: Record<BillingStatus, "secondary" | "destructive" | "outline"> = {
  PENDING: "outline",
  PAID: "secondary",
  OVERDUE: "destructive",
};

export function BillingTab({
  companyId,
  companyStatus,
  billings,
  asaasConfigured,
}: {
  companyId: string;
  companyStatus: string;
  billings: BillingView[];
  asaasConfigured: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string }>, msg: string) {
    startTransition(async () => {
      const r = await action();
      if (r.ok) {
        toast.success(msg);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <div className="space-y-4">
      {companyStatus === "SUSPENDED" && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Empresa <strong>suspensa</strong> por inadimplência. Os benefícios do
          programa estão bloqueados para novos orçamentos até a regularização.
        </div>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          <Button
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(
                async () => generateBilling(companyId, "MONTHLY"),
                "Cobrança mensal gerada."
              )
            }
          >
            Gerar cobrança mensal
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              run(
                async () => generateBilling(companyId, "IMPLANTATION"),
                "Cobrança de implantação gerada."
              )
            }
          >
            Gerar implantação
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() =>
              run(
                async () => runOverdueCheck(companyId),
                "Inadimplência verificada."
              )
            }
          >
            Checar inadimplência
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {asaasConfigured
              ? "ASAAS conectado."
              : "ASAAS não conectado — use a baixa manual para testar."}
          </span>
        </CardContent>
      </Card>

      {billings.length === 0 ? (
        <p className="rounded-lg border py-8 text-center text-sm text-muted-foreground">
          Nenhuma cobrança gerada ainda.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Referência</th>
                <th className="px-3 py-2 font-medium">Valor</th>
                <th className="px-3 py-2 font-medium">Vencimento</th>
                <th className="px-3 py-2 font-medium">Situação</th>
                <th className="px-3 py-2 font-medium">Split (R/RL)</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {billings.map((b) => (
                <tr key={b.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{BILLING_TYPE_LABELS[b.billingType]}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {b.referenceMonth
                      ? new Date(b.referenceMonth + "T00:00:00").toLocaleDateString(
                          "pt-BR",
                          { month: "2-digit", year: "numeric" }
                        )
                      : "—"}
                  </td>
                  <td className="px-3 py-2 font-medium">{formatBRL(b.totalCents)}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {b.dueDate
                      ? new Date(b.dueDate + "T00:00:00").toLocaleDateString("pt-BR")
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={STATUS_VARIANT[b.status]}>
                      {BILLING_STATUS_LABELS[b.status]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {b.status === "PAID" && b.splitRisarteCents != null
                      ? `${formatBRL(b.splitRisarteCents)} / ${formatBRL(b.splitRislifeCents ?? 0)}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {b.status !== "PAID" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={isPending}
                        onClick={() =>
                          run(
                            async () => markBillingPaid(companyId, b.id),
                            "Pagamento registrado (split gravado)."
                          )
                        }
                      >
                        Marcar pago
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
