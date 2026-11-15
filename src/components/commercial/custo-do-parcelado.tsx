"use client";

import { useEffect, useState } from "react";
import { CreditCard } from "lucide-react";
import { formatBRL } from "@/lib/pricing";
import { erroDoBloco, MAXIMO_DEMAIS_BANDEIRAS, tabelaDeCusto, type FaixaDoParcelado } from "@/lib/asaas/parcelado";
import { lerTabelaDoParcelado } from "@/app/(app)/comercial/parcelado-actions";

/**
 * ASA4 (4013, 19.19.7 item 1): no fechamento, o Consultor vê quanto o
 * parcelamento no cartão pelo Asaas custa à unidade, por número de parcelas —
 * a tarifa do Asaas (que a unidade absorve: o paciente não paga juros), as
 * taxas da rede e o que fica para a unidade. Pelas tarifas vigentes da conta.
 * Também avisa, ao vivo, quando as parcelas não estão como o Asaas faz.
 */
export function CustoDoParcelado({
  clinicId,
  totalCents,
  teto,
  linhas,
  escolhido,
}: {
  clinicId: string;
  totalCents: number;
  teto: number;
  /** As parcelas com o meio "cartão parcelado pelo Asaas" (para o aviso ao vivo). */
  linhas?: { due_date: string; amount_cents: number }[];
  escolhido?: number;
}) {
  const [dados, setDados] = useState<{ faixas: FaixaDoParcelado[]; rede_percent: number } | null | undefined>(undefined);
  useEffect(() => {
    let vivo = true;
    lerTabelaDoParcelado(clinicId)
      .then((d) => vivo && setDados(d))
      .catch(() => vivo && setDados(null));
    return () => {
      vivo = false;
    };
  }, [clinicId]);

  const aviso = linhas && linhas.length ? erroDoBloco(linhas) : null;
  if (dados === undefined) return null;
  const tabela = dados ? tabelaDeCusto(totalCents, teto, dados.faixas, dados.rede_percent) : [];

  return (
    <section className="space-y-2 rounded-lg border bg-card p-3">
      <h4 className="flex items-center gap-1.5 text-sm font-semibold">
        <CreditCard className="size-4 text-primary" /> Cartão parcelado pelo Asaas: quanto custa à unidade
      </h4>
      {aviso && <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-500/15 dark:text-amber-100">{aviso}</p>}
      {!tabela.length ? (
        <p className="text-xs text-muted-foreground">
          As tarifas do cartão parcelado desta unidade ainda não foram lidas do Asaas (Central de Configuração › Conta e tarifas).
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-2 font-medium">Parcelas</th>
                <th className="py-1 pr-2 font-medium">Valor da parcela</th>
                <th className="py-1 pr-2 font-medium">Tarifa do Asaas</th>
                <th className="py-1 pr-2 font-medium">Taxas da rede ({dados!.rede_percent}%)</th>
                <th className="py-1 font-medium">Fica para a unidade</th>
              </tr>
            </thead>
            <tbody>
              {tabela.map((l) => (
                <tr key={l.parcelas} className={l.parcelas === escolhido ? "bg-primary/10 font-medium" : undefined}>
                  <td className="py-0.5 pr-2">
                    {l.parcelas}x{l.soVisaEMaster ? " *" : ""}
                  </td>
                  <td className="py-0.5 pr-2">{formatBRL(l.valorDaParcelaCents)}</td>
                  <td className="py-0.5 pr-2">{formatBRL(l.tarifaCents)}</td>
                  <td className="py-0.5 pr-2">{formatBRL(l.redeCents)}</td>
                  <td className="py-0.5">{formatBRL(l.unidadeCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        O paciente paga sem juros; a unidade absorve a tarifa. Valores iguais, com a sobra dos centavos na última parcela, mês a mês.
        {tabela.some((l) => l.soVisaEMaster) && ` * Acima de ${MAXIMO_DEMAIS_BANDEIRAS}x, só Visa e Mastercard.`}
      </p>
    </section>
  );
}
