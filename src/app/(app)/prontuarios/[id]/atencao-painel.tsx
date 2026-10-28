import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * O PAINEL "PRECISA DE ATENÇÃO" DO PRONTUÁRIO (28/10/2026).
 *
 * Todos os avisos da ficha num lugar só, uma linha por aviso, com o botão da
 * ação ao lado: decisão pendente, alertas da anamnese, cadastro incompleto,
 * controle de qualidade, cobrança em atraso, anamnese para preencher. Antes
 * cada um era uma caixa colorida própria, empilhada entre o cabeçalho e as
 * abas — seis entregas diferentes, seis molduras diferentes. Sem nada a
 * avisar, o painel não aparece.
 *
 * Quem monta decide o que entra (a página sabe as permissões); aqui só o
 * desenho. `quantos` é a contagem do título: a página soma os avisos que
 * de fato renderizou.
 */
export function AtencaoPainel({
  quantos,
  children,
}: {
  quantos: number;
  children: ReactNode;
}) {
  if (quantos === 0) return null;
  return (
    <section
      aria-label="Precisa de atenção"
      className="rounded-xl border border-destructive/30 bg-destructive/[0.04] ring-1 ring-destructive/10 dark:bg-destructive/10"
    >
      <h2 className="flex items-center gap-2 border-b border-destructive/15 px-3 py-2 text-sm font-semibold text-destructive">
        <AlertTriangle className="size-4" />
        Precisa de atenção
        <span className="rounded-full bg-destructive/10 px-1.5 text-xs font-medium tabular-nums">
          {quantos}
        </span>
      </h2>
      <ul className="divide-y divide-destructive/10">{children}</ul>
    </section>
  );
}

/**
 * Uma linha do painel. `tom` separa o que é urgente (vermelho) do que é
 * lembrete (âmbar); `acao` é o botão à direita, sempre um link.
 */
export function AtencaoItem({
  icone: Icone = AlertTriangle,
  tom = "vermelho",
  titulo,
  children,
  acao,
}: {
  icone?: LucideIcon;
  tom?: "vermelho" | "ambar";
  titulo: ReactNode;
  children?: ReactNode;
  acao?: { href: string; rotulo: string } | null;
}) {
  const cor =
    tom === "ambar"
      ? "text-amber-700 dark:text-amber-300"
      : "text-destructive";
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-3 py-2 text-sm">
      <Icone className={cn("mt-0.5 size-4 shrink-0", cor)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={cn("font-medium", cor)}>{titulo}</p>
        {children && <div className="mt-0.5 text-xs text-foreground/80">{children}</div>}
      </div>
      {acao && (
        <Link
          href={acao.href}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-md border bg-background px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          {acao.rotulo}
          <ChevronRight className="size-3.5" />
        </Link>
      )}
    </li>
  );
}
