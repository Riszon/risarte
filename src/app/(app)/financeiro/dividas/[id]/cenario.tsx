"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/pricing";
import { formatIsoDateBr } from "@/lib/dates";
import type { Cenario } from "@/lib/finance/dividas-cenario";
import { GraficoDeLinhas } from "@/components/dividas/graficos";
import { cenarioDaProposta } from "../actions";

// "E se eu pagar esta proposta à vista?" (fase 7): o caixa da unidade
// devedora nos próximos 90 dias, sem e com o pagamento. Só na tela — o fluxo
// de caixa oficial não muda.

export function CenarioDaProposta({ debtId, propostaId, valorCents, hoje }: { debtId: string; propostaId: string; valorCents: number; hoje: string }) {
  const [dia, setDia] = useState(hoje);
  const [estado, setEstado] = useState<{ carregando: boolean; erro: string | null; cenario: Cenario | null }>({ carregando: false, erro: null, cenario: null });

  const calcular = async () => {
    setEstado({ carregando: true, erro: null, cenario: null });
    const r = await cenarioDaProposta(debtId, propostaId, dia);
    setEstado({ carregando: false, erro: r.ok ? null : (r.error ?? "Algo deu errado."), cenario: r.cenario ?? null });
  };

  const c = estado.cenario;
  // A cada 7 dias, para o desenho não virar um borrão de 90 pontos.
  const amostra = c ? c.pontos.filter((_, i) => i % 7 === 0 || i === c.pontos.length - 1) : [];

  return (
    <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-[11px] text-muted-foreground">Pagar {formatBRL(valorCents)} em</span>
          <Input type="date" className="h-8 w-40" value={dia} min={hoje} onChange={(e) => setDia(e.target.value)} />
        </label>
        <Button size="sm" variant="outline" disabled={estado.carregando} onClick={calcular}>
          {estado.carregando ? "Calculando…" : "Ver no caixa"}
        </Button>
        <span className="text-muted-foreground">Só um cenário: nada é gravado e o fluxo de caixa não muda.</span>
      </div>
      {estado.erro && <p className="text-destructive">{estado.erro}</p>}
      {c && (
        <>
          <table className="w-full max-w-xl">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1" />
                <th className="py-1 text-right">Sem pagar</th>
                <th className="py-1 text-right">Pagando à vista</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              <tr className="border-t">
                <td className="py-1">Menor saldo em 90 dias</td>
                <td className="py-1 text-right">{formatBRL(c.sem.menorCents)} <span className="text-muted-foreground">({formatIsoDateBr(c.sem.diaDoMenor)})</span></td>
                <td className="py-1 text-right">{formatBRL(c.com.menorCents)} <span className="text-muted-foreground">({formatIsoDateBr(c.com.diaDoMenor)})</span></td>
              </tr>
              <tr className="border-t">
                <td className="py-1">Saldo daqui a 90 dias</td>
                <td className="py-1 text-right">{formatBRL(c.sem.finalCents)}</td>
                <td className="py-1 text-right">{formatBRL(c.com.finalCents)}</td>
              </tr>
            </tbody>
          </table>
          <p className={c.negativoEm ? "font-medium text-red-700 dark:text-red-300" : "text-muted-foreground"}>
            {c.negativoSemEm
              ? `Atenção: o caixa projetado da unidade já fica negativo em ${formatIsoDateBr(c.negativoSemEm)} mesmo SEM pagar; pagando à vista, o menor saldo cai mais ${formatBRL(c.sem.menorCents - c.com.menorCents)}.`
              : c.negativoEm
                ? `Pagando à vista, o caixa da unidade fica negativo em ${formatIsoDateBr(c.negativoEm)}.`
                : "Pagando à vista, o caixa da unidade não fica negativo nos próximos 90 dias."}{" "}
            {c.substituidosCents > 0 && `Deixam de sair ${formatBRL(c.substituidosCents)} de títulos desta dívida que venceriam na janela.`}
          </p>
          <GraficoDeLinhas
            meses={amostra.map((p) => p.dia)}
            series={[
              { chave: "sem", rotulo: "Sem pagar", valores: amostra.map((p) => p.semCents) },
              { chave: "com", rotulo: "Pagando à vista", valores: amostra.map((p) => p.comCents) },
            ]}
            ultimoAoVivo={false}
            rotulo="Saldo do caixa da unidade, sem e com o pagamento à vista"
            largura={720}
            eixoEmDias
          />
        </>
      )}
    </div>
  );
}
