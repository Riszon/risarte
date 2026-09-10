"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  ChevronDown,
  Gauge,
  Landmark,
  Network,
  Receipt,
  Settings2,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * AS ABAS DO FINANCEIRO.
 *
 * ⚠️ ERAM DEZOITO, TODAS DO MESMO PESO. Dezoito nomes lado a lado numa barra
 * que rola não é navegação: é um índice, e quem procura num índice precisa já
 * saber o nome do que quer. O módulo tem telas de todo dia (o painel, a DRE, o
 * caixa, as contas) e telas que se abre uma vez por trimestre (plano de contas,
 * adquirentes, configuração) — tratá-las igual escondia as primeiras no meio
 * das segundas.
 *
 * Agora as de todo dia ficam à mostra e o resto entra em três grupos, pela
 * pergunta que respondem. Foi a mesma queixa do dono sobre a tela de início
 * (*"virou uma longa lista"*), no mesmo dia, e tem a mesma causa: informação
 * sem hierarquia vira lista.
 *
 * ⚠️ O GRUPO INTEIRO SE MARCA QUANDO SE ESTÁ DENTRO DELE. Sem isso, quem
 * estivesse no Plano de contas não veria nada aceso na barra e concluiria que
 * saiu do módulo.
 */

type Item = { href: string; label: string };
type Aba =
  | { tipo: "direta"; href: string; label: string; icon: LucideIcon }
  | { tipo: "grupo"; label: string; icon: LucideIcon; itens: Item[]; soRede?: boolean };

const ABAS: Aba[] = [
  // A porta do módulo (10/09/2026). Antes `/financeiro` era um redirect para a
  // Configuração — entrar num módulo e cair no cadastro dele.
  { tipo: "direta", href: "/financeiro", label: "Painel", icon: Gauge },
  // FIN6.1: a pergunta que decide — "o mês deu lucro?".
  { tipo: "direta", href: "/financeiro/dre", label: "DRE", icon: BarChart3 },
  // FIN6.2: a outra pergunta, que quebra clínica lucrativa — "tenho dinheiro?".
  {
    tipo: "direta",
    href: "/financeiro/fluxo-de-caixa",
    label: "Fluxo de caixa",
    icon: Wallet,
  },
  {
    tipo: "direta",
    href: "/financeiro/contas-a-pagar",
    label: "Contas a pagar",
    icon: Receipt,
  },
  {
    tipo: "direta",
    href: "/financeiro/conciliacao",
    label: "Conciliação",
    icon: Landmark,
  },
  {
    tipo: "grupo",
    label: "Análise",
    icon: BarChart3,
    itens: [
      { href: "/financeiro/ponto-de-equilibrio", label: "Ponto de equilíbrio" },
      { href: "/financeiro/orcamento", label: "Orçamento" },
      { href: "/financeiro/fechamento", label: "Fechamento" },
      { href: "/financeiro/repasses", label: "Repasses" },
    ],
  },
  {
    tipo: "grupo",
    label: "Rede",
    icon: Network,
    soRede: true,
    itens: [
      { href: "/financeiro/painel-da-rede", label: "Painel da rede" },
      { href: "/financeiro/consolidado", label: "Consolidado" },
      { href: "/financeiro/taxas-da-rede", label: "Taxas da rede" },
    ],
  },
  {
    tipo: "grupo",
    label: "Cadastros",
    icon: Settings2,
    itens: [
      { href: "/financeiro/plano-de-contas", label: "Plano de contas" },
      { href: "/financeiro/centros-de-custo", label: "Centros de custo" },
      { href: "/financeiro/fornecedores", label: "Fornecedores" },
      { href: "/financeiro/adquirentes", label: "Adquirentes" },
      { href: "/financeiro/bens", label: "Bens" },
      { href: "/financeiro/configuracao", label: "Configuração" },
    ],
  },
];

const CLASSE_ABA =
  "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors";

export function FinanceNav({ veRede }: { veRede: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4">
        {ABAS.filter((a) => a.tipo !== "grupo" || !a.soRede || veRede).map(
          (aba) => {
            const Icon = aba.icon;

            if (aba.tipo === "direta") {
              const ativa = pathname === aba.href;
              return (
                <Link
                  key={aba.href}
                  href={aba.href}
                  className={cn(
                    CLASSE_ABA,
                    ativa
                      ? "border-gold font-semibold text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="size-4" />
                  {aba.label}
                </Link>
              );
            }

            const dentro = aba.itens.some((i) => pathname === i.href);
            return (
              <DropdownMenu key={aba.label}>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className={cn(
                        CLASSE_ABA,
                        dentro
                          ? "border-gold font-semibold text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Icon className="size-4" />
                      {aba.label}
                      <ChevronDown className="size-3.5 opacity-70" />
                    </button>
                  }
                />
                <DropdownMenuContent align="start" className="w-56">
                  {aba.itens.map((item) => (
                    <DropdownMenuItem
                      key={item.href}
                      onClick={() => router.push(item.href)}
                      className={cn(pathname === item.href && "font-semibold")}
                    >
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          }
        )}
      </div>
    </div>
  );
}
