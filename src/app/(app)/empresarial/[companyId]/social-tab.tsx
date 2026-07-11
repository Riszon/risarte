"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Gift, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  SOCIAL_TRIGGER_TYPES,
  SOCIAL_TRIGGER_LABELS,
  type PaymentModel,
} from "@/lib/empresarial/constants";
import {
  assignSocialToken,
  generateSocialToken,
  markSocialTokenUsed,
  removeSocialToken,
} from "./social-actions";

const selectClass =
  "h-8 rounded-md border border-input bg-transparent px-2 text-xs";

export type SocialTokenView = {
  id: string;
  triggerType: string;
  isPool: boolean;
  status: "AVAILABLE" | "ASSIGNED" | "USED";
  beneficiaryClientId: string | null;
  beneficiaryName: string | null;
};

const STATUS_LABEL: Record<SocialTokenView["status"], string> = {
  AVAILABLE: "Disponível",
  ASSIGNED: "Atribuída",
  USED: "Utilizada",
};

export function SocialTab({
  companyId,
  paymentModel,
  tokens,
  candidates,
}: {
  companyId: string;
  paymentModel: PaymentModel;
  tokens: SocialTokenView[];
  candidates: { clientId: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [trigger, setTrigger] = useState<string>(SOCIAL_TRIGGER_TYPES[0]);

  const participates = paymentModel !== "EMPLOYEE_PAYS";
  const modelNote =
    paymentModel === "COMPANY_PAYS"
      ? "Modelo integral: cada ficha indica um beneficiário próprio."
      : paymentModel === "COMPANY_PARTIAL"
        ? "Modelo parcial: as fichas entram no pool coletivo da rede."
        : "Modelo “colaborador paga”: não participa do Riso+ Social.";

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
      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="text-sm text-muted-foreground">{modelNote}</p>
          {participates && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={trigger}
                onChange={(e) => setTrigger(e.target.value)}
                className={selectClass}
              >
                {SOCIAL_TRIGGER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {SOCIAL_TRIGGER_LABELS[t]}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() =>
                  run(
                    async () => generateSocialToken(companyId, trigger),
                    "Ficha social gerada."
                  )
                }
              >
                <Gift className="mr-1 size-4" />
                Gerar ficha social
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {tokens.length === 0 ? (
        <p className="rounded-lg border py-8 text-center text-sm text-muted-foreground">
          Nenhuma ficha social ainda.
        </p>
      ) : (
        <div className="space-y-2">
          {tokens.map((t) => (
            <div
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
            >
              <div>
                <p className="flex items-center gap-2 text-sm font-medium">
                  {SOCIAL_TRIGGER_LABELS[
                    t.triggerType as keyof typeof SOCIAL_TRIGGER_LABELS
                  ] ?? t.triggerType}
                  <Badge variant={t.status === "USED" ? "outline" : "secondary"}>
                    {STATUS_LABEL[t.status]}
                  </Badge>
                  {t.isPool && <Badge variant="outline">Pool coletivo</Badge>}
                </p>
                {t.beneficiaryName && (
                  <p className="text-xs text-muted-foreground">
                    Beneficiário: {t.beneficiaryName}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {t.status === "AVAILABLE" && !t.isPool && (
                  <AssignPicker
                    candidates={candidates}
                    disabled={isPending}
                    onAssign={(clientId) =>
                      run(
                        async () => assignSocialToken(companyId, t.id, clientId),
                        "Beneficiário atribuído."
                      )
                    }
                  />
                )}
                {t.status !== "USED" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={isPending}
                    onClick={() =>
                      run(
                        async () => markSocialTokenUsed(companyId, t.id),
                        "Marcada como utilizada."
                      )
                    }
                  >
                    Marcar utilizada
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-destructive"
                  disabled={isPending}
                  onClick={() =>
                    run(
                      async () => removeSocialToken(companyId, t.id),
                      "Ficha removida."
                    )
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssignPicker({
  candidates,
  disabled,
  onAssign,
}: {
  candidates: { clientId: string; name: string }[];
  disabled: boolean;
  onAssign: (clientId: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <span className="flex items-center gap-1">
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={selectClass}
        disabled={disabled}
      >
        <option value="">Beneficiário...</option>
        {candidates.map((c) => (
          <option key={c.clientId} value={c.clientId}>
            {c.name}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={disabled || !value}
        onClick={() => onAssign(value)}
      >
        Atribuir
      </Button>
    </span>
  );
}
