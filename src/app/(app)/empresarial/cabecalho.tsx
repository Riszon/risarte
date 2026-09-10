import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { RisarteMark } from "@/components/risarte-logo";

/**
 * O CABEÇALHO DAS TELAS DO RISARTE EMPRESARIAL.
 *
 * ⚠️ POR QUE UM COMPONENTE, E NÃO A MESMA MARCAÇÃO COPIADA CINCO VEZES. Antes
 * do refinamento de 10/09/2026 cada tela do módulo desenhava o próprio
 * cabeçalho, e elas já tinham divergido: a principal tinha um título solto, as
 * de dentro tinham um link de voltar em cima do título, e nenhuma trazia a
 * marca. Copiada, a marcação diverge de novo na primeira pressa — junta, ela
 * não tem como.
 *
 * ⚠️ ELE NÃO CARREGA COR PRÓPRIA. `bg-primary` já é o bordô do ambiente
 * (`components/ambiente`), então o mesmo componente serviria em qualquer
 * frente sem uma linha de cor escrita aqui. Cor de módulo escrita à mão é
 * exatamente o que a mudança de identidade veio remover.
 *
 * A marca d'água usa `--primary-foreground` a 10%: ela pertence à superfície,
 * não à paleta de realce, então acompanha o contraste do cabeçalho em vez de
 * precisar de um token próprio.
 */
export function CabecalhoEmpresarial({
  chapeu,
  icone: Icone,
  titulo,
  descricao,
  voltar,
  children,
}: {
  /** A linha pequena em versalete acima do título ("Programa corporativo"). */
  chapeu: string;
  icone: LucideIcon;
  /** Texto ou JSX — a ficha da empresa põe o selo de situação ao lado. */
  titulo: React.ReactNode;
  descricao: string;
  /** Quando presente, mostra o caminho de volta. A tela principal não tem. */
  voltar?: { href: string; rotulo: string };
  /** Botões de ação, à direita. */
  children?: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-primary text-primary-foreground">
      <RisarteMark className="pointer-events-none absolute -top-4 -right-6 h-40 text-primary-foreground/10" />
      <div className="relative flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6">
        <div className="min-w-0">
          {voltar ? (
            <Link
              href={voltar.href}
              className="text-xs text-primary-foreground/70 underline-offset-2 hover:text-primary-foreground hover:underline"
            >
              ← {voltar.rotulo}
            </Link>
          ) : (
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-primary-foreground/60">
              <Icone className="size-3.5" />
              {chapeu}
            </p>
          )}
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {titulo}
          </h1>
          <p className="mt-0.5 text-sm text-primary-foreground/70">{descricao}</p>
        </div>
        {children ? (
          <div className="flex flex-wrap items-center gap-2">{children}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Botão que vive SOBRE o cabeçalho colorido.
 *
 * O `variant="outline"` do sistema é desenhado para fundo claro: sobre o bordô
 * ele fica com borda e letra escuras, quase invisíveis. Estas classes são a
 * tradução dele para a superfície forte, num lugar só — espalhadas por cinco
 * telas, bastaria uma passar despercebida para o botão sumir, que foi
 * exatamente o defeito do botão "Painel" em 10/09/2026.
 */
export const BOTAO_NO_CABECALHO =
  "border-primary-foreground/25 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground";
