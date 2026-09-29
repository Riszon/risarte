"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HandHeart } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PEDIDO_MOMENTOS, PEDIDO_RESULTADOS } from "@/lib/indica/rotulos";
import { registrarPedido } from "./actions";

const selectClass = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

const MOMENTOS = PEDIDO_MOMENTOS;
const RESULTADOS = PEDIDO_RESULTADOS;

/**
 * "PEDI INDICAÇÃO" — um clique na ficha.
 *
 * O gargalo do programa não é a vontade do cliente (83% aceitam indicar), é o
 * PEDIDO da equipe (29% indicam de fato). Registrar o pedido é o que permite
 * premiar o esforço, não só o resultado (ranking de pedidos, IND4).
 */
export function PediIndicacaoDialog({
  clienteId,
  clienteNome,
  unidadeId,
}: {
  clienteId: string;
  clienteNome: string;
  unidadeId: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [momento, setMomento] = useState("fechamento");
  const [resultado, setResultado] = useState("indicou");
  const [observacao, setObservacao] = useState("");
  const [gravando, gravar] = useTransition();

  function salvar() {
    gravar(async () => {
      const r = await registrarPedido({ clienteId, unidadeId, momento, resultado, observacao });
      if (r.ok) {
        toast.success(
          resultado === "indicou"
            ? "Pedido registrado. Agora registre a indicação em \"Nova indicação\"."
            : "Pedido de indicação registrado."
        );
        setAberto(false);
        setObservacao("");
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <HandHeart className="mr-1 size-4" />
            Pedi indicação
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pedi indicação</DialogTitle>
          <DialogDescription>
            Registre que você pediu a {clienteNome.split(" ")[0]} para indicar alguém.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="momento">Quando você pediu</Label>
            <select id="momento" value={momento} onChange={(e) => setMomento(e.target.value)} className={selectClass}>
              {MOMENTOS.map((m) => (
                <option key={m.valor} value={m.valor}>
                  {m.rotulo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="resultado">O que respondeu</Label>
            <select
              id="resultado"
              value={resultado}
              onChange={(e) => setResultado(e.target.value)}
              className={selectClass}
            >
              {RESULTADOS.map((m) => (
                <option key={m.valor} value={m.valor}>
                  {m.rotulo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="observacao">Observação (opcional)</Label>
            <textarea
              id="observacao"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm"
              placeholder="Sem dado clínico."
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={salvar} disabled={gravando}>
              {gravando ? "Gravando…" : "Registrar pedido"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
