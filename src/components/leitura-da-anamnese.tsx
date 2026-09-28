import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatAnswer, isAnswerAlerting, type FilledAnswer } from "@/lib/anamnesis";

/**
 * A LEITURA DA ANAMNESE — um componente só para o prontuário (aba Clínico) e o
 * cockpit do Planner (OC-00062, 27/09/2026; Admin: "mais organizado e
 * esteticamente mais aceitável").
 *
 * Cada seção é um bloco; pergunta e resposta lado a lado; múltipla escolha
 * vira etiquetas, e em vermelho fica SÓ o que disparou alerta — antes a
 * resposta inteira ficava vermelha (prontuário) ou nada ficava (Planner), e
 * não dava para saber qual opção tinha disparado. Um componente para as duas
 * telas é o que impede uma de voltar a ser diferente da outra.
 *
 * Sem estado nem efeito: serve à tela do servidor e à do navegador.
 */
export function LeituraDaAnamnese({ answers }: { answers: FilledAnswer[] }) {
  const grupos: { secao: string; respostas: FilledAnswer[] }[] = [];
  for (const a of answers) {
    const nome = a.section?.trim() || "Geral";
    let g = grupos.find((x) => x.secao === nome);
    if (!g) {
      g = { secao: nome, respostas: [] };
      grupos.push(g);
    }
    g.respostas.push(a);
  }

  return (
    <div className="space-y-3">
      {grupos.map((g) => (
        <div key={g.secao} className="overflow-hidden rounded-md border">
          <h3 className="bg-muted/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {g.secao}
          </h3>
          <dl className="divide-y">
            {g.respostas.map((a) => {
              const alerting = isAnswerAlerting(a.value, a.alertWhen);
              const disparam =
                alerting && a.alertWhen && "any_of" in a.alertWhen ? a.alertWhen.any_of : [];
              const vazio = formatAnswer(a.value, a.kind) === "—";
              return (
                <div
                  key={a.id}
                  className={cn(
                    "grid gap-1 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-4",
                    alerting && "border-l-2 border-l-destructive bg-destructive/5"
                  )}
                >
                  {/* O rótulo da ficha às vezes já termina em ":" — não dobra. */}
                  <dt className="text-muted-foreground">{a.label.replace(/:\s*$/, "")}</dt>
                  <dd className="min-w-0">
                    {Array.isArray(a.value) && a.value.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {a.value.map((v) => (
                          <span
                            key={v}
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-xs",
                              disparam.includes(v)
                                ? "border-destructive/40 bg-background font-medium text-destructive"
                                : "bg-muted/50"
                            )}
                          >
                            {v}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span
                        className={cn(
                          "font-medium",
                          alerting && "text-destructive",
                          vazio && "font-normal text-muted-foreground"
                        )}
                      >
                        {formatAnswer(a.value, a.kind)}
                        {alerting && <AlertTriangle className="ml-1 inline size-3.5" />}
                      </span>
                    )}
                    {a.detail && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{a.detail}</p>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}
    </div>
  );
}
