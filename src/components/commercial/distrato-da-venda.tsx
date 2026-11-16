"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileSignature } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/pricing";
import {
  abrirDistratoDaVendaDireta,
  manterContrato,
  pedirDistrato,
  situacaoDoDistratoDaVenda,
  type SituacaoDoDistratoDaVenda,
} from "@/app/(app)/financeiro/cobrancas-automaticas/distrato-actions";

const CAMPO = "w-full rounded-md border border-input bg-background px-2 py-1 text-xs";

/**
 * ASA4, entrega 6 (4020, 19.35.3): o distrato não é automático.
 * - Quem atende (Recepção, Gerente, Coordenação, Comercial) registra o
 *   **pedido de distrato**, com o motivo; o Gerente é avisado.
 * - O Gerente decide: **Abrir o distrato** (o contrato, pelo "Cancelar
 *   tratamento"; a venda direta, aqui) ou **Manter o contrato**, com o motivo.
 */
export function DistratoDaVenda({
  clientId,
  negotiationId = null,
  directSaleId = null,
  /** Contrato: o distrato abre pelo cartão "Cancelar tratamento" (a tela avisa). */
  aoAbrirContrato,
}: {
  clientId: string;
  negotiationId?: string | null;
  directSaleId?: string | null;
  aoAbrirContrato?: () => void;
}) {
  const router = useRouter();
  const [ocupado, start] = useTransition();
  const [s, setS] = useState<SituacaoDoDistratoDaVenda | null>(null);
  const [modo, setModo] = useState<"pedir" | "manter" | "abrir" | null>(null);
  const [motivo, setMotivo] = useState("");

  const carregar = useCallback(async () => {
    const r = await situacaoDoDistratoDaVenda({ negotiationId, directSaleId });
    if (r.ok) setS(r.s);
  }, [negotiationId, directSaleId]);

  useEffect(() => {
    let vivo = true;
    situacaoDoDistratoDaVenda({ negotiationId, directSaleId }).then((r) => {
      if (vivo && r.ok) setS(r.s);
    });
    return () => {
      vivo = false;
    };
  }, [negotiationId, directSaleId]);

  if (!s) return null;
  if (!s.pode_pedir && !s.pode_decidir && !s.pedido && !s.distrato) return null;

  function enviar() {
    if (motivo.trim().length < 5) return toast.error("Escreva o motivo (pelo menos 5 letras).");
    start(async () => {
      if (modo === "pedir") {
        const r = await pedirDistrato({ clientId, negotiationId, directSaleId, reason: motivo.trim() });
        if (!r.ok) return void toast.error(r.error);
        toast.success("Pedido de distrato registrado. O Gerente foi avisado.");
      } else if (modo === "manter" && s?.pedido) {
        const r = await manterContrato({ id: s.pedido.id, reason: motivo.trim() });
        if (!r.ok) return void toast.error(r.error);
        toast.success("Contrato mantido. O motivo ficou registrado.");
      } else if (modo === "abrir" && directSaleId) {
        const r = await abrirDistratoDaVendaDireta({ clientId, saleId: directSaleId, reason: motivo.trim() });
        if (!r.ok) return void toast.error(r.error);
        toast.success("Distrato aberto. Conclua a checklist no termo.");
        router.push(`/cancelamentos/${r.cancellationId}/termo`);
      }
      setModo(null);
      setMotivo("");
      await carregar();
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed p-2 text-xs">
      <p className="flex items-center gap-1 font-medium">
        <FileSignature className="h-3.5 w-3.5" /> Distrato
      </p>

      {s.distrato && (
        <p>
          Distrato <strong>{s.distrato.codigo}</strong> aberto ({s.distrato.situacao === "assinado" ? "termo assinado" : "em rascunho"}).{" "}
          <a className="underline" href={`/cancelamentos/${s.distrato.id}/termo`}>
            Abrir o termo e a checklist
          </a>
        </p>
      )}

      {!s.distrato && s.pedido && (
        <div className="rounded-md bg-amber-50 p-2 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p>
            <strong>{s.pedido.origem === "atraso" ? "Contrato em atraso" : "Pedido de distrato"}</strong> desde{" "}
            {new Date(s.pedido.pedido_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}: {s.pedido.motivo}
          </p>
          <p className="mt-0.5">
            {s.pode_decidir
              ? "Decida: abra o distrato ou mantenha o contrato, com o motivo."
              : "O Gerente da unidade foi avisado e decide."}
          </p>
        </div>
      )}

      {!s.distrato && s.pago > 0 && directSaleId && (
        <p className="text-muted-foreground">Já pago nesta venda: {formatBRL(s.pago)}. O cancelamento é pelo distrato, com o acerto (sem multa).</p>
      )}

      {!s.distrato && (
        <div className="flex flex-wrap gap-1.5">
          {!s.pedido && s.pode_pedir && (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={ocupado} onClick={() => setModo("pedir")}>
              Pedir distrato
            </Button>
          )}
          {s.pode_decidir && directSaleId && (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={ocupado} onClick={() => setModo("abrir")}>
              Abrir distrato
            </Button>
          )}
          {s.pode_decidir && negotiationId && s.pedido && (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={ocupado} onClick={() => aoAbrirContrato?.()}>
              Abrir distrato
            </Button>
          )}
          {s.pode_decidir && s.pedido && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={ocupado} onClick={() => setModo("manter")}>
              Manter o contrato
            </Button>
          )}
        </div>
      )}

      {modo && (
        <div className="space-y-1.5">
          <label className="block">
            <span className="text-[11px] text-muted-foreground">
              {modo === "pedir" ? "Motivo do pedido" : modo === "manter" ? "Por que manter o contrato" : "Motivo do distrato"}
            </span>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} className={CAMPO} />
          </label>
          <div className="flex gap-1.5">
            <Button size="sm" className="h-7 text-xs" disabled={ocupado} onClick={enviar}>
              {modo === "pedir" ? "Registrar o pedido" : modo === "manter" ? "Manter o contrato" : "Abrir o distrato"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setModo(null)}>
              Voltar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
