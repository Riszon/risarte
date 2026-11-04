"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardCopy, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MODULO_ROTULO, type ModuloDoSistema } from "@/lib/system-reports";
import {
  PRIORIDADES,
  PRIORIDADE_ROTULO,
  montarPedido,
  quemVaiParaAndamento,
  type CategoriaDoBacklog,
  type ItemDoBacklog,
  type Prioridade,
} from "@/lib/backlog";
import { lerItensDoPedido, mudarEmLote, type ResultadoDoLote } from "./actions";
import { Escolha } from "./pecas";

const NADA = "__nada";

/**
 * Copia de verdade ou diz que não copiou. A área de transferência moderna pode
 * ficar PARADA esperando permissão (visto no navegador embutido, 04/11/2026: o
 * botão ficava "Gravando…" para sempre) — por isso o prazo de 2 s e, depois, o
 * jeito antigo (selecionar a caixa e copiar).
 */
async function copiarTexto(texto: string): Promise<boolean> {
  try {
    const ok = await Promise.race([
      navigator.clipboard.writeText(texto).then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
    ]);
    if (ok) return true;
  } catch {
    // segue para o jeito antigo
  }
  const caixa = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Texto do pedido"]');
  if (!caixa) return false;
  caixa.focus();
  caixa.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

/**
 * A BARRA DO LOTE DO BACKLOG (BK3). Com um ou vários itens escolhidos:
 * - **Preparar pedido para resolver** — o texto para colar numa sessão do
 *   Claude Code, numa caixa editável (revisar antes de levar para fora do
 *   sistema é a regra dos briefings dos relatos). Ao copiar, os abertos passam
 *   a "Em andamento" (pode desmarcar);
 * - mudar prioridade ou categoria de todos de uma vez.
 * Resolver e descartar continuam item a item: cada um tem o seu "como".
 */
export function BarraDoLote({
  escolhidos,
  categorias,
  aoLimpar,
}: {
  escolhidos: ItemDoBacklog[];
  categorias: CategoriaDoBacklog[];
  aoLimpar: () => void;
}) {
  const router = useRouter();
  const [pendente, comecar] = useTransition();
  const [pedido, setPedido] = useState<string | null>(null);
  const [marcar, setMarcar] = useState(true);
  const [prioridade, setPrioridade] = useState(NADA);
  const [categoria, setCategoria] = useState(NADA);

  if (escolhidos.length === 0) return null;
  const n = escolhidos.length;
  const vaoParaAndamento = quemVaiParaAndamento(escolhidos);

  function avisar(r: ResultadoDoLote, oQue: string) {
    if (r.gravados.length) toast.success(`${oQue}: ${r.gravados.length} ite${r.gravados.length > 1 ? "ns" : "m"}.`);
    for (const f of r.falhas) toast.error(f.code === "—" ? f.error : `${f.code}: ${f.error}`);
  }

  function prepararPedido() {
    comecar(async () => {
      const r = await lerItensDoPedido(escolhidos.map((i) => i.code));
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setMarcar(true);
      setPedido(montarPedido(r.itens, (m) => MODULO_ROTULO[m as ModuloDoSistema] ?? m));
    });
  }

  function copiar() {
    if (!pedido) return;
    comecar(async () => {
      if (!(await copiarTexto(pedido))) {
        // O texto está na caixa — e nada é marcado, porque nada foi levado.
        toast.error("Não consegui copiar. Selecione o texto da caixa e use Ctrl+C.");
        return;
      }
      toast.success("Pedido copiado. Cole na conversa com o Claude Code.");
      if (marcar && vaoParaAndamento.length) {
        const r = await mudarEmLote(vaoParaAndamento, {
          status: "em_andamento",
          note: "Pedido para resolver copiado na tela do backlog.",
        });
        avisar(r, "Em andamento");
      }
      setPedido(null);
      aoLimpar();
      router.refresh();
    });
  }

  function aplicar(mudanca: { priority?: Prioridade; category?: string }, rotulo: string) {
    comecar(async () => {
      const r = await mudarEmLote(
        escolhidos.map((i) => i.code),
        mudanca
      );
      avisar(r, rotulo);
      setPrioridade(NADA);
      setCategoria(NADA);
      if (r.gravados.length) router.refresh();
    });
  }

  return (
    <>
      {/* No rodapé, sobre a lista: a escolha fica à vista enquanto se rola. */}
      <div className="sticky bottom-3 z-30 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-xl border-2 border-primary bg-background px-3 py-2.5 shadow-lg">
        <span className="text-sm font-medium">
          {n} ite{n > 1 ? "ns" : "m"} escolhido{n > 1 ? "s" : ""}
        </span>
        <Button size="sm" onClick={prepararPedido} disabled={pendente}>
          <Wand2 className="mr-1.5 size-4" />
          Preparar pedido para resolver
        </Button>
        <Escolha
          rotulo="Mudar a prioridade dos escolhidos"
          itens={[{ value: NADA, label: "Prioridade…" }, ...PRIORIDADES.map((p) => ({ value: p, label: PRIORIDADE_ROTULO[p] }))]}
          valor={prioridade}
          aoMudar={setPrioridade}
          className="h-8 min-w-32"
        />
        {prioridade !== NADA && (
          <Button
            size="sm"
            variant="outline"
            disabled={pendente}
            onClick={() => aplicar({ priority: prioridade as Prioridade }, `Prioridade ${PRIORIDADE_ROTULO[prioridade as Prioridade]}`)}
          >
            Aplicar
          </Button>
        )}
        <Escolha
          rotulo="Mudar a categoria dos escolhidos"
          itens={[
            { value: NADA, label: "Categoria…" },
            ...categorias.filter((c) => c.active).map((c) => ({ value: c.name, label: c.name })),
          ]}
          valor={categoria}
          aoMudar={setCategoria}
          className="h-8 min-w-32"
        />
        {categoria !== NADA && (
          <Button size="sm" variant="outline" disabled={pendente} onClick={() => aplicar({ category: categoria }, `Categoria ${categoria}`)}>
            Aplicar
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={aoLimpar} disabled={pendente} aria-label="Desfazer a escolha">
          <X className="mr-1 size-4" />
          Limpar
        </Button>
      </div>

      <Dialog open={pedido !== null} onOpenChange={(aberto) => !aberto && setPedido(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Pedido para resolver {n} ite{n > 1 ? "ns" : "m"}
            </DialogTitle>
            <DialogDescription>
              Revise e acrescente o que quiser antes de copiar. Depois, cole na conversa com o Claude Code.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={pedido ?? ""}
            onChange={(e) => setPedido(e.target.value)}
            rows={18}
            aria-label="Texto do pedido"
            className="w-full rounded-md border bg-background p-2 font-mono text-xs"
          />
          {vaoParaAndamento.length > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={marcar}
                onChange={(e) => setMarcar(e.target.checked)}
                className="mt-0.5 size-4"
              />
              <span>
                Ao copiar, marcar {vaoParaAndamento.length === 1 ? "o item aberto" : `os ${vaoParaAndamento.length} itens abertos`}{" "}
                como <strong>Em andamento</strong>
              </span>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPedido(null)} disabled={pendente}>
              Fechar
            </Button>
            <Button onClick={copiar} disabled={pendente}>
              <ClipboardCopy className="mr-1.5 size-4" />
              {pendente ? "Gravando…" : "Copiar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
