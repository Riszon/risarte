"use client";

import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { EVENTO_ABRIR_ABA, type PedidoDeAba } from "./abrir-aba";

/**
 * OC-00184 (17/11/2026, dentista): "Ver anamnese" do painel Precisa de atenção
 * levava a `?aba=clinico`, mas a tela não descia até a anamnese (no celular
 * parecia que nada acontecia) e, no segundo clique, o endereço já era o mesmo
 * e nada acontecia mesmo. Agora o botão pede à barra de abas que troque de aba
 * e role até a seção; sem a barra na tela, segue o link.
 */
export function IrParaSecao({ href, aba, secao, rotulo }: { href: string; aba: string; secao: string; rotulo: string }) {
  const router = useRouter();
  return (
    <a
      href={href}
      onClick={(e) => {
        const pedido: PedidoDeAba = { aba, secao, atendido: false };
        window.dispatchEvent(new CustomEvent<PedidoDeAba>(EVENTO_ABRIR_ABA, { detail: pedido }));
        if (pedido.atendido) e.preventDefault();
        else {
          e.preventDefault();
          router.push(href);
        }
      }}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-md border bg-background px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
    >
      {rotulo}
      <ChevronRight className="size-3.5" />
    </a>
  );
}
