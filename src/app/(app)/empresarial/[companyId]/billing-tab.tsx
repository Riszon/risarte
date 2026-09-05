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
import { Trash2 } from "lucide-react";
import {
  cancelBilling,
  deleteBilling,
  generateBilling,
  markBillingPaid,
  previewBilling,
  runOverdueCheck,
  updateBilling,
  type BillingPreview,
} from "./billing-actions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";

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
  description?: string | null;
  payerLabel?: string | null;
  cancelReason?: string | null;
};

const STATUS_VARIANT: Record<string, "secondary" | "destructive" | "outline"> = {
  PENDING: "outline",
  PAID: "secondary",
  OVERDUE: "destructive",
  CANCELLED: "outline",
};

const STATUS_LABEL: Record<string, string> = {
  ...BILLING_STATUS_LABELS,
  CANCELLED: "Cancelada",
};

function dateBR(iso: string | null): string {
  return iso ? new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE }) : "—";
}

export function BillingTab({
  companyId,
  companyStatus,
  billings,
  asaasConfigured,
  isAdminMaster = false,
}: {
  companyId: string;
  companyStatus: string;
  billings: BillingView[];
  asaasConfigured: boolean;
  /** Só o Admin Master pode EXCLUIR uma cobrança (limpeza de teste). */
  isAdminMaster?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Confirmação antes de gerar: mostra valor, vencimento, pagador e a que se refere.
  const [preview, setPreview] = useState<BillingPreview | null>(null);
  const [previewType, setPreviewType] =
    useState<"MONTHLY" | "IMPLANTATION">("MONTHLY");
  const [loadingPreview, setLoadingPreview] = useState(false);

  function openPreview(type: "MONTHLY" | "IMPLANTATION") {
    setPreviewType(type);
    setLoadingPreview(true);
    startTransition(async () => {
      const p = await previewBilling(companyId, type);
      setLoadingPreview(false);
      if (!p.ok) {
        toast.error(p.error ?? "Não foi possível calcular a cobrança.");
        return;
      }
      setPreview(p);
    });
  }

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
            disabled={isPending || loadingPreview}
            onClick={() => openPreview("MONTHLY")}
          >
            {loadingPreview ? "Calculando..." : "Gerar cobrança mensal"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending || loadingPreview}
            onClick={() => openPreview("IMPLANTATION")}
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
                <th className="px-3 py-2 font-medium">Pagador</th>
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
                  <td className="px-3 py-2">
                    {BILLING_TYPE_LABELS[b.billingType]}
                    {b.description && (
                      <span className="block text-[10px] text-muted-foreground">
                        {b.description}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {b.payerLabel ?? "Empresa (consolidado)"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {b.referenceMonth
                      ? new Date(b.referenceMonth + "T00:00:00").toLocaleDateString(
                          "pt-BR",
                          { timeZone: BRAZIL_TIME_ZONE, month: "2-digit", year: "numeric" }
                        )
                      : "—"}
                  </td>
                  <td className="px-3 py-2 font-medium">{formatBRL(b.totalCents)}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {b.dueDate
                      ? new Date(b.dueDate + "T00:00:00").toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE })
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={STATUS_VARIANT[b.status] ?? "outline"}>
                      {STATUS_LABEL[b.status] ?? b.status}
                    </Badge>
                    {b.status === "CANCELLED" && b.cancelReason && (
                      <span
                        className="block text-[10px] text-muted-foreground"
                        title={b.cancelReason}
                      >
                        {b.cancelReason}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {b.status === "PAID" && b.splitRisarteCents != null
                      ? `${formatBRL(b.splitRisarteCents)} / ${formatBRL(b.splitRislifeCents ?? 0)}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap items-center justify-end gap-1">
                    {b.status !== "PAID" && b.status !== "CANCELLED" && (
                      <>
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
                        <EditBillingDialog companyId={companyId} billing={b} />
                        <CancelBillingDialog companyId={companyId} billing={b} />
                      </>
                    )}
                    {isAdminMaster && (
                      <DeleteBillingDialog companyId={companyId} billing={b} />
                    )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirmação antes de gerar: o que será cobrado, de quem e quando. */}
      <Dialog open={preview !== null} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirmar a cobrança</DialogTitle>
          </DialogHeader>
          {preview?.items && (
            <div className="space-y-3">
              <div className="rounded-lg border p-3 text-sm">
                <p className="mb-1.5 text-xs uppercase text-muted-foreground">
                  Refere-se a
                </p>
                <p className="font-medium">{preview.description}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <p>
                    <span className="text-muted-foreground">Vencimento: </span>
                    <strong>{dateBR(preview.dueDate ?? null)}</strong>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Beneficiário: </span>
                    <strong>{preview.beneficiary}</strong>
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs uppercase text-muted-foreground">
                  {preview.items.length > 1
                    ? `${preview.items.length} boletos (um por documento)`
                    : "Pagador"}
                </p>
                {preview.items.map((i, idx) => (
                  <div
                    key={idx}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-sm"
                  >
                    <div>
                      <p className="font-medium">{i.payerName}</p>
                      <p className="text-xs text-muted-foreground">
                        {i.payerDoc} · {i.employees} colaborador(es)
                      </p>
                    </div>
                    <p className="text-lg font-semibold text-gold">
                      {formatBRL(i.totalCents)}
                    </p>
                  </div>
                ))}
              </div>

              {preview.items.length > 1 && (
                <p className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
                  <span className="font-medium">Total</span>
                  <span className="font-semibold">
                    {formatBRL(
                      preview.items.reduce((a, i) => a + i.totalCents, 0)
                    )}
                  </span>
                </p>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setPreview(null)}
                  disabled={isPending}
                >
                  Cancelar
                </Button>
                <Button
                  disabled={isPending}
                  onClick={() => {
                    setPreview(null);
                    run(
                      async () => generateBilling(companyId, previewType),
                      preview.items && preview.items.length > 1
                        ? `${preview.items.length} cobranças geradas.`
                        : "Cobrança gerada."
                    );
                  }}
                >
                  Confirmar e gerar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Editar uma cobrança ainda não paga (valor, vencimento, descrição). */
function EditBillingDialog({
  companyId,
  billing,
}: {
  companyId: string;
  billing: BillingView;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updateBilling(companyId, billing.id, formData);
      if (r.ok) {
        toast.success("Cobrança atualizada.");
        setOpen(false);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => setOpen(true)}
      >
        Editar
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar cobrança</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bill_total">Valor (R$)</Label>
              <Input
                id="bill_total"
                name="total"
                required
                defaultValue={(billing.totalCents / 100)
                  .toFixed(2)
                  .replace(".", ",")}
              />
            </div>
            <div>
              <Label htmlFor="bill_due">Vencimento</Label>
              <Input
                id="bill_due"
                name="due_date"
                type="date"
                required
                defaultValue={billing.dueDate ?? ""}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="bill_desc">Refere-se a</Label>
            <Input
              id="bill_desc"
              name="description"
              defaultValue={billing.description ?? ""}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              Salvar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Excluir a cobrança de vez (Admin Master). Diferente de cancelar, que fica no
 * histórico — usar para limpar cobranças de TESTE.
 */
function DeleteBillingDialog({
  companyId,
  billing,
}: {
  companyId: string;
  billing: BillingView;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-destructive"
        title="Excluir a cobrança (Admin Master)"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-3.5" />
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Excluir esta cobrança?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            {BILLING_TYPE_LABELS[billing.billingType]} ·{" "}
            <strong>{formatBRL(billing.totalCents)}</strong> · vencimento{" "}
            {dateBR(billing.dueDate)}
          </p>
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
            A cobrança é <strong>apagada</strong> e não aparece em relatório
            nenhum. Para manter no histórico, use <strong>Cancelar</strong> em vez
            de excluir.
            {billing.status === "PAID" && (
              <span className="mt-1 block font-medium">
                Atenção: esta cobrança está PAGA — o registro do split será
                perdido junto.
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            A exclusão fica registrada na auditoria (quem, quando e o valor).
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const r = await deleteBilling(companyId, billing.id);
                  if (r.ok) {
                    toast.success("Cobrança excluída.");
                    setOpen(false);
                    router.refresh();
                  } else toast.error(r.error ?? "Erro.");
                })
              }
            >
              Excluir
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Cancelar a cobrança — motivo obrigatório. */
function CancelBillingDialog({
  companyId,
  billing,
}: {
  companyId: string;
  billing: BillingView;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-destructive"
        onClick={() => setOpen(true)}
      >
        Cancelar
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar cobrança</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {formatBRL(billing.totalCents)} · vencimento{" "}
            {dateBR(billing.dueDate)}. A cobrança fica no histórico como
            cancelada.
          </p>
          <div>
            <Label htmlFor="cancel_reason">Motivo *</Label>
            <Input
              id="cancel_reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: valor incorreto, empresa renegociou"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={isPending || !reason.trim()}
              onClick={() =>
                startTransition(async () => {
                  const r = await cancelBilling(companyId, billing.id, reason);
                  if (r.ok) {
                    toast.success("Cobrança cancelada.");
                    setOpen(false);
                    setReason("");
                    router.refresh();
                  } else toast.error(r.error ?? "Erro.");
                })
              }
            >
              Cancelar cobrança
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
