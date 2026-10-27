import { Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { rotuloDoPacote, type LinhaDoPacote } from "@/lib/procedimentos/grupos";

/**
 * "Pacote X: de R$ … por R$ …" (0325, GP6) — uma linha por grupo de
 * procedimentos que mudou o preço dos seus itens. Os itens continuam um a um;
 * esta linha só mostra a vantagem (ou o acréscimo) do pacote. Usada no plano,
 * no orçamento impresso e na apresentação, para as três dizerem o mesmo.
 */
export function LinhasDoPacote({
  linhas,
  className,
}: {
  linhas: LinhaDoPacote[];
  className?: string;
}) {
  if (linhas.length === 0) return null;
  return (
    <ul className={cn("space-y-0.5 text-xs", className)}>
      {linhas.map((l) => (
        <li key={l.grupoId} className="flex flex-wrap items-center gap-x-1.5">
          <Tag className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="font-medium">{rotuloDoPacote(l.nome)}:</span>
          <span>
            de <span className="tabular-nums line-through">{formatBRL(l.deCents)}</span> por{" "}
            <strong className="tabular-nums">{formatBRL(l.porCents)}</strong>
          </span>
        </li>
      ))}
    </ul>
  );
}
