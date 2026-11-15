"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { salvarMaquininhaDaVendaDireta } from "./maquininha-actions";

/** ASA4 (4013): a chave da maquininha na venda direta (Admin Master; fica na auditoria). */
export function MaquininhaDaVendaDireta({ ligada }: { ligada: boolean }) {
  const router = useRouter();
  const [ocupado, start] = useTransition();
  const [confirmar, setConfirmar] = useState(false);
  const mudar = () =>
    start(async () => {
      const r = await salvarMaquininhaDaVendaDireta(!ligada);
      if (!r.ok) toast.error(r.error);
      else {
        toast.success(ligada ? "Maquininha desligada na venda direta." : "Maquininha ligada na venda direta.");
        setConfirmar(false);
        router.refresh();
      }
    });
  return (
    <section className="space-y-2 rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold">Maquininha no cartão parcelado da venda direta</h3>
      <p className="text-xs text-muted-foreground">
        {ligada
          ? "Ligada: a venda direta nova ainda oferece o cartão parcelado na maquininha, ao lado do cartão parcelado pelo Asaas."
          : "Desligada: a venda direta nova oferece só o cartão parcelado pelo Asaas. As vendas antigas na maquininha continuam até a última parcela."}{" "}
        Desligue depois do teste do cartão parcelado pelo Asaas. A mudança fica na Auditoria.
      </p>
      {!confirmar ? (
        <Button size="sm" variant={ligada ? "outline" : "default"} className="h-8" disabled={ocupado} onClick={() => setConfirmar(true)}>
          {ligada ? "Desligar a maquininha" : "Ligar a maquininha"}
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs">{ligada ? "Desligar a maquininha na venda direta nova?" : "Ligar de novo a maquininha na venda direta nova?"}</span>
          <Button size="sm" className="h-8" disabled={ocupado} onClick={mudar}>
            Confirmar
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setConfirmar(false)}>
            Voltar
          </Button>
        </div>
      )}
    </section>
  );
}
