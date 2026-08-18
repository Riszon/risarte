"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  HandCoins,
  BookOpen,
  CreditCard,
  Landmark,
  Network,
  Receipt,
  Settings2,
  Truck,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  // FIN6.1: a pergunta que decide — "o mês deu lucro?".
  { href: "/financeiro/dre", label: "DRE", icon: BarChart3 },
  // FIN6.2: a outra pergunta, que quebra clínica lucrativa — "tenho dinheiro?".
  { href: "/financeiro/fluxo-de-caixa", label: "Fluxo de caixa", icon: Wallet },
  { href: "/financeiro/contas-a-pagar", label: "Contas a pagar", icon: Receipt },
  { href: "/financeiro/conciliacao", label: "Conciliação", icon: Landmark },
  { href: "/financeiro/adquirentes", label: "Adquirentes", icon: CreditCard },
  { href: "/financeiro/repasses", label: "Repasses", icon: HandCoins },
  // FIN6.0: comprar um bem não é gastar — ele vira despesa aos poucos.
  { href: "/financeiro/bens", label: "Bens", icon: Building2 },
  { href: "/financeiro/fornecedores", label: "Fornecedores", icon: Truck },
  { href: "/financeiro/configuracao", label: "Configuração", icon: Settings2 },
  { href: "/financeiro/centros-de-custo", label: "Centros de custo", icon: Network },
  { href: "/financeiro/plano-de-contas", label: "Plano de contas", icon: BookOpen },
];

/** Abas do módulo Financeiro (FIN0). Novas fases entram aqui. */
export function FinanceNav() {
  const pathname = usePathname();

  return (
    <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors",
                active
                  ? "border-gold font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-4" />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
