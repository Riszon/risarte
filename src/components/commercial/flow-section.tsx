import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * J6 (refinamento visual): um PASSO do fluxo comercial — numerado, com título e
 * uma linha de ajuda. As duas telas do dinheiro (venda direta e cockpit do
 * consultor) são montadas com este bloco, então quem aprende uma sabe usar a
 * outra.
 *
 * A numeração é a hierarquia: o usuário lê 1 → 2 → 3 e sabe onde está.
 */
export function FlowSection({
  step,
  title,
  hint,
  aside,
  children,
  className,
}: {
  /** Número do passo (1, 2, 3...). */
  step: number;
  title: string;
  /** Uma linha explicando o que se decide aqui. */
  hint?: string;
  /** Conteúdo alinhado à direita do título (selo, valor, ação). */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2", className)}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
          >
            {step}
          </span>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold leading-tight">{title}</h4>
            {hint && (
              <p className="text-[11px] leading-tight text-muted-foreground">
                {hint}
              </p>
            )}
          </div>
        </div>
        {aside}
      </header>
      {/* Indentação alinhada ao número: o conteúdo "pertence" ao passo. */}
      <div className="space-y-2 pl-7">{children}</div>
    </section>
  );
}
