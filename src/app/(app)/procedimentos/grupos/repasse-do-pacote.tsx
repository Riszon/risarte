import { formatBRL } from "@/lib/pricing";
import { precoNoPacote } from "@/lib/procedimentos/grupos";
import { percentualDoValor, textoDoPercentual } from "@/lib/finance/repasse-percentual";

export type RepasseDoNivel = { amountCents: number; source: string };

/**
 * QUANTO A UNIDADE PAGA DE REPASSE NO PACOTE (pedido do dono, 27/10/2026).
 * Por procedimento e por nível de carreira, o mesmo repasse do cartão do
 * procedimento (`payout_matrix`, os quatro degraus da apuração), com o
 * percentual calculado sobre o preço NO PACOTE — é sobre ele que a clínica
 * recebe. O repasse é fixo: o desconto do pacote aumenta o percentual.
 */
export function RepasseDoPacote({
  itens,
  precoDe,
  ajustePercent,
  niveis,
  repasses,
  unidade,
}: {
  itens: { procedureId: string; quantidade: number; nome: string }[];
  precoDe: Map<string, number>;
  ajustePercent: number;
  niveis: { id: string; name: string }[];
  repasses: Record<string, Record<string, RepasseDoNivel>>;
  /** Nome da unidade ativa (o repasse pode ter valor próprio da unidade). */
  unidade: string | null;
}) {
  if (niveis.length === 0 || itens.length === 0) return null;
  const linhas = itens.map((i) => ({
    ...i,
    pacoteCents: precoNoPacote(precoDe.get(i.procedureId) ?? 0, ajustePercent) * i.quantidade,
  }));
  const totalDoPacote = linhas.reduce((s, l) => s + l.pacoteCents, 0);
  const celula = (valorCents: number | null, baseCents: number, doCadastro = false) => {
    if (valorCents === null) return <span className="text-destructive">sem repasse</span>;
    const pct = percentualDoValor(valorCents, baseCents);
    return (
      <span className={doCadastro ? "italic" : undefined} title={doCadastro ? "Valor do cadastro do procedimento — o nível não tem valor próprio." : undefined}>
        <span className="tabular-nums">{formatBRL(valorCents)}</span>
        {pct !== null && <span className="tabular-nums text-muted-foreground"> · {textoDoPercentual(pct)}</span>}
      </span>
    );
  };

  return (
    <details className="mt-2 rounded-lg border bg-muted/10 p-2 text-xs">
      <summary className="cursor-pointer font-medium">
        Repasse ao dentista no pacote{unidade ? ` (${unidade})` : ""}
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-max text-left">
          <thead className="text-[10px] text-muted-foreground">
            <tr>
              <th className="py-1 pr-3 font-medium">Procedimento</th>
              <th className="py-1 pr-3 font-medium">No pacote</th>
              {niveis.map((n) => (
                <th key={n.id} className="py-1 pr-3 font-medium">{n.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.procedureId} className="border-t">
                <td className="py-1 pr-3">
                  {l.nome}
                  {l.quantidade > 1 && ` × ${l.quantidade}`}
                </td>
                <td className="py-1 pr-3 tabular-nums">{formatBRL(l.pacoteCents)}</td>
                {niveis.map((n) => {
                  const r = repasses[l.procedureId]?.[n.id];
                  return (
                    <td key={n.id} className="py-1 pr-3">
                      {celula(r ? r.amountCents * l.quantidade : null, l.pacoteCents, r ? r.source !== "nivel" : false)}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="border-t font-medium">
              <td className="py-1 pr-3">Total do pacote</td>
              <td className="py-1 pr-3 tabular-nums">{formatBRL(totalDoPacote)}</td>
              {niveis.map((n) => {
                const falta = linhas.some((l) => !repasses[l.procedureId]?.[n.id]);
                const soma = linhas.reduce((s, l) => s + (repasses[l.procedureId]?.[n.id]?.amountCents ?? 0) * l.quantidade, 0);
                return (
                  <td key={n.id} className="py-1 pr-3">
                    {celula(soma, totalDoPacote)}
                    {falta && <span className="text-destructive"> (falta repasse)</span>}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        O mesmo repasse do cadastro de cada procedimento (em itálico = valor do cadastro, o nível
        não tem valor próprio). O percentual é sobre o preço <strong>no pacote</strong> (preço padrão
        da rede com o ajuste, um de cada) — o repasse é fixo, então o desconto do pacote aumenta o
        percentual. Procedimento de dente paga um repasse por dente.
      </p>
    </details>
  );
}
