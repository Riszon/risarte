"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ABAS = [
  { href: "/indica-mais-risos/indicacoes", rotulo: "Indicações" },
  { href: "/indica-mais-risos/embaixadores", rotulo: "Embaixadores" },
  { href: "/indica-mais-risos/resgates", rotulo: "Resgates" },
  { href: "/indica-mais-risos/catalogo", rotulo: "Catálogo" },
  { href: "/indica-mais-risos/configuracoes", rotulo: "Configurações" },
];

/** As abas do Indica +Risos, no topo de todas as telas do módulo. */
export function NavIndica() {
  const caminho = usePathname();
  return (
    <nav className="border-b bg-background/60 px-4">
      <ul className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
        {ABAS.map((a) => {
          const ativa = caminho === a.href || caminho.startsWith(`${a.href}/`);
          return (
            <li key={a.href}>
              <Link
                href={a.href}
                className={cn(
                  "inline-block border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors",
                  ativa
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {a.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
