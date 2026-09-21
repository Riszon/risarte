import { FlaskConical, LifeBuoy, Repeat, ShieldAlert, Users } from "lucide-react";
import { ComNegrito } from "@/components/com-negrito";
import { GUIA_DO_TREINO } from "@/lib/textos-automaticos";

/**
 * COMO USAR O riSZon TREINO — sempre no Início do treino (pedido do dono,
 * 19/09/2026).
 *
 * O recado principal é o que o dono pediu: fique à vontade, teste os limites, e
 * o treino não acaba com o treinamento inicial. Junto, dois avisos que evitam
 * problema de verdade: dado de paciente REAL não entra aqui (LGPD), e a
 * equipe/acessos são cópia do sistema real.
 *
 * O TEXTO vem de `textos-automaticos.ts`, para a tela de Orientações mostrar o
 * mesmo que a equipe lê. É um `<details>` aberto: quem já leu recolhe com um
 * clique, sem guardar preferência em lugar nenhum.
 */
const ICONES = [FlaskConical, Repeat, ShieldAlert, Users];

export function ComoUsarOTreino() {
  return (
    <details
      open
      className="group rounded-xl border border-gold/50 bg-gold/5 p-5 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-lg font-semibold">
          <FlaskConical className="size-5 text-gold-tinta" />
          {GUIA_DO_TREINO.titulo}
        </span>
        <span className="text-xs text-muted-foreground group-open:hidden">
          mostrar
        </span>
        <span className="hidden text-xs text-muted-foreground group-open:inline">
          recolher
        </span>
      </summary>

      <p className="mt-3 text-sm leading-relaxed">
        <ComNegrito texto={GUIA_DO_TREINO.abertura} />
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {GUIA_DO_TREINO.itens.map((item, i) => {
          const Icone = ICONES[i] ?? FlaskConical;
          const alerta = "alerta" in item && item.alerta;
          return (
            <div key={item.titulo} className="flex gap-3">
              <Icone
                className={`mt-0.5 size-5 shrink-0 ${
                  alerta ? "text-destructive" : "text-gold-tinta"
                }`}
              />
              <p className="text-sm leading-relaxed">
                <b>{item.titulo}</b> {item.texto}
              </p>
            </div>
          );
        })}
      </div>

      <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
        <LifeBuoy className="mt-0.5 size-4 shrink-0" />
        {GUIA_DO_TREINO.rodape}
      </p>
    </details>
  );
}
