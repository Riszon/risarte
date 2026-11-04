"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatBrDateTime } from "@/lib/dates";
import {
  clienteJaAssinou,
  MOTIVO_MINIMO,
  qualificacaoNoTexto,
  type PacoteAberto,
  type PacoteAssinado,
} from "@/lib/signatures/duplicidade";
import { cancelarPacoteDeAssinatura } from "./pacote-actions";

/**
 * O AVISO DE DUPLICIDADE DA JANELA DE ENVIO (AP108, decisão do dono,
 * 04/11/2026): não pode haver duas assinaturas do mesmo documento.
 *
 *  - "aberto": já existe pacote aguardando assinatura com o mesmo documento.
 *    O envio é BLOQUEADO; quem pode cancelar tem "Cancelar o anterior e enviar
 *    este" (cancela também na ZapSign — os links antigos param — e tenta de
 *    novo).
 *    Se o paciente (ou a empresa) JÁ ASSINOU o pacote aberto (pedido do dono,
 *    04/11/2026), o aviso diz quem assinou e quando, quem falta, oferece abrir
 *    o pacote (e "Assinar agora" quando falta quem está enviando), e o
 *    cancelar vira "Cancelar mesmo assim", com uma segunda confirmação.
 *  - "assinado": o mesmo documento já foi assinado por TODOS. TRAVA (pedido do
 *    dono, 04/11/2026, depois do ASS-000063/064: o botão antigo de um
 *    clique fez o cliente assinar o mesmo contrato duas vezes). O aviso diz
 *    quem assinou e quando; o botão principal abre o pacote assinado. Enviar
 *    de novo só com "É um documento novo" + motivo escrito, e só para o
 *    Gerente da unidade ou o Admin — o servidor confere de novo
 *    (`recusaDoNovoEnvio`).
 */

export type Duplicidade =
  | ({ tipo: "aberto" } & PacoteAberto)
  | ({ tipo: "assinado"; podeLiberar: boolean; mensagem?: string } & PacoteAssinado);

export const MOTIVO_DA_SUBSTITUICAO = "Substituído por um novo envio do mesmo documento.";

