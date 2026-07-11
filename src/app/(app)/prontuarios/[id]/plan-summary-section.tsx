import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type PlanSummaryItem = {
  description: string;
  quantity: number;
  sessions: number | null;
  providerName: string | null;
};

export type PlanSummaryStage = {
  name: string;
  items: PlanSummaryItem[];
};

/** H4.6 B2: resumo do plano de tratamento para o Dentista — SEM valores (o
 * financeiro é do comercial). Só leitura: diagnóstico + procedimentos por etapa. */
export function PlanSummarySection({
  diagnosis,
  objectives,
  optionTitle,
  stages,
}: {
  diagnosis: string | null;
  objectives: string | null;
  optionTitle: string | null;
  stages: PlanSummaryStage[];
}) {
  function ItemRow({ it }: { it: PlanSummaryItem }) {
    return (
      <li className="flex flex-wrap items-center gap-x-2 rounded-md border p-2 text-sm">
        <span className="font-medium">{it.description}</span>
        {it.quantity > 1 && (
          <span className="text-xs text-muted-foreground">×{it.quantity}</span>
        )}
        {it.sessions && it.sessions > 0 && (
          <span className="text-xs text-muted-foreground">
            · {it.sessions} sessão(ões)
          </span>
        )}
        {it.providerName && (
          <Badge variant="secondary" className="text-[10px]">
            {it.providerName}
          </Badge>
        )}
      </li>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Plano de tratamento (resumo)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {diagnosis && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Diagnóstico
            </p>
            <p className="whitespace-pre-wrap">{diagnosis}</p>
          </div>
        )}
        {objectives && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Objetivos
            </p>
            <p className="whitespace-pre-wrap">{objectives}</p>
          </div>
        )}

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Procedimentos{optionTitle ? ` · ${optionTitle}` : ""}
          </p>
          {stages.length > 0 ? (
            <div className="mt-1 space-y-3">
              {stages.map((stage, i) => (
                <div key={i}>
                  {stage.name && (
                    <p className="mb-1 text-xs font-semibold text-primary">
                      {stage.name}
                    </p>
                  )}
                  <ul className="space-y-1.5">
                    {stage.items.map((it, j) => (
                      <ItemRow key={j} it={it} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Nenhum procedimento no plano.
            </p>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Resumo clínico do plano aprovado — valores e orçamento ficam com o
          comercial.
        </p>
      </CardContent>
    </Card>
  );
}
