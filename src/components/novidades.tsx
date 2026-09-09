import { TIPO_ROTULO, type TipoDeMudanca, type Versao } from "@/lib/changelog";
import { cn } from "@/lib/utils";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";

/**
 * O que mudou, por versão.
 *
 * Filtrado pelo papel de quem abre: a correção do CPF na recepção não diz nada
 * ao dentista, e uma lista cheia de coisa que não é sua é uma lista que ninguém
 * lê. O Admin Master vê tudo — é dele que a equipe vai cobrar.
 */

const COR: Record<TipoDeMudanca, string> = {
  novidade: "bg-primary/10 text-primary",
  melhoria: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  correcao: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  aviso: "bg-amber-500/10 text-amber-700 dark:text-amber-500",
};

function dataLonga(iso: string): string {
  // `T12:00` evita o pulo de um dia: `new Date("2026-09-04")` é meia-noite em
  // UTC, que no Brasil ainda é dia 3. É a mesma armadilha da migração 0201.
  return new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE,
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function Novidades({ versoes }: { versoes: Versao[] }) {
  if (versoes.length === 0) {
    return (
      <p className="rounded-lg border p-4 text-sm text-muted-foreground">
        Nada registrado que alcance a sua função por enquanto.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        O registro começa em <strong>25 de agosto de 2026</strong>, quando o
        sistema entrou em preparação de lançamento. Aparece aqui o que muda para{" "}
        <strong>a sua função</strong>.
      </p>

      {versoes.map((v) => (
        <article key={v.versao} className="rounded-lg border">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b bg-muted/40 px-4 py-3">
            <div>
              <h2 className="font-semibold">{v.titulo}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Versão {v.versao}
                {v.migracao && ` · migração ${v.migracao}`}
              </p>
            </div>
            <time className="text-xs text-muted-foreground" dateTime={v.data}>
              {dataLonga(v.data)}
            </time>
          </header>

          <ul className="divide-y">
            {v.mudancas.map((m, i) => (
              <li key={i} className="flex gap-3 px-4 py-3">
                <span
                  className={cn(
                    "mt-0.5 h-fit shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                    COR[m.tipo]
                  )}
                >
                  {TIPO_ROTULO[m.tipo]}
                </span>
                <div className="min-w-0">
                  <p className="text-sm leading-relaxed">{m.texto}</p>
                  {m.manual && (
                    // O elo que a regra 0c exige: a novidade aponta a seção do
                    // manual que mudou junto. Sem ele, o manual continuaria
                    // certo e ninguém saberia onde ler a explicação inteira.
                    <p className="mt-1 text-xs text-muted-foreground">
                      No manual: <span className="italic">{m.manual}</span>
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}
