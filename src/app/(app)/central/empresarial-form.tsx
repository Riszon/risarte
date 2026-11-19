"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { salvarEmpresarialNoAsaas } from "./empresarial-actions";

type Conta = {
  id: string;
  label: string;
  environment: string;
  status: string;
  tem_chave: boolean;
  tem_carteira: boolean;
  tem_webhook: boolean;
};

/** Ligar o Empresarial pelo Asaas (a data de início) e escolher a conta da RisLife. */
export function FormularioDoEmpresarial({
  podeConfigurar,
  ligadoDesde,
  contaRislife,
  contas,
}: {
  podeConfigurar: boolean;
  ligadoDesde: string | null;
  contaRislife: string | null;
  contas: Conta[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [data, setData] = useState(ligadoDesde ?? "");
  const [conta, setConta] = useState(contaRislife ?? "");
  const escolhida = contas.find((c) => c.id === conta);
  const falta = escolhida
    ? [
        escolhida.status !== "active" && "ativa",
        !escolhida.tem_chave && "a chave de API",
        !escolhida.tem_carteira && "a carteira",
        !escolhida.tem_webhook && "o webhook",
      ].filter(Boolean)
    : [];

  function salvar(desligar = false) {
    startTransition(async () => {
      const r = await salvarEmpresarialNoAsaas({ ligadoDesde: desligar ? null : data || null, contaRislife: conta || null });
      if (r.ok) {
        toast.success(desligar ? "O Empresarial pelo Asaas foi desligado." : "Salvo.");
        if (desligar) setData("");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  if (!podeConfigurar) {
    return <p className="text-xs text-muted-foreground">Só o Admin Master e o Financeiro da Franqueadora ligam e escolhem a conta.</p>;
  }
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="emp-conta" className="text-xs">
            A conta da RisLife
          </Label>
          <select
            id="emp-conta"
            value={conta}
            onChange={(e) => setConta(e.target.value)}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          >
            <option value="">— escolha —</option>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.environment === "production" ? "produção" : "sandbox"})
              </option>
            ))}
          </select>
          {escolhida && falta.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">Falta: {falta.join(", ")} (aba Conta e tarifas).</p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="emp-data" className="text-xs">
            Cobrar pelo Asaas a partir de
          </Label>
          <Input id="emp-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        A data vale para a rede inteira: toda cobrança gerada desde ela sai no Asaas. As abertas de antes continuam
        manuais, com o botão “Emitir no Asaas”.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={isPending} onClick={() => salvar(false)}>
          {isPending ? "Salvando..." : "Salvar"}
        </Button>
        {ligadoDesde && (
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => salvar(true)}>
            Desligar
          </Button>
        )}
      </div>
    </div>
  );
}
