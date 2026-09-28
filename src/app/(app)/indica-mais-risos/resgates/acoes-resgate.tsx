"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { formatBrDate } from "@/lib/dates";
import { buscarProntuarios, type ClienteEncontrado } from "@/app/(app)/busca-actions";
import { mudarResgate, negociacoesDoCliente, usarVoucher, type NegociacaoDoCliente } from "./actions";

type Acao = "aprovar" | "entregar" | "recusar" | "cancelar";
const ROTULO: Record<Acao, string> = {
  aprovar: "Aprovar",
  entregar: "Entregar",
  recusar: "Recusar",
  cancelar: "Cancelar",
};

/** Botões de um resgate da fila. Quem pode cada um, o banco confere de novo. */
export function AcoesResgate({
  resgate,
  gestor,
}: {
  resgate: { id: string; codigo: string; status: string; itemNome: string | null };
  gestor: boolean;
}) {
  const router = useRouter();
  const [acao, setAcao] = useState<Acao | null>(null);
  const [motivo, setMotivo] = useState("");
  const [voucher, setVoucher] = useState<string | null>(null);
  const [gravando, gravar] = useTransition();

  const opcoes: Acao[] = [];
  if (resgate.status === "solicitado" && gestor) opcoes.push("aprovar");
  if (resgate.status === "aprovado") opcoes.push("entregar");
  if (["solicitado", "aprovado"].includes(resgate.status)) {
    if (gestor) opcoes.push("recusar");
    opcoes.push("cancelar");
  }
  if (opcoes.length === 0) return null;
  const pedeMotivo = acao === "recusar" || acao === "cancelar";

  function executar(a: Acao) {
    gravar(async () => {
      const r = await mudarResgate(resgate.id, a, a === "recusar" || a === "cancelar" ? motivo : null);
      if (r.ok) {
        if (r.voucher) setVoucher(r.voucher);
        else setAcao(null);
        toast.success(`${resgate.codigo}: ${ROTULO[a].toLowerCase()} feito.`);
        setMotivo("");
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <>
      <div className="flex flex-wrap justify-end gap-1.5">
        {opcoes.map((a) => (
          <Button
            key={a}
            size="sm"
            variant={a === "recusar" || a === "cancelar" ? "outline" : "default"}
            className="h-7 text-xs"
            disabled={gravando}
            onClick={() => (a === "aprovar" || a === "entregar" ? (setAcao(a), executar(a)) : setAcao(a))}
          >
            {ROTULO[a]}
          </Button>
        ))}
      </div>
      <Dialog
        open={(acao !== null && (pedeMotivo || voucher !== null))}
        onOpenChange={(v) => {
          if (!v) {
            setAcao(null);
            setVoucher(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          {voucher ? (
            <>
              <DialogHeader>
                <DialogTitle>Voucher gerado</DialogTitle>
                <DialogDescription>
                  {resgate.itemNome}. Entregue este código ao Embaixador (ou a quem recebeu o prêmio).
                </DialogDescription>
              </DialogHeader>
              <p className="rounded-lg border bg-muted/40 py-4 text-center font-mono text-2xl tracking-widest">{voucher}</p>
              <p className="text-xs text-muted-foreground">
                Crédito Risarte: o consultor aplica o valor como desconto na negociação e marca o voucher
                como usado em “Usar voucher”.
              </p>
            </>
          ) : (
            acao && (
              <>
                <DialogHeader>
                  <DialogTitle>
                    {ROTULO[acao]} {resgate.codigo}
                  </DialogTitle>
                  <DialogDescription>Os Riso Coins reservados voltam para o saldo do Embaixador.</DialogDescription>
                </DialogHeader>
                <div>
                  <Label htmlFor="motivo-resgate">Motivo *</Label>
                  <textarea
                    id="motivo-resgate"
                    rows={2}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm"
                  />
                </div>
                <div className="flex justify-end">
                  <Button onClick={() => executar(acao)} disabled={gravando || motivo.trim().length < 3}>
                    {gravando ? "Gravando…" : "Confirmar"}
                  </Button>
                </div>
              </>
            )
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * USAR VOUCHER — o consultor já aplicou o valor como desconto na negociação
 * (Comercial); aqui ele marca o voucher como usado e liga à negociação.
 */
export function UsarVoucherDialog() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [termo, setTermo] = useState("");
  const [clientes, setClientes] = useState<ClienteEncontrado[]>([]);
  const [cliente, setCliente] = useState<ClienteEncontrado | null>(null);
  const [negociacoes, setNegociacoes] = useState<NegociacaoDoCliente[] | null>(null);
  const [negociacao, setNegociacao] = useState<string | null>(null);
  const [gravando, gravar] = useTransition();
  const [, buscar] = useTransition();
  const pedido = useRef(0);

  useEffect(() => {
    const t = termo.trim();
    if (t.length < 2 || cliente) return;
    const meu = ++pedido.current;
    const tm = setTimeout(() => {
      buscar(async () => {
        const r = await buscarProntuarios(t);
        if (meu === pedido.current) setClientes(r);
      });
    }, 250);
    return () => clearTimeout(tm);
  }, [termo, cliente]);

  function escolher(c: ClienteEncontrado) {
    setCliente(c);
    setNegociacoes(null);
    buscar(async () => setNegociacoes(await negociacoesDoCliente(c.id)));
  }

  function salvar() {
    if (!negociacao) return;
    gravar(async () => {
      const r = await usarVoucher(codigo, negociacao);
      if (r.ok) {
        toast.success(`Voucher marcado como usado (${formatBRL(r.valorCentavos)}).`);
        setAberto(false);
        setCodigo("");
        setTermo("");
        setCliente(null);
        setNegociacao(null);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger render={<Button size="sm" variant="outline">Usar voucher</Button>} />
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Usar voucher de Crédito Risarte</DialogTitle>
          <DialogDescription>
            Primeiro aplique o valor como desconto na negociação (Comercial). Depois marque aqui: o
            voucher vale uma vez, dentro da validade.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="codigo-voucher">Código do voucher *</Label>
            <Input
              id="codigo-voucher"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              placeholder="RIS-XXXX-XXXX"
              className="font-mono"
            />
          </div>
          <div>
            <Label>Cliente da negociação *</Label>
            {cliente ? (
              <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                <span>{cliente.fullName}</span>
                <Button variant="ghost" size="sm" onClick={() => { setCliente(null); setNegociacao(null); }}>
                  Trocar
                </Button>
              </div>
            ) : (
              <>
                <Input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Nome, código ou CPF" />
                <ul className="mt-1 max-h-40 overflow-y-auto">
                  {(termo.trim().length >= 2 ? clientes : []).map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => escolher(c)} className="w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted">
                        {c.fullName} <span className="text-xs text-muted-foreground">{c.clinicName}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          {cliente && (
            <ul className="space-y-1.5">
              {negociacoes === null ? (
                <li className="text-sm text-muted-foreground">Procurando as negociações…</li>
              ) : negociacoes.length === 0 ? (
                <li className="text-sm text-muted-foreground">Este cliente não tem negociação.</li>
              ) : (
                negociacoes.map((n) => (
                  <li key={n.id}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                        negociacao === n.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                      )}
                    >
                      <input type="radio" checked={negociacao === n.id} onChange={() => setNegociacao(n.id)} />
                      <span className="font-mono text-xs">{n.codigo ?? "—"}</span>
                      <span className="text-muted-foreground">· {formatBrDate(n.criadaEm)}</span>
                    </label>
                  </li>
                ))
              )}
            </ul>
          )}
          <div className="flex justify-end">
            <Button onClick={salvar} disabled={gravando || !negociacao || codigo.trim().length < 8}>
              {gravando ? "Gravando…" : "Marcar como usado"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
