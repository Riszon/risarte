"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Ban, PauseCircle, PlayCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PPR_RELATIONSHIPS, type PprStatus } from "@/lib/ppr/constants";
import {
  addPprDependent,
  cancelPprMembership,
  pprCloseStep,
  setPprBeneficiaryClinic,
  setPprStatus,
} from "../../actions";

/**
 * Unidade do dependente (PPR5): ele pode pertencer a uma unidade diferente da
 * do titular; mudar aqui só atualiza a informação — o plano segue o mesmo.
 */
export function PprBeneficiaryClinicSelect({
  beneficiaryId,
  clinicId,
  units,
}: {
  beneficiaryId: string;
  clinicId: string;
  units: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      Mudar de unidade:
      <select
        value={clinicId}
        disabled={isPending}
        onChange={(e) => {
          const next = e.target.value;
          if (next === clinicId) return;
          startTransition(async () => {
            const r = await setPprBeneficiaryClinic(beneficiaryId, next);
            if (!r.ok) toast.error(r.error ?? "Não foi possível alterar.");
            else {
              toast.success("Unidade do dependente atualizada.");
              router.refresh();
            }
          });
        }}
        className="h-7 rounded-md border border-input bg-transparent px-1.5 text-[11px]"
      >
        {units.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    </label>
  );
}

const selectClass =
  "mt-0.5 h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

/** Botões da adesão: ativação (regra de ouro), dependentes e situação. */
export function PprMembershipActions({
  membershipId,
  status,
  contractSigned,
  paymentConfirmed,
  canEdit,
  canManage,
  allowsDependents,
  dependentCount,
  maxDependents,
  units,
  clinicId,
}: {
  membershipId: string;
  status: PprStatus;
  contractSigned: boolean;
  paymentConfirmed: boolean;
  canEdit: boolean;
  canManage: boolean;
  allowsDependents: boolean;
  dependentCount: number;
  maxDependents: number | null;
  units: { id: string; name: string }[];
  /** Unidade do plano — padrão para o novo dependente. */
  clinicId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [addingDependent, setAddingDependent] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  const cancelled = status === "cancelado";
  const roomForDependent =
    allowsDependents &&
    (maxDependents === null || dependentCount < maxDependents);

  function step(kind: "contract" | "payment", value: boolean) {
    startTransition(async () => {
      const r = await pprCloseStep(membershipId, kind, value);
      if (!r.ok) toast.error(r.error ?? "Não foi possível atualizar.");
      else {
        toast.success("Adesão atualizada.");
        router.refresh();
      }
    });
  }

  function changeStatus(next: "ativo" | "suspenso") {
    startTransition(async () => {
      const r = await setPprStatus(membershipId, next);
      if (!r.ok) toast.error(r.error ?? "Não foi possível alterar.");
      else {
        toast.success(next === "ativo" ? "Plano reativado." : "Plano suspenso.");
        router.refresh();
      }
    });
  }

  function doCancel() {
    startTransition(async () => {
      const r = await cancelPprMembership(membershipId, reason);
      if (!r.ok) toast.error(r.error ?? "Não foi possível cancelar.");
      else {
        toast.success("Adesão cancelada.");
        setCancelling(false);
        router.refresh();
      }
    });
  }

  function addDependent(form: FormData) {
    startTransition(async () => {
      const r = await addPprDependent(membershipId, {
        fullName: String(form.get("fullName") ?? ""),
        cpf: String(form.get("cpf") ?? ""),
        birthDate: String(form.get("birthDate") ?? ""),
        relationship: String(form.get("relationship") ?? ""),
        clinicId: String(form.get("clinicId") ?? "") || clinicId,
      });
      if (!r.ok) toast.error(r.error ?? "Não foi possível incluir.");
      else {
        toast.success("Dependente incluído.");
        setAddingDependent(false);
        router.refresh();
      }
    });
  }

  if (!canEdit) return null;

  return (
    <div className="space-y-3">
      {!cancelled && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={contractSigned ? "outline" : "default"}
            disabled={isPending}
            onClick={() => step("contract", !contractSigned)}
          >
            {contractSigned ? "Desmarcar contrato" : "Contrato assinado"}
          </Button>
          <Button
            size="sm"
            variant={paymentConfirmed ? "outline" : "default"}
            disabled={isPending}
            onClick={() => step("payment", !paymentConfirmed)}
          >
            {paymentConfirmed ? "Desmarcar pagamento" : "1ª mensalidade paga"}
          </Button>

          {roomForDependent && (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => setAddingDependent((v) => !v)}
            >
              <Plus className="mr-1 size-3.5" />
              Incluir dependente
            </Button>
          )}

          {canManage && status === "ativo" && (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => changeStatus("suspenso")}
            >
              <PauseCircle className="mr-1 size-3.5" />
              Suspender
            </Button>
          )}
          {canManage && status === "suspenso" && (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => changeStatus("ativo")}
            >
              <PlayCircle className="mr-1 size-3.5" />
              Reativar
            </Button>
          )}
          {canManage && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={isPending}
              onClick={() => setCancelling((v) => !v)}
            >
              <Ban className="mr-1 size-3.5" />
              Cancelar plano
            </Button>
          )}
        </div>
      )}

      {addingDependent && (
        <form
          action={addDependent}
          className="grid gap-2 rounded-xl border border-dashed p-3 sm:grid-cols-2"
        >
          <label className="text-xs sm:col-span-2">
            <span className="text-muted-foreground">Nome completo</span>
            <Input name="fullName" required />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">CPF (opcional)</span>
            <Input name="cpf" inputMode="numeric" />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Nascimento</span>
            <Input name="birthDate" type="date" />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Parentesco</span>
            <select name="relationship" className={selectClass}>
              {PPR_RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Unidade do dependente</span>
            <select name="clinicId" defaultValue={clinicId} className={selectClass}>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit" size="sm" disabled={isPending}>
              Incluir
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAddingDependent(false)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {cancelling && (
        <div className="space-y-2 rounded-xl border border-destructive/40 p-3">
          <p className="text-sm">
            Ao cancelar, <strong>todos os beneficiários perdem os benefícios</strong>{" "}
            e a etiqueta PPR+ sai do prontuário (fica só no histórico).
          </p>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo do cancelamento"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={isPending || !reason.trim()}
              onClick={doCancel}
            >
              Confirmar cancelamento
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCancelling(false)}>
              Voltar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
