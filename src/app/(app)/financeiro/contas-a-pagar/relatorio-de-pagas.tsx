"use client";

import { useState } from "react";
import { BotoesDeRelatorio } from "@/components/botoes-de-relatorio";
import { Card, CardContent } from "@/components/ui/card";

/**
 * OC-00110 — o caminho para o RELATÓRIO DE CONTAS PAGAS. O período daqui é
 * pela DATA DO PAGAMENTO; o da lista abaixo é pelo vencimento — perguntas
 * diferentes, e a tela diz as duas.
 */
export function RelatorioDePagas({ hoje }: { hoje: string }) {
  const [de, setDe] = useState(`${hoje.slice(0, 7)}-01`);
  const [ate, setAte] = useState(hoje);

  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 p-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Relatório de contas pagas</p>
          <p className="text-[11px] text-muted-foreground">
            O que foi pago, pela <strong>data do pagamento</strong> — fornecedor,
            conta, forma, multa e juros, e se já foi conferido com o banco na
            Conciliação. (A lista abaixo filtra pelo vencimento; o filtro{" "}
            <strong>Pagas</strong> mostra as contas já quitadas.)
          </p>
        </div>
        <label className="text-[11px] font-medium text-muted-foreground">
          Pago de
          <input
            type="date"
            value={de}
            onChange={(e) => setDe(e.target.value)}
            className="mt-0.5 block h-8 rounded-lg border border-input bg-background px-2 text-xs"
          />
        </label>
        <label className="text-[11px] font-medium text-muted-foreground">
          até
          <input
            type="date"
            value={ate}
            onChange={(e) => setAte(e.target.value)}
            className="mt-0.5 block h-8 rounded-lg border border-input bg-background px-2 text-xs"
          />
        </label>
        <BotoesDeRelatorio
          base="/financeiro/contas-a-pagar/pagas"
          filtros={{ de, ate }}
          desabilitado={!de || !ate}
        />
      </CardContent>
    </Card>
  );
}
