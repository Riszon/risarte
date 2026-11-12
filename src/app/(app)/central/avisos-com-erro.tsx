import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBrDateTime } from "@/lib/dates";
import { BotaoDeAcao } from "./conta-client";

/**
 * ASA2 (4005) — OS AVISOS DO ASAAS QUE NÃO PROCESSARAM, na aba Conta e tarifas
 * (só o Admin Master lê `gateway_webhook_events`). Cada um pode ser
 * reprocessado; a rotina diária e o próximo aviso da mesma conta também tentam.
 * Banco sem a 4005: nada aparece.
 */
export async function AvisosComErro({ supabase, accountId }: { supabase: SupabaseClient; accountId: string }) {
  const { data, error } = await supabase
    .from("gateway_webhook_events")
    .select("id, event, received_at, attempts, error")
    .eq("account_id", accountId)
    .is("processed_at", null)
    .not("error", "is", null)
    .order("received_at", { ascending: false })
    .limit(20)
    .returns<{ id: number; event: string; received_at: string; attempts: number; error: string }[]>();
  if (error || !data || data.length === 0) return null;

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-base">Avisos do Asaas com erro ({data.length})</CardTitle>
        <p className="text-xs text-muted-foreground">
          Avisos de pagamento que chegaram e não puderam ser processados. Nada se perdeu: cada um fica guardado e é
          tentado de novo pela rotina diária e no próximo aviso. Corrija a causa e use Reprocessar.
        </p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          {data.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
              <span className="font-mono text-xs">{a.event}</span>
              <span className="text-xs text-muted-foreground">
                {formatBrDateTime(a.received_at)} · {a.attempts} tentativa(s)
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-destructive" title={a.error}>
                {a.error}
              </span>
              <BotaoDeAcao acao="reprocessar" alvo={String(a.id)} rotulo="Reprocessar" sucesso="Aviso reprocessado." />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
