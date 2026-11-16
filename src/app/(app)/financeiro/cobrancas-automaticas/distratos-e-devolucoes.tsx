"use client";

/**
 * 4020 (19.35) — os DISTRATOS e as DEVOLUÇÕES.
 * - Os pedidos de distrato e os contratos em atraso esperando a decisão do
 *   Gerente (abrir o distrato pela ficha, ou manter o contrato com o motivo).
 * - Os distratos abertos e há quantos dias (o Gerente é avisado a cada 7 dias;
 *   depois de 30, o Financeiro da Franqueadora também).
 * - Todas as devoluções, dos dois tipos (estorno pelo Asaas e Pix da conta da
 *   unidade): o Financeiro da Franqueadora vê a rede e autoriza a do distrato
 *   (nunca a que ele mesmo pediu).
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/pricing";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";
import {
  decidirDevolucaoDoDistrato,
  linkDoTermoDoDistrato,
  manterContrato,
  type Devolucao,
  type DistratosDaRede,
} from "./distrato-actions";

const data = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE });
const SITUACAO: Record<string, string> = {
  pedida: "Aguardando o Financeiro",
  autorizada: "Autorizada",
  negada: "Negada",
  pedido: "Aguardando a autorização no Asaas",
  concluido: "Concluído",
  negado: "Negado",
  cancelado: "Cancelado",
  falhou: "Falhou",
};

export function DistratosEDevolucoes({ distratos, devolucoes }: { distratos: DistratosDaRede | null; devolucoes: Devolucao[] }) {
  const router = useRouter();
  const [ocupado, start] = useTransition();
  const [motivo, setMotivo] = useState<Record<string, string>>({});
  const pedidos = distratos?.pedidos ?? [];
  const abertos = distratos?.abertos ?? [];
  if (!pedidos.length && !abertos.length && !devolucoes.length) return null;

  function manter(id: string) {
    const m = (motivo[id] ?? "").trim();
    if (m.length < 5) return toast.error("Escreva por que manter o contrato (pelo menos 5 letras).");
    start(async () => {
      const r = await manterContrato({ id, reason: m });
      if (!r.ok) toast.error(r.error);
      else toast.success("Contrato mantido. O motivo ficou registrado.");
      router.refresh();
    });
  }

  function decidir(id: string, approve: boolean) {
    const nota = (motivo[id] ?? "").trim();
    if (!approve && nota.length < 5) return toast.error("Para negar, escreva o motivo.");
    start(async () => {
      const r = await decidirDevolucaoDoDistrato({ id, approve, note: nota });
      if (!r.ok) toast.error(r.error);
      else toast.success(approve ? "Devolução autorizada: virou conta a pagar da unidade." : "Devolução negada.");
      router.refresh();
    });
  }

  async function abrirTermo(path: string) {
    const r = await linkDoTermoDoDistrato(path);
    if (r.ok && r.url) window.open(r.url, "_blank", "noopener,noreferrer");
    else toast.error(r.error ?? "Não foi possível abrir o termo.");
  }

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="text-base font-semibold">Distratos e devoluções</h2>

      {pedidos.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Para decidir ({pedidos.length})</p>
          {pedidos.map((p) => (
            <div key={p.id} className="space-y-1 rounded-md border p-2 text-xs">
              <p>
                <strong>{p.origem === "atraso" ? "Contrato em atraso" : "Pedido de distrato"}</strong> · {p.unidade} ·{" "}
                <Link className="underline" href={`/prontuarios/${p.client_id}?aba=financeiro`}>
                  {p.cliente ?? "cliente"}
                </Link>{" "}
                · venda {p.venda ?? "—"} · {data(p.pedido_em)}
                {p.quem_pediu ? ` · pedido por ${p.quem_pediu}` : ""}
              </p>
              <p className="text-muted-foreground">{p.motivo}</p>
              {p.pode_decidir && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link className="text-xs underline" href={`/prontuarios/${p.client_id}`}>
                    Abrir o distrato pela ficha
                  </Link>
                  <input
                    value={motivo[p.id] ?? ""}
                    onChange={(e) => setMotivo((x) => ({ ...x, [p.id]: e.target.value }))}
                    placeholder="Por que manter o contrato"
                    className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                  />
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={ocupado} onClick={() => manter(p.id)}>
                    Manter o contrato
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {abertos.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Distratos abertos ({abertos.length})</p>
          {abertos.map((a) => (
            <p key={a.id} className="text-xs">
              <Link className="underline" href={`/cancelamentos/${a.id}/termo`}>
                {a.codigo}
              </Link>{" "}
              · {a.unidade} · {a.cliente ?? "—"} · {a.tipo === "venda_direta" ? "venda direta" : "contrato"} ·{" "}
              {a.situacao === "assinado" ? "termo assinado" : "rascunho"} · checklist {a.itens_feitos} de 8 · aberto há {a.dias} dia(s)
              {a.dias > 30 && <strong className="text-rose-700"> (mais de 30 dias)</strong>}
            </p>
          ))}
        </div>
      )}

      {devolucoes.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Devoluções (estorno pelo Asaas e Pix da conta da unidade)</p>
          {devolucoes.map((v) => (
            <div key={`${v.tipo}-${v.id}`} className="space-y-1 rounded-md border p-2 text-xs">
              <p>
                <strong>{formatBRL(v.valor)}</strong> · {v.tipo === "estorno_asaas" ? "estorno pelo Asaas" : "Pix da conta da unidade"} ·{" "}
                {v.origem} · {v.unidade} · {v.cliente ?? "—"} · {data(v.pedido_em)} · {SITUACAO[v.situacao] ?? v.situacao}
              </p>
              <p className="text-muted-foreground">
                {v.motivo}
                {v.quem_pediu ? ` — pedido por ${v.quem_pediu}` : ""}
                {v.nota ? ` · ${v.nota}` : ""}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {v.termo && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => abrirTermo(v.termo!)}>
                    Ver o termo
                  </Button>
                )}
                {v.pode_decidir && (
                  <>
                    <input
                      value={motivo[v.id] ?? ""}
                      onChange={(e) => setMotivo((x) => ({ ...x, [v.id]: e.target.value }))}
                      placeholder="Nota (obrigatória para negar)"
                      className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                    />
                    <Button size="sm" className="h-7 text-xs" disabled={ocupado} onClick={() => decidir(v.id, true)}>
                      Autorizar
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={ocupado} onClick={() => decidir(v.id, false)}>
                      Negar
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
