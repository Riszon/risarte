"use client";

/**
 * 4017a (19.30.2, 4a) — a fila dos pedidos de exceção para cancelar venda com
 * acordo de renegociação. O Financeiro da Franqueadora e o Admin Master veem a
 * rede e decidem (nunca o próprio pedido); o Gerente vê a sua unidade.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/pricing";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";
import { decidirExcecao } from "./excecao-actions";

export type PedidoDeExcecao = {
  id: string;
  unidade: string;
  cliente: string | null;
  venda: string | null;
  tipo: "plano" | "venda_direta";
  acordos: string | null;
  aberto: number;
  pago: number;
  motivo: string;
  situacao: "pedida" | "autorizada" | "negada" | "usada";
  quem_pediu: string | null;
  pedido_em: string;
  valida_ate: string | null;
  nota: string | null;
  pode_decidir: boolean;
};

const SITUACAO: Record<string, string> = { pedida: "Aguardando decisão", autorizada: "Autorizada", negada: "Negada", usada: "Usada" };

export function PedidosDeExcecao({ itens }: { itens: PedidoDeExcecao[] }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [nada] = useState(itens.length === 0);
  if (nada) return null;

  function decidir(id: string, aprovar: boolean) {
    const nota = window.prompt(aprovar ? "Observação (opcional):" : "Por que negar? (obrigatório)") ?? "";
    if (!aprovar && nota.trim().length < 3) return void toast.error("Para negar, escreva o motivo.");
    start(async () => {
      const r = await decidirExcecao({ id, aprovar, nota });
      if (!r.ok) return void toast.error(r.error);
      toast.success(aprovar ? "Exceção autorizada: vale 7 dias, uma vez." : "Exceção negada.");
      router.refresh();
    });
  }

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <h2 className="text-sm font-semibold">Pedidos de exceção: cancelar venda com acordo de renegociação</h2>
      <p className="text-xs text-muted-foreground">
        Com a exceção, o cancelamento conta o que o cliente já pagou no acordo e cancela as parcelas abertas dele. Vale 7
        dias, uma vez; cai se o acordo mudar. Quem pediu não autoriza o próprio pedido.
      </p>
      <ul className="space-y-2">
        {itens.map((p) => (
          <li key={p.id} className="rounded-lg border p-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {p.unidade} · {p.cliente ?? "—"} · {p.tipo === "plano" ? "plano" : "venda direta"} {p.venda ?? ""} · acordo {p.acordos ?? "—"}
              </span>
              <span className="rounded border px-1 text-[10px]">{SITUACAO[p.situacao] ?? p.situacao}</span>
            </div>
            <p className="tabular-nums">
              Em aberto no acordo {formatBRL(p.aberto)} · já pago no acordo {formatBRL(p.pago)}
            </p>
            <p>Motivo: {p.motivo}</p>
            <p className="text-muted-foreground">
              Pedido por {p.quem_pediu ?? "—"} em {new Date(p.pedido_em).toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE })}
              {p.valida_ate && p.situacao === "autorizada" && ` · vale até ${p.valida_ate.split("-").reverse().join("/")}`}
              {p.nota && ` · ${p.nota}`}
            </p>
            {p.pode_decidir && (
              <div className="mt-1 flex gap-1">
                <Button size="sm" className="h-7 text-[11px]" disabled={isPending} onClick={() => decidir(p.id, true)}>
                  Autorizar
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={isPending} onClick={() => decidir(p.id, false)}>
                  Negar
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
