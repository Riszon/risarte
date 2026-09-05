import Link from "next/link";
import { cn } from "@/lib/utils";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";

/**
 * Os alertas, reunidos.
 *
 * ⚠️ ESTA ABA NÃO CALCULA NADA. Ela LÊ o que os módulos já apuraram — os
 * quatro alertas financeiros do FIN7.3 e os três do Estoque. Recalcular aqui
 * criaria uma segunda régua para o mesmo número, e a hora em que as duas
 * discordassem seria justamente a hora em que alguém precisa confiar nelas
 * (é a mesma decisão do painel da rede, FIN8.3).
 *
 * E não abre porta nova: cada fonte traz a guarda que já tem. Quem não vê
 * financeiro não vê alerta financeiro.
 */

export type Alerta = {
  origem: "Financeiro" | "Estoque";
  gravidade: "alta" | "media" | "baixa";
  titulo: string;
  detalhe: string;
  valorCentavos: number | null;
  unidade: string | null;
  desde: string | null;
  onde: string;
};

const ORDEM = { alta: 0, media: 1, baixa: 2 } as const;

const ESTILO = {
  // Vermelho é só o que já dói; amarelo é o que ainda dá para resolver. Se
  // tudo fosse vermelho, a lista deixaria de ordenar prioridade.
  alta: "border-l-red-500 bg-red-500/5",
  media: "border-l-amber-500 bg-amber-500/5",
  baixa: "border-l-muted-foreground/40 bg-muted/30",
} as const;

const brl = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

export function Alertas({
  alertas,
  podeVerEstoque,
}: {
  alertas: Alerta[];
  podeVerEstoque: boolean;
}) {
  const ordenados = [...alertas].sort(
    (a, b) => ORDEM[a.gravidade] - ORDEM[b.gravidade]
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        O que o sistema está avisando agora. Aparece aqui apenas o que você já
        podia ver nos módulos — esta tela reúne, não libera.
      </p>

      {ordenados.length === 0 ? (
        <div className="rounded-lg border p-6 text-center">
          <p className="text-sm font-medium">Nenhum alerta em aberto.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {podeVerEstoque
              ? "Financeiro e Estoque estão sem pendência de alerta para esta unidade."
              : "Escolha uma unidade no menu lateral para ver também os alertas de estoque."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {ordenados.map((a, i) => (
            <li
              key={i}
              className={cn("rounded-r-lg border border-l-4 p-3", ESTILO[a.gravidade])}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">{a.titulo}</p>
                <span className="text-xs text-muted-foreground">
                  {a.origem}
                  {a.unidade && ` · ${a.unidade}`}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{a.detalhe}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                {a.valorCentavos !== null && (
                  <span className="font-medium">{brl(a.valorCentavos)}</span>
                )}
                {a.desde && (
                  <span className="text-muted-foreground">
                    desde{" "}
                    {new Date(a.desde).toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE,
                      day: "2-digit",
                      month: "2-digit",
                    })}
                  </span>
                )}
                <Link href={a.onde} className="text-primary underline underline-offset-2">
                  Abrir {a.origem}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
        <strong className="font-medium text-foreground">O que não está aqui:</strong>{" "}
        os alertas financeiros são apurados uma vez por dia, às 9h — esta tela
        mostra o retrato da última apuração, não um cálculo do momento. Os de
        estoque são calculados ao abrir.
      </p>
    </div>
  );
}
