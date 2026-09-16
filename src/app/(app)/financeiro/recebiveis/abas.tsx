import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * As visões dos recebíveis — e cada uma responde uma pergunta diferente.
 *
 * *Visão geral* mostra uma linha por COBRANÇA: é o certo para conferir o
 * financeiro. *Inadimplentes* mostra uma linha por PESSOA: é o certo para
 * ligar, porque ninguém liga cinco vezes para quem deve cinco parcelas.
 * Foi a confusão entre as duas que gerou o relato OC-00009.
 *
 * ⚠️ A DA REDE ENTROU AQUI PORQUE NINGUÉM A ACHAVA. Ela sempre existiu, mas
 * dentro do menu suspenso "Rede" — e o dono, procurando relatório de
 * recebíveis, olhou nas telas de recebíveis e concluiu que ela não tinha
 * relatório. A tela não mudou de lugar; ganhou uma segunda porta, onde a
 * pessoa já está quando tem a pergunta.
 */
export function AbasDeRecebiveis({
  ativa,
  veRede = false,
}: {
  ativa: "geral" | "inadimplentes" | "rede";
  /** Só a Franqueadora e o Admin Master enxergam a rede. */
  veRede?: boolean;
}) {
  const abas = [
    { key: "geral", href: "/financeiro/recebiveis", label: "Visão geral" },
    {
      key: "inadimplentes",
      href: "/financeiro/recebiveis/inadimplentes",
      label: "Inadimplentes",
    },
    ...(veRede
      ? ([
          {
            key: "rede",
            href: "/financeiro/recebiveis-da-rede",
            label: "Rede inteira",
          },
        ] as const)
      : []),
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
