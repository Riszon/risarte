import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Uma pessoa ligada ao paciente (titular, dependente, colega do Empresarial)
 * como ficha pequena e clicável. Sem `href`, é só texto: a pessoa ainda não
 * é cliente.
 */
export function PessoaChip({
  href,
  nome,
  codigo,
  etiqueta,
  apagado = false,
}: {
  href?: string | null;
  nome: string;
  codigo?: string | null;
  etiqueta?: string | null;
  /** Vínculo encerrado / inativo: a ficha fica em cinza. */
  apagado?: boolean;
}) {
  const classe = cn(
    "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
    href ? "transition-colors hover:border-primary/40 hover:bg-muted/40" : "",
    apagado ? "text-muted-foreground" : "text-foreground"
  );
  const miolo = (
    <>
      <span className="truncate font-medium">{nome}</span>
      {codigo && <span className="font-mono text-[10px] text-muted-foreground">{codigo}</span>}
      {etiqueta && (
        <span className="text-[10px] uppercase text-muted-foreground">{etiqueta}</span>
      )}
    </>
  );
  return href ? (
    <Link href={href} className={classe} title={nome}>
      {miolo}
    </Link>
  ) : (
    <span className={classe} title={nome}>
      {miolo}
    </span>
  );
}
