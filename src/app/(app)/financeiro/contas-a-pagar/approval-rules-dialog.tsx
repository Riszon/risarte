"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import type { ChartAccount } from "@/lib/finance/accounts";
import {
  APPROVAL_MODES,
  APPROVAL_MODE_HELP,
  APPROVAL_MODE_LABELS,
  type ApprovalMode,
  type ApprovalRule,
} from "@/lib/finance/payables";
import { deleteApprovalRule, saveApprovalRule } from "../payables-actions";

/**
 * FIN3 — a alçada das contas a pagar, no padrão cascata da rede.
 * A linha "todas as contas" é o padrão geral; a linha por conta sobrescreve.
 */
export function ApprovalRulesDialog({
  open,
  onOpenChange,
  clinicId,
  accounts,
  rules,
  canConfigureNetwork,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clinicId: string;
  accounts: ChartAccount[];
  rules: ApprovalRule[];
  canConfigureNetwork: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // A Franqueadora escolhe se está editando o padrão da rede ou a unidade.
  const [scope, setScope] = useState<"network" | "unit">(
    canConfigureNetwork ? "network" : "unit"
  );
  const [accountCode, setAccountCode] = useState("");
  const [mode, setMode] = useState<ApprovalMode>("sem_autorizacao");
  const [threshold, setThreshold] = useState("");

  const targetClinicId = scope === "network" ? null : clinicId;
  const visible = rules.filter((r) =>
    scope === "network" ? r.clinicId === null : r.clinicId === clinicId
  );

  function save() {
    startTransition(async () => {
      const cents = parseBRLToCents(threshold);
      const r = await saveApprovalRule({
        clinicId: targetClinicId,
        accountCode: accountCode || null,
        mode,
        thresholdCents: cents && cents > 0 ? cents : null,
      });
      if (r.ok) {
        toast.success("Regra salva.");
        setAccountCode("");
        setThreshold("");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function remove(code: string) {
    startTransition(async () => {
      const r = await deleteApprovalRule({
        clinicId: targetClinicId,
        accountCode: code,
      });
      if (r.ok) {
        toast.success("Regra removida.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Alçada das contas a pagar</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Cada conta do plano de contas tem um modo. A linha{" "}
          <strong>todas as contas</strong> é o padrão; a linha de uma conta
          específica manda mais que ela. Quem lançou nunca autoriza a própria
          conta.
        </p>

        {canConfigureNetwork && (
          <div className="flex gap-1">
            {(
              [
                ["network", "Padrão da rede"],
                ["unit", "Esta unidade"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setScope(key)}
                className={
                  scope === key
                    ? "rounded-full border border-primary bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground"
                    : "rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground"
                }
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Regras já definidas. */}
        <ul className="space-y-1 text-xs">
          {visible.length === 0 && (
            <li className="rounded-lg border p-2 text-muted-foreground">
              Nenhuma regra {scope === "network" ? "da rede" : "desta unidade"}.
            </li>
          )}
          {visible
            .slice()
            .sort((a, b) =>
              (a.accountCode ?? "").localeCompare(b.accountCode ?? "")
            )
            .map((r) => (
              <li
                key={r.accountCode ?? "geral"}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2"
              >
                <span>
                  <strong>
                    {r.accountCode
                      ? `${r.accountCode} · ${accounts.find((a) => a.code === r.accountCode)?.name ?? ""}`
                      : "Todas as contas (padrão)"}
                  </strong>
                  <span className="block text-[11px] text-muted-foreground">
                    {APPROVAL_MODE_LABELS[r.mode]}
                    {r.mode !== "automatica" &&
                      r.thresholdCents !== null &&
                      ` · teto ${formatBRL(r.thresholdCents)}`}
                  </span>
                </span>
                {r.accountCode && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() => remove(r.accountCode!)}
                    title="Remover regra (volta a valer o padrão)"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </li>
            ))}
        </ul>

        {/* Nova regra. */}
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-xs font-semibold">Definir regra</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <Label className="text-[11px]">Conta</Label>
              <select
                value={accountCode}
                onChange={(e) => setAccountCode(e.target.value)}
                className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
              >
                <option value="">Todas as contas (padrão)</option>
                {accounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <Label className="text-[11px]">Modo</Label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as ApprovalMode)}
                className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
              >
                {APPROVAL_MODES.map((m) => (
                  <option key={m} value={m}>
                    {APPROVAL_MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <Label className="text-[11px]">
                Teto (R$) — acima dele exige liberação
              </Label>
              <Input
                className="h-9"
                inputMode="decimal"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="em branco = sem teto"
                disabled={mode === "automatica"}
              />
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {APPROVAL_MODE_HELP[mode]}
          </p>
          <Button size="sm" disabled={isPending} onClick={save}>
            Salvar regra
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
