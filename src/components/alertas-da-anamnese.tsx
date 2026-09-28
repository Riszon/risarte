import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AlertaDaAnamnese } from "@/lib/anamnesis";

/**
 * OS ALERTAS DA ANAMNESE — um componente só para o prontuário e o cockpit do
 * Planner (OC-00062, 27/09/2026). Antes cada tela desenhava o seu, e nenhum
 * dizia O QUE foi marcado: "Condição de saúde relevante marcada — Marque as
 * doenças/condições que tem ou já teve:". Agora cada alerta mostra a mensagem,
 * as etiquetas do que disparou (ex.: "AIDS") e o detalhe escrito.
 *
 * Só é montado para quem já pode ler a anamnese inteira (equipe clínica,
 * Planner, Gerente e Dentista — `canViewAnamnesis`): mostrar a doença aqui não
 * amplia quem vê o dado, só para de escondê-lo de quem já tem direito.
 */
export function AlertasDaAnamnese({
  alertas,
  compacto = false,
}: {
  alertas: AlertaDaAnamnese[];
  /** Dentro de um cartão pequeno (cockpit do Planner): sem título, letra menor. */
  compacto?: boolean;
}) {
  if (alertas.length === 0) return null;
  return (
    <div
      className={cn(
        "rounded-md border border-destructive/40 bg-destructive/5",
        compacto ? "p-2" : "p-3"
      )}
    >
      {!compacto && (
        <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
          <AlertTriangle className="size-4" />
          Alertas da anamnese
          <span className="rounded-full bg-destructive/10 px-1.5 text-xs font-medium">
            {alertas.length}
          </span>
        </h2>
      )}
      <ul className={cn("divide-y divide-destructive/15", !compacto && "mt-2")}>
        {alertas.map((a, i) => (
          <li
            key={i}
            className={cn("flex flex-col gap-1", compacto ? "py-1 text-xs" : "py-1.5 text-sm")}
          >
            <span className="flex items-start gap-1.5 font-medium text-destructive">
              {compacto && <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
              {a.message}
            </span>
            {(a.itens.length > 0 || a.detalhe) && (
              <span className="flex flex-wrap items-center gap-1.5">
                {a.itens.map((item) => (
                  <span
                    key={item}
                    className="rounded-full border border-destructive/40 bg-background px-2 py-0.5 text-xs font-medium text-destructive"
                  >
                    {item}
                  </span>
                ))}
                {a.detalhe && (
                  <span className="text-xs text-foreground/80">
                    {a.itens.length > 0 ? "· " : ""}
                    {a.detalhe}
                  </span>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
