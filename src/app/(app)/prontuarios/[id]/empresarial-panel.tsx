import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBRL } from "@/lib/pricing";
import type { ClientUsageSummary } from "@/lib/empresarial/benefits";

/** Painel "uso e economia" do cliente no Risarte Empresarial (Fase 7). */
export function EmpresarialPanel({
  summary,
}: {
  summary: ClientUsageSummary | null;
}) {
  if (!summary || !summary.active) return null;

  return (
    <Card className="border-gold/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="text-gold">★</span> Programa Empresarial
          {summary.companyName && (
            <span className="text-sm font-normal text-muted-foreground">
              · {summary.companyName}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-4">
          <div>
            <p className="text-xs uppercase text-muted-foreground">
              Economia acumulada
            </p>
            <p className="text-2xl font-semibold text-gold">
              {formatBRL(summary.totalSavedCents)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">
              Benefícios usados
            </p>
            <p className="text-2xl font-semibold">{summary.usageCount}</p>
          </div>
        </div>

        {summary.available.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Disponíveis agora
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {summary.available.map((a, i) => (
                <Badge key={i} className="bg-gold/15 text-gold-foreground">
                  {a.procedureName} · {a.description}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {summary.blocked.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Aguardando liberação
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {summary.blocked.map((b, i) => (
                <li key={i}>
                  {b.procedureName} — {b.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {summary.usages.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Histórico de uso
            </p>
            <ul className="mt-1 space-y-0.5 text-sm">
              {summary.usages.slice(0, 8).map((u, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>
                    {u.procedureName}{" "}
                    <span className="text-xs text-muted-foreground">
                      {new Date(u.usedAt).toLocaleDateString("pt-BR")}
                    </span>
                  </span>
                  <span className="text-gold">
                    economizou {formatBRL(u.savedCents)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