export function AvisoDeDuplicidade({
  duplicidade,
  clientId,
  onTentarDeNovo,
  onEnviarComMotivo,
}: {
  duplicidade: Duplicidade;
  clientId?: string | null;
  /** Depois de cancelar o anterior, prepara este de novo. */
  onTentarDeNovo: () => void;
  /** O mesmo documento já assinado: envia de novo com o motivo (Gerente ou Admin). */
  onEnviarComMotivo: (motivo: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirmandoCancelar, setConfirmandoCancelar] = useState(false);
  const [documentoNovo, setDocumentoNovo] = useState(false);
  const [motivo, setMotivo] = useState("");

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

  if (duplicidade.tipo === "aberto" && clienteJaAssinou(duplicidade)) {
    const doCliente = duplicidade.assinaram.filter((a) => a.ladoDoCliente);
    const faltaEu = duplicidade.faltam.some((a) => a.souEu);
    return (
      <div className="space-y-2 rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
        <p className="font-medium">
          {doCliente.length === 1 ? `${doCliente[0].name} já assinou este documento` : "O cliente já assinou este documento"}
        </p>
        <p>
          O pacote <strong>{duplicidade.number}</strong> tem este mesmo documento e já foi assinado pelo lado do cliente.
          Não é preciso enviar de novo: abra o pacote e conclua as assinaturas que faltam.
        </p>
        <ul className="space-y-0.5">
          {duplicidade.assinaram.map((a, i) => (
            <li key={`a${i}`}>
              ✓ {a.name} ({qualificacaoNoTexto(a.qualificacao)}){a.assinouEm ? ` — assinou em ${formatBrDateTime(a.assinouEm)}` : " — assinou"}
            </li>
          ))}
          {duplicidade.faltam.map((a, i) => (
            <li key={`f${i}`}>
              … {a.name} ({qualificacaoNoTexto(a.qualificacao)}) — falta assinar{a.souEu ? " (você)" : ""}
            </li>
          ))}
        </ul>
        {!confirmandoCancelar ? (
          <div className="flex flex-wrap gap-2">
            {faltaEu && (
              <Button size="sm" nativeButton={false} render={<Link href="/assinaturas/minhas" target="_blank" />}>
                Assinar agora
              </Button>
            )}
            {linkDoPacote && (
              <Button
                size="sm"
                variant={faltaEu ? "outline" : "default"}
                nativeButton={false}
                render={<Link href={linkDoPacote} target="_blank" />}
              >
                Abrir o {duplicidade.number}
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={isPending || !duplicidade.packageId} onClick={() => setConfirmandoCancelar(true)}>
              Cancelar mesmo assim
            </Button>
          </div>
        ) : (
          <div className="space-y-2 rounded-md border border-red-300 bg-red-50 p-2 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
            <p>
              <strong>{doCliente.map((a) => a.name).join(", ")}</strong> vai ter que assinar de novo. A assinatura já feita no{" "}
              {duplicidade.number} deixa de valer. Cancelar mesmo assim?
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="destructive" disabled={isPending} onClick={cancelarEEnviar}>
                {isPending ? "Cancelando…" : "Sim, cancelar e enviar de novo"}
              </Button>
              <Button size="sm" variant="outline" disabled={isPending} onClick={() => setConfirmandoCancelar(false)}>
                Não, manter a assinatura
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

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

  // "assinado": trava. Mostra quem assinou e quando; enviar de novo pede motivo.
  const motivoOk = motivo.trim().length >= MOTIVO_MINIMO;
  return (
    <div className="space-y-2 rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
      <p className="font-medium">Este documento já foi assinado por todos</p>
      <p>
        O pacote <strong>{duplicidade.number}</strong>, com este mesmo documento, foi concluído
        {duplicidade.completedAt ? ` em ${formatBrDateTime(duplicidade.completedAt)}` : ""}. Não é preciso assinar de novo:
        o PDF assinado está no pacote.
      </p>
      {duplicidade.assinaram.length > 0 && (
        <ul className="space-y-0.5">
          {duplicidade.assinaram.map((a, i) => (
            <li key={`s${i}`}>
              ✓ {a.name} ({qualificacaoNoTexto(a.qualificacao)}){a.assinouEm ? ` — assinou em ${formatBrDateTime(a.assinouEm)}` : ""}
            </li>
          ))}
        </ul>
      )}
      {!documentoNovo ? (
        <div className="flex flex-wrap gap-2">
          {linkDoPacote && (
            <Button size="sm" nativeButton={false} render={<Link href={linkDoPacote} target="_blank" />}>
              Abrir o {duplicidade.number}
            </Button>
          )}
          {duplicidade.podeLiberar && (
            <Button size="sm" variant="ghost" onClick={() => setDocumentoNovo(true)}>
              É um documento novo
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <p>
            Enviar de novo faz o cliente assinar outra vez. Faça isso só se for mesmo um documento novo (por exemplo, o
            contrato de outro tratamento). O motivo fica registrado no pacote novo.
          </p>
          <label className="block space-y-1">
            <span className="font-medium">Motivo do novo envio</span>
            <textarea className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} placeholder="Ex.: contrato do novo tratamento de implante" />
          </label>
          {!motivoOk && motivo.trim().length > 0 && (
            <p className="text-xs">Escreva pelo menos {MOTIVO_MINIMO} letras.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" disabled={!motivoOk} onClick={() => onEnviarComMotivo(motivo.trim())}>
              Enviar de novo com este motivo
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setDocumentoNovo(false); setMotivo(""); }}>
              Não enviar
            </Button>
          </div>
        </div>
      )}
      {!duplicidade.podeLiberar && (
        <p className="text-xs">Se for mesmo um documento novo, só o Gerente da unidade ou o Admin pode liberar o envio.</p>
      )}
    </div>
  );
}
