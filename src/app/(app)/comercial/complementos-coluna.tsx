import Link from "next/link";
import { FilePlus2 } from "lucide-react";

export type CartaoDeComplemento = {
  planId: string;
  clientId: string;
  nome: string;
  numero: number | null;
  unidade: string | null;
  /** "aguardando apresentação", "em negociação", "aceito — fechamento"… */
  situacao: string;
};

/**
 * AP64 (0357, C4): a coluna "Complementos", no começo do quadro do Comercial.
 * Um cartão por plano complementar aprovado e ainda não vendido. O cliente está
 * em tratamento (Fase 5); o cartão abre o cockpit no modo complemento. Sai da
 * coluna quando a venda do complemento fecha.
 */
export function ComplementosColuna({ cartoes }: { cartoes: CartaoDeComplemento[] }) {
  if (cartoes.length === 0) return null;
  return (
    <section className="flex w-72 shrink-0 flex-col rounded-xl border border-violet-300 bg-violet-50/60 dark:border-violet-800 dark:bg-violet-950/30">
      <header className="flex items-center justify-between border-b border-violet-200 px-3 py-2 dark:border-violet-800">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-violet-950 dark:text-violet-100">
          <FilePlus2 className="size-4" />
          Complementos
        </span>
        <span className="rounded-full bg-violet-200 px-2 text-xs font-medium text-violet-950 dark:bg-violet-900 dark:text-violet-100">
          {cartoes.length}
        </span>
      </header>
      <p className="px-3 pt-2 text-[11px] text-violet-900/80 dark:text-violet-200/80">
        Clientes em tratamento com plano complementar aprovado. A venda original
        continua valendo.
      </p>
      <ul className="flex-1 space-y-2 overflow-y-auto p-2">
        {cartoes.map((c) => (
          <li key={c.planId}>
            <Link
              href={`/comercial/${c.clientId}?complemento=${c.planId}`}
              className="block rounded-lg border border-violet-200 bg-card px-3 py-2 text-sm shadow-sm hover:border-violet-400 dark:border-violet-800"
            >
              <span className="block font-medium">{c.nome}</span>
              <span className="block text-xs text-muted-foreground">
                Complemento {c.numero ?? ""} · {c.situacao}
                {c.unidade ? ` · ${c.unidade}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
