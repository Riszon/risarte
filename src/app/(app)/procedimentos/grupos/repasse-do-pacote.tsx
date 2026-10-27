import { formatBRL } from "@/lib/pricing";
import { pisoDoPacote, precoNoPacote } from "@/lib/procedimentos/grupos";
import { textoDosPercentuais } from "@/lib/finance/repasse-percentual";

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
  minimoPercent = null,
  niveis,
  repasses,
  unidade,
}: {
  itens: { procedureId: string; quantidade: number; nome: string }[];
  precoDe: Map<string, number>;
  ajustePercent: number;
  /** 0326: o mínimo da negociação em % da tabela (nulo = sem mínimo). */
  minimoPercent?: number | null;
  niveis: { id: string; name: string }[];
  repasses: Record<string, Record<string, RepasseDoNivel>>;
  /** Nome da unidade ativa (o repasse pode ter valor próprio da unidade). */
  unidade: string | null;
}) {
  if (niveis.length === 0 || itens.length === 0) return null;
  const linhas = itens.map((i) => {
    const tabelaCents = (precoDe.get(i.procedureId) ?? 0) * i.quantidade;
    return {
      ...i,
      pacoteCents: precoNoPacote(precoDe.get(i.procedureId) ?? 0, ajustePercent) * i.quantidade,
      // O mínimo de cada item: o % do grupo sobre a tabela dele (0326).
      minimoCents: minimoPercent ? pisoDoPacote(tabelaCents, minimoPercent) : null,
    };
  });
  const totalDoPacote = linhas.reduce((s, l) => s + l.pacoteCents, 0);
  const totalDaTabela = linhas.reduce((s, l) => s + (precoDe.get(l.procedureId) ?? 0) * l.quantidade, 0);
  const minimoDoPacote = minimoPercent ? pisoDoPacote(totalDaTabela, minimoPercent) : null;
  // Pedido do dono (27/10/2026): o repasse sobre o preço NORMAL (no pacote) e
  // sobre o MÍNIMO — o pior caso da negociação.
  const celula = (valorCents: number | null, baseCents: number, minimoCents: number | null, doCadastro = false) => {
    if (valorCents === null) return <span className="text-destructive">sem repasse</span>;
    const pcts = textoDosPercentuais(valorCents, baseCents, minimoCents, { preco: "do pacote", minimo: "no mínimo" });
    return (
      <span className={doCadastro ? "italic" : undefined} title={doCadastro ? "Valor do cadastro do procedimento — o nível não tem valor próprio." : undefined}>
        <span className="tabular-nums">{formatBRL(valorCents)}</span>
        {pcts !== null && <span className="block tabular-nums text-[10px] text-muted-foreground">{pcts}</span>}
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
              {minimoPercent ? <th className="py-1 pr-3 font-medium">Mínimo</th> : null}
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
                {l.minimoCents !== null && <td className="py-1 pr-3 tabular-nums">{formatBRL(l.minimoCents)}</td>}
                {niveis.map((n) => {
                  const r = repasses[l.procedureId]?.[n.id];
                  return (
                    <td key={n.id} className="py-1 pr-3">
                      {celula(r ? r.amountCents * l.quantidade : null, l.pacoteCents, l.minimoCents, r ? r.source !== "nivel" : false)}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="border-t font-medium">
              <td className="py-1 pr-3">Total do pacote</td>
              <td className="py-1 pr-3 tabular-nums">{formatBRL(totalDoPacote)}</td>
              {minimoDoPacote !== null && <td className="py-1 pr-3 tabular-nums">{formatBRL(minimoDoPacote)}</td>}
              {niveis.map((n) => {
                const comRepasse = linhas.filter((l) => repasses[l.procedureId]?.[n.id]);
                const soma = comRepasse.reduce((s, l) => s + repasses[l.procedureId][n.id].amountCents * l.quantidade, 0);
                // Nenhum procedimento com repasse neste nível: "sem repasse", nunca
                // "R$ 0,00 · 0%" (que leria como repasse zero).
                if (comRepasse.length === 0) {
                  return (
                    <td key={n.id} className="py-1 pr-3">
                      {celula(null, totalDoPacote, minimoDoPacote)}
                    </td>
                  );
                }
                return (
                  <td key={n.id} className="py-1 pr-3">
                    {celula(soma, totalDoPacote, minimoDoPacote)}
                    {comRepasse.length < linhas.length && (
                      <span className="text-destructive"> (falta repasse)</span>
                    )}
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
        da rede com o ajuste, um de cada) e, quando o grupo tem mínimo, também sobre o{" "}
        <strong>mínimo</strong> — o pior caso da negociação. O repasse é fixo: quanto mais desconto,
        maior o percentual. Procedimento de dente paga um repasse por dente.
      </p>
    </details>
  );
}
