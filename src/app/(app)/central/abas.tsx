import Link from "next/link";
import type { AbaDaCentral } from "@/lib/central/central";
import { cn } from "@/lib/utils";

/** As abas da Central que ESTA pessoa vê (ver `abasVisiveis`), na ordem da tela. */
export function AbasDaCentral({
  abas,
  ativa,
  hrefDaAba,
}: {
  abas: AbaDaCentral[];
  ativa: string;
  hrefDaAba: (aba: string) => string;
}) {
  return (
    <nav className="flex flex-wrap gap-1 border-b" aria-label="Abas da Central de Configuração">
      {abas.map((a) => (
        <Link
          key={a.id}
          href={hrefDaAba(a.id)}
          aria-current={a.id === ativa ? "page" : undefined}
          title={a.descricao}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm",
            a.id === ativa
              ? "border-primary font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {a.rotulo}
        </Link>
      ))}
    </nav>
  );
}

/** O aviso de que a estrutura ainda não existe neste banco. */
export function AvisoSemMigracao() {
  return (
    <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      A conta Asaas ainda não existe neste banco (faltam as migrações 4000 a 4002). Nada pode ser gravado nesta aba até
      elas rodarem.
    </p>
  );
}
