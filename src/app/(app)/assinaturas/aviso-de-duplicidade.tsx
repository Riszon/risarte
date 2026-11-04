"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatBrDate } from "@/lib/dates";
import { cancelarPacoteDeAssinatura } from "./pacote-actions";

/**
 * O AVISO DE DUPLICIDADE DA JANELA DE ENVIO (AP108, decisão do dono,
 * 04/11/2026): não pode haver duas assinaturas do mesmo documento.
 *
 *  - "aberto": já existe pacote aguardando assinatura com o mesmo documento.
 *    O envio é BLOQUEADO; quem pode cancelar tem "Cancelar o anterior e enviar
 *    este" (cancela também na ZapSign — os links antigos param — e tenta de
 *    novo).
 *  - "assinado": o mesmo documento já foi assinado antes. AVISA e só segue com
 *    "Enviar mesmo assim".
 */

export type Duplicidade =
  | { tipo: "aberto"; packageId: string; number: string }
  | { tipo: "assinado"; packageId: string; number: string; completedAt: string | null };

export const MOTIVO_DA_SUBSTITUICAO = "Substituído por um novo envio do mesmo documento.";

export function AvisoDeDuplicidade({
  duplicidade,
  clientId,
  onTentarDeNovo,
  onEnviarMesmoAssim,
}: {
  duplicidade: Duplicidade;
  clientId?: string | null;
  /** Depois de cancelar o anterior, prepara este de novo. */
  onTentarDeNovo: () => void;
  /** O mesmo documento já assinado: segue com a confirmação. */
  onEnviarMesmoAssim: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  function cancelarEEnviar() {
    if (duplicidade.tipo !== "aberto" || !duplicidade.packageId) return;
    startTransition(async () => {
      const r = await cancelarPacoteDeAssinatura({
        packageId: duplicidade.packageId,
        reason: MOTIVO_DA_SUBSTITUICAO,
        clientId: clientId ?? null,
      });
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível cancelar o pacote anterior.");
        return;
      }
      toast.success(`Pacote ${duplicidade.number} cancelado. Preparando o novo envio…`);
      onTentarDeNovo();
    });
  }

  const linkDoPacote = duplicidade.packageId ? `/assinaturas/pacotes/${duplicidade.packageId}` : null;

  if (duplicidade.tipo === "aberto") {
    return (
      <div className="space-y-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
        <p className="font-medium">Este documento já está aguardando assinatura</p>
        <p>
          O pacote <strong>{duplicidade.number}</strong> tem este mesmo documento e ainda não foi assinado. Para não
          haver duas assinaturas do mesmo documento, o anterior precisa ser cancelado antes — os links dele param de
          funcionar.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="destructive" disabled={isPending || !duplicidade.packageId} onClick={cancelarEEnviar}>
            {isPending ? "Cancelando…" : "Cancelar o anterior e enviar este"}
          </Button>
          {linkDoPacote && (
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href={linkDoPacote} target="_blank" />}>
              Abrir o {duplicidade.number}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <p className="font-medium">Este documento já foi assinado antes</p>
      <p>
        O pacote <strong>{duplicidade.number}</strong>, com este mesmo documento, foi assinado
        {duplicidade.completedAt ? ` em ${formatBrDate(duplicidade.completedAt)}` : ""}. Envie outro só se for mesmo
        um documento novo (por exemplo, um contrato para outro tratamento).
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onEnviarMesmoAssim}>
          Enviar mesmo assim
        </Button>
        {linkDoPacote && (
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href={linkDoPacote} target="_blank" />}>
            Abrir o {duplicidade.number}
          </Button>
        )}
      </div>
    </div>
  );
}
