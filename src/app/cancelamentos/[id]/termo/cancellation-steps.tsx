"use client";

import { comConfirmacaoDeBoletos } from "@/lib/confirmar-boletos";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  applyPlanCancellation,
  discardPlanCancellation,
  signPlanCancellation,
} from "@/app/(app)/apresentacao/[clientId]/cancellation-actions";
import {
  DESTINO_DO_CANCELAMENTO_LABEL,
  pedeDestino,
  type DestinoDoCancelamento,
  type FimDoCancelamento,
} from "@/lib/fim-do-cancelamento";
import { retornoSugerido } from "@/lib/fim-do-tratamento";
import { prepararEfetivacao } from "./fim-do-cancelamento-actions";

/**
 * 0206 — os passos do cancelamento, fora do documento impresso.
 *
 * A ordem importa: **nada do tratamento é desfeito antes da assinatura**.
 * Enquanto o termo estiver em rascunho, descartar não deixa rastro no
 * tratamento — é o que permite conversar com o paciente sem medo.
 */
export function CancellationSteps({
  id,
  clientId,
  status,
  signedAt,
  appliedAt,
  checklistPendente = 0,
  fim = null,
  hoje,
}: {
  id: string;
  clientId: string;
  status: string;
  signedAt: string | null;
  appliedAt: string | null;
  /** 4020: itens da checklist do distrato ainda abertos (0 = pronto). */
  checklistPendente?: number;
  /** 0426: o que a efetivação faz com a fase e se os riscos estão pendentes. */
  fim?: FimDoCancelamento | null;
  /** Hoje no Brasil (aaaa-mm-dd), vindo do servidor. */
  hoje: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // 0426 (D10, D12): o destino é decidido na efetivação, pela regra única.
  const [destino, setDestino] = useState<DestinoDoCancelamento | "">(fim?.destino ?? "");
  const [retorno, setRetorno] = useState(fim?.retorno ?? retornoSugerido(hoje));
  const comDestino = pedeDestino(fim);
  const naFase5 = fim?.kind === "contrato" && fim?.fase === "treatment_start";

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  if (status === "efetivado") {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
        <p className="font-semibold">Cancelamento efetivado.</p>
        <p className="text-xs">
          As sessões não realizadas e as cobranças em aberto foram canceladas
          {appliedAt ? ` em ${appliedAt.slice(8, 10)}/${appliedAt.slice(5, 7)}/${appliedAt.slice(0, 4)}` : ""}
          . O que já havia sido executado continua no prontuário.
        </p>
      </div>
    );
  }

  if (status === "descartado") {
    return (
      <div className="rounded-lg border bg-muted/50 p-3 text-sm">
        <p className="font-semibold">Termo descartado.</p>
        <p className="text-xs text-muted-foreground">
          O tratamento seguiu normalmente — nada foi cancelado.
        </p>
      </div>
    );
  }

  const signed = status === "assinado";
  const riscosPendentes = Boolean(fim?.riscosPendentes) && !signed;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div>
        <p className="text-sm font-semibold">Passos do cancelamento</p>
        <p className="text-xs text-muted-foreground">
          Enquanto o termo não for assinado e efetivado,{" "}
          <strong>nada do tratamento é desfeito</strong>.
        </p>
      </div>

      {riscosPendentes && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          Há procedimento começado e não terminado. O termo só pode ser assinado depois que o
          Coordenador Clínico registrar os riscos informados ao cliente (na ficha do cliente).
        </p>
      )}

      {naFase5 && fim?.segueEmTratamento && (
        <p className="text-xs text-muted-foreground">
          O cliente segue em tratamento com outra venda: ao efetivar, ele fica na Fase 5.
        </p>
      )}
      {comDestino && (
        <div className="space-y-1.5 rounded-md border p-2 text-xs">
          <p className="font-medium">Não sobra outro tratamento. Para onde o cliente vai?</p>
          {(Object.keys(DESTINO_DO_CANCELAMENTO_LABEL) as DestinoDoCancelamento[]).map((d) => (
            <label key={d} className="flex items-start gap-2">
              <input
                type="radio"
                name="destino"
                className="mt-0.5"
                checked={destino === d}
                onChange={() => setDestino(d)}
              />
              {DESTINO_DO_CANCELAMENTO_LABEL[d]}
            </label>
          ))}
          {destino === "follow_up" && (
            <label className="block space-y-1">
              <span className="text-muted-foreground">Retorno previsto (sugerido: 6 meses)</span>
              <input
                type="date"
                value={retorno}
                min={hoje}
                onChange={(e) => setRetorno(e.target.value)}
                className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
              />
            </label>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={signed ? "outline" : "default"}
          disabled={isPending || riscosPendentes}
          title={riscosPendentes ? "O Coordenador precisa registrar os riscos antes" : undefined}
          onClick={() =>
            run(
              () => signPlanCancellation({ id, clientId, signed: !signed }),
              signed ? "Assinatura desmarcada." : "Termo marcado como assinado."
            )
          }
        >
          {signed
            ? `Assinado${signedAt ? ` em ${signedAt.slice(8, 10)}/${signedAt.slice(5, 7)}` : ""} — desmarcar`
            : "Marcar termo como assinado"}
        </Button>

        <Button
          size="sm"
          variant="destructive"
          disabled={isPending || !signed || checklistPendente > 0}
          title={
            checklistPendente > 0
              ? `Conclua a checklist do distrato antes (faltam ${checklistPendente} item(ns))`
              : signed
                ? "Cancela as sessões pendentes e as cobranças em aberto"
                : "O cliente precisa assinar o termo antes"
          }
          onClick={() =>
            run(
              async () => {
                // 0426: primeiro o destino pela regra única; depois a efetivação.
                if (naFase5) {
                  const p = await prepararEfetivacao({ id, destino: comDestino ? destino || null : null, retorno });
                  if (!p.ok) return p;
                }
                // 4015: com boletos já entregues, a tela confirma antes de cancelá-los.
                return comConfirmacaoDeBoletos((confirmar) => applyPlanCancellation({ id, clientId, confirmarCancelamento: confirmar }));
              },
              "Cancelamento efetivado."
            )
          }
        >
          Efetivar cancelamento
        </Button>

        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() =>
            run(
              () => discardPlanCancellation({ id, clientId }),
              "Termo descartado — o tratamento segue normalmente."
            )
          }
        >
          Descartar
        </Button>
      </div>
    </div>
  );
}
