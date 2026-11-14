import Link from "next/link";
import { formatBRL } from "@/lib/pricing";
import { formatIsoDateBr } from "@/lib/dates";
import { valorDevido } from "@/lib/finance/dividas";
import { qualidadeDosDados } from "@/lib/finance/dividas-qualidade";
import type { BaseDasDividas, Divida } from "./dados";

/**
 * QUALIDADE DOS DADOS (sugestão 1, fase 4): o que falta completar nas
 * dívidas — sobretudo nas que vieram da planilha. Cada problema abre a lista,
 * com o link para a dívida.
 */
export function Qualidade({ base, dividas, hoje, prazoDaConferencia }: { base: BaseDasDividas; dividas: Divida[]; hoje: string; prazoDaConferencia: number }) {
  const grupos = qualidadeDosDados(dividas, {
    documentoDoCredor: new Map(base.credores.map((c) => [c.id, c.documento])),
    nomeDaCategoria: new Map(base.categorias.map((c) => [c.id, c.nome])),
    hoje,
    prazoDaConferencia,
  });
  const porId = new Map(dividas.map((d) => [d.id, d]));
  const devedor = new Map(base.devedores.map((d) => [d.id, d.nome]));
  const credor = new Map(base.credores.map((c) => [c.id, c.nome]));
  const comAlgo = new Set(grupos.flatMap((g) => g.ids)).size;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {comAlgo === 0
          ? "Nenhuma dívida com dado faltando."
          : `${comAlgo} de ${dividas.length} dívidas têm algo a completar. Quitadas e baixadas não entram.`}
      </p>
      {grupos.map((g) => (
        <details key={g.codigo} className="rounded-lg border p-3" open={false}>
          <summary className="cursor-pointer">
            <span className="font-medium">{g.rotulo}</span>
            <span className={g.ids.length ? "ml-2 rounded bg-amber-100 px-2 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-200" : "ml-2 text-xs text-muted-foreground"}>
              {g.ids.length}
            </span>
            <p className="text-xs text-muted-foreground">{g.explicacao}</p>
          </summary>
          {g.ids.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {g.ids.map((id) => {
                const d = porId.get(id)!;
                return (
                  <li key={id}>
                    <Link href={`/financeiro/dividas/${id}`} className="font-medium underline">
                      {d.code}
                    </Link>{" "}
                    · {devedor.get(d.clinicId) ?? "—"} · {credor.get(d.supplierId) ?? "—"} · vence {formatIsoDateBr(d.dueDate)} ·{" "}
                    {formatBRL(valorDevido(d))}
                  </li>
                );
              })}
            </ul>
          )}
        </details>
      ))}
    </div>
  );
}
