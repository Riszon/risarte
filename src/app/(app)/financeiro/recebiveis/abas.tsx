import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * As duas visões dos recebíveis — e elas respondem perguntas diferentes.
 *
 * *Visão geral* mostra uma linha por COBRANÇA: é o certo para conferir o
 * financeiro. *Inadimplentes* mostra uma linha por PESSOA: é o certo para
 * ligar, porque ninguém liga cinco vezes para quem deve cinco parcelas.
 * Foi a confusão entre as duas que gerou o relato OC-00009.
 */
export function AbasDeRecebiveis({
  ativa,
}: {
  ativa: "geral" | "inadimplentes";
}) {
  const abas = [
    { key: "geral", href: "/financeiro/recebiveis", label: "Visão geral" },
    {
      key: "inadimplentes",
      href: "/financeiro/recebiveis/inadimplentes",
      label: "Inadimplentes",
    },
  ] as const;

  return (
    <nav className="flex gap-1 border-b">
      {abas.map((a) => (
        <Link
          key={a.key}
          href={a.href}
          aria-current={ativa === a.key ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm",
            ativa === a.key
              ? "border-primary font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {a.label}
        </Link>
      ))}
    </nav>
  );
}
