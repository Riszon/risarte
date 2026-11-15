"use client";

/**
 * 4017a (19.30.1) — quando o cancelamento da venda é recusado por acordo de
 * renegociação: os acordos da venda e o caminho de cada um.
 *   - ainda não vale → "Cancelar o acordo pendente" (e o cancelamento segue);
 *   - assinado, só desta venda → "Pedir exceção ao Financeiro" (Gerente/Admin);
 *   - junta outras vendas → fica para o distrato.
 * A Recepção vê o motivo e a orientação de chamar o Gerente.
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/pricing";
import { lerAcordosDaVenda, pedirExcecao, type AcordosDaVenda } from "@/app/(app)/financeiro/cobrancas-automaticas/excecao-actions";
import { cancelarRenegociacaoPendente } from "@/app/(app)/prontuarios/[id]/renegociacao-actions";

const SITUACAO: Record<string, string> = {
  aguardando_autorizacao: "aguardando autorização",
  aguardando_assinatura: "aguardando assinatura",
  aplicada: "assinado",
};
const EXCECAO: Record<string, string> = {
  pedida: "Pedido de exceção enviado ao Financeiro — aguardando a decisão.",
  autorizada: "Exceção autorizada: o cancelamento pode seguir.",
  negada: "Exceção negada pelo Financeiro.",
  usada: "Exceção já usada.",
  caiu: "A exceção autorizada não vale mais (venceu ou o acordo mudou). Peça de novo.",
};

export function AcordosDaVenda({
  clientId,
  negotiationId = null,
  directSaleId = null,
}: {
  clientId: string;
  negotiationId?: string | null;
  directSaleId?: string | null;
}) {
  const router = useRouter();
  const [dados, setDados] = useState<AcordosDaVenda | null>(null);
  const [isPending, start] = useTransition();
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let vivo = true;
    void lerAcordosDaVenda({ negotiationId, directSaleId }).then((r) => {
      if (vivo && r.ok) setDados({ pode_pedir: r.pode_pedir, acordos: r.acordos, excecao: r.excecao });
    });
    return () => {
      vivo = false;
    };
  }, [negotiationId, directSaleId, versao]);

  if (!dados) return null;
  const pendentes = dados.acordos.filter((a) => a.pendente);
  const multi = dados.acordos.some((a) => a.multi_venda);
  const assinados = dados.acordos.filter((a) => !a.pendente);

  function cancelarPendente(id: string) {
    const motivo = window.prompt("Por que cancelar este acordo que ainda não vale? Nada muda nas parcelas antigas.");
    if (!motivo) return;
    start(async () => {
      const r = await cancelarRenegociacaoPendente({ clientId, renegotiationId: id, motivo });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Acordo cancelado. Agora o cancelamento da venda pode seguir.");
      setVersao((v) => v + 1);
      router.refresh();
    });
  }

  function pedir() {
    const motivo = window.prompt("Por que esta venda precisa ser cancelada agora, com o acordo em aberto?");
    if (!motivo) return;
    start(async () => {
      const r = await pedirExcecao({ negotiationId, directSaleId, motivo, clientId });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Pedido enviado ao Financeiro da Franqueadora.");
      setVersao((v) => v + 1);
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200">
      <p className="font-semibold">Acordos de renegociação desta venda</p>
      <ul className="space-y-1">
        {dados.acordos.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {a.codigo ?? "—"} · {SITUACAO[a.situacao] ?? a.situacao} · em aberto {formatBRL(a.aberto)} · pago {formatBRL(a.pago)}
              {a.multi_venda && " · junta outras vendas"}
            </span>
            {a.pendente && (
              <Button size="sm" variant="outline" className="h-6 text-[10px]" disabled={isPending} onClick={() => cancelarPendente(a.id)}>
                Cancelar o acordo pendente
              </Button>
            )}
          </li>
        ))}
      </ul>
      {multi ? (
        <p>Este acordo junta parcelas de outras vendas. O cancelamento fica para o distrato.</p>
      ) : pendentes.length > 0 ? (
        <p>Cancele o acordo que ainda não vale; depois, o cancelamento da venda segue normal, sem a franqueadora.</p>
      ) : assinados.length > 0 && dados.excecao && dados.excecao.situacao !== "negada" && dados.excecao.situacao !== "usada" && dados.excecao.situacao !== "caiu" ? (
        <p>
          {EXCECAO[dados.excecao.situacao] ?? dados.excecao.situacao}
          {dados.excecao.valida_ate && dados.excecao.situacao === "autorizada" && ` Vale até ${dados.excecao.valida_ate.split("-").reverse().join("/")}.`}
        </p>
      ) : assinados.length > 0 ? (
        dados.pode_pedir ? (
          <div className="space-y-1">
            {dados.excecao && <p>{EXCECAO[dados.excecao.situacao] ?? ""}{dados.excecao.nota ? ` (${dados.excecao.nota})` : ""}</p>}
            <p>
              O acordo está assinado e tem parcela em aberto. Só com a exceção autorizada pelo Financeiro da Franqueadora
              (ou o Admin Master) o cancelamento conta o que o cliente já pagou no acordo e cancela as parcelas abertas dele.
            </p>
            <Button size="sm" className="h-7 text-[11px]" disabled={isPending} onClick={pedir}>
              Pedir exceção ao Financeiro
            </Button>
          </div>
        ) : (
          <p>
            O acordo está assinado e tem parcela em aberto: cancelar a venda agora deixaria as parcelas dele sendo cobradas.
            Chame o Gerente da unidade: só ele (ou o Admin Master) pode pedir a exceção ao Financeiro.
          </p>
        )
      ) : null}
    </div>
  );
}
