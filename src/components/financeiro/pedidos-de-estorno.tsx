"use client";

/**
 * 4020a (spec 19.38) — na ficha: os pedidos de estorno esperando a confirmação
 * (o Gerente ou o franqueado confirma; nunca quem pediu), os já pedidos com a
 * repartição real, e as parcelas encerradas como "Estornada" (o Gerente reabre,
 * com motivo).
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/pricing";
import {
  cancelarPedidoDeEstorno,
  confirmarEstorno,
  lerParcelasEstornadas,
  lerPedidosDeEstorno,
  reabrirParcelaEstornada,
  type ParcelaEstornada,
  type PedidoDeEstorno,
} from "@/app/(app)/prontuarios/[id]/estorno-actions";

const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const SITUACAO: Record<string, string> = {
  confirmar: "Esperando a confirmação do Gerente ou do franqueado",
  enviar: "Confirmado, indo ao Asaas",
  enviado: "Pedido ao Asaas",
  cancelado: "Cancelado",
  falhou: "Não saiu",
  sem_saldo: "Parado: temporariamente indisponível",
};

export function PedidosDeEstorno({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [pedidos, setPedidos] = useState<PedidoDeEstorno[]>([]);
  const [estornadas, setEstornadas] = useState<ParcelaEstornada[]>([]);
  const [pendente, start] = useTransition();
  const carregar = () =>
    Promise.all([lerPedidosDeEstorno(clientId), lerParcelasEstornadas(clientId)]).then(([p, e]) => {
      setPedidos(p.filter((x) => ["confirmar", "enviar", "sem_saldo", "enviado"].includes(x.status)).slice(0, 10));
      setEstornadas(e);
    });
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);
  const motivo = (t: string) => {
    const m = window.prompt(t);
    return m && m.trim().length >= 5 ? m.trim() : null;
  };
  const acao = (f: () => Promise<{ ok: boolean; error?: string; aviso?: string }>, ok: string) =>
    start(async () => {
      const r = await f();
      if (!r.ok) return void toast.error(r.error ?? "Não foi possível.");
      toast.success(r.aviso ?? ok);
      await carregar();
      router.refresh();
    });

  if (pedidos.length === 0 && estornadas.length === 0) return null;
  return (
    <div className="mb-3 space-y-2 rounded-lg border p-3 text-sm">
      {pedidos.length > 0 && (
        <>
          <p className="font-medium">Pedidos de estorno</p>
          <ul className="space-y-2">
            {pedidos.map((p) => (
              <li key={p.id} className="space-y-1">
                <p>
                  {p.kind === "cartao" ? "Cartão" : "Pix"} · {p.amount_cents ? formatBRL(p.amount_cents) : "total"} · {SITUACAO[p.status] ?? p.status}
                  <span className="text-xs text-muted-foreground"> — pedido por {p.requested_by ?? "—"} em {dia(p.requested_at)}: “{p.reason}”</span>
                </p>
                {p.actual_split && p.actual_split.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    O Asaas fez: {p.actual_split.map((x) => `${formatBRL(x.amount_cents)}${x.inteira ? " (inteira)" : ""} ${x.asaas_status === "DONE" ? "concluído" : "em andamento"}`).join("; ")}
                    {p.split_differs ? " — diferente da previsão." : "."}
                  </p>
                )}
                <span className="flex flex-wrap gap-2">
                  {p.can_confirm && (
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      disabled={pendente}
                      onClick={() => {
                        if (!window.confirm("Confirmar este estorno de cartão? No cartão, o estorno sai na hora e não pode ser desfeito.")) return;
                        acao(() => confirmarEstorno({ clientId, requestId: p.id }), "Confirmado.");
                      }}
                    >
                      Confirmar o estorno
                    </Button>
                  )}
                  {p.can_cancel && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={pendente}
                      onClick={() => {
                        const m = motivo("Por que cancelar o pedido de estorno?");
                        if (m) acao(() => cancelarPedidoDeEstorno({ clientId, requestId: p.id, motivo: m }), "Pedido cancelado.");
                      }}
                    >
                      Cancelar o pedido
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {estornadas.length > 0 && (
        <>
          <p className="font-medium">Parcelas estornadas</p>
          <ul className="space-y-1">
            {estornadas.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2">
                <span>
                  Parcela {e.seq} · {formatBRL(e.amount_cents)} · vencimento {dia(e.due_date)} · <strong>Estornada</strong> em {dia(e.closed_at)} (não volta a ser cobrada sozinha)
                </span>
                {e.can_reopen && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={pendente}
                    onClick={() => {
                      const m = motivo("Por que reabrir a parcela estornada?");
                      if (m) acao(() => reabrirParcelaEstornada({ clientId, installmentId: e.id, motivo: m }), "Parcela reaberta.");
                    }}
                  >
                    Reabrir
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
