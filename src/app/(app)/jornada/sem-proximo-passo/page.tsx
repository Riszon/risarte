import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PhaseBadge } from "@/components/phase-badge";
import { Card, CardContent } from "@/components/ui/card";
import { type JourneyPhase } from "@/lib/journey";
import { todayInBrazil } from "@/lib/dates";
import { diasDesde, MOTIVO_LABEL, type MotivoSemProximoPasso } from "@/lib/abandono";
import { IniciarContatoBotao } from "./iniciar-contato-botao";

export const metadata: Metadata = { title: "Clientes sem próximo passo" };

type Linha = {
  client_id: string;
  full_name: string;
  journey_phase: JourneyPhase;
  reason: MotivoSemProximoPasso;
  last_activity_at: string | null;
};

/**
 * 0423 (seção 7.4 do plano do fim do tratamento): quem está na Fase 5 ou 6
 * sem horário futuro, sem tarefa aberta, sem ortodontia em tratamento e sem
 * complemento com movimento recente. Quem decide quem entra é o banco
 * (`clients_without_next_step`); aqui só se mostra, com a ação por cliente.
 */
export default async function SemProximoPassoPage() {
  const session = await getSessionContext();
  const clinic = session.activeClinic;

  if (!clinic || clinic.type === "franchisor") {
    return (
      <div className="mx-auto max-w-5xl space-y-3 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Clientes sem próximo passo</h1>
        <p className="text-sm text-muted-foreground">Selecione uma unidade no menu lateral.</p>
      </div>
    );
  }
  if (!hasRoleInClinic(session, clinic.id, ["clinical_coordinator", "unit_manager"])) redirect("/jornada");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clients_without_next_step", { p_clinic_id: clinic.id });
  const linhas = (error ? [] : ((data ?? []) as Linha[]));
  const agoraMs = Date.parse(todayInBrazil() + "T12:00:00-03:00");

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clientes sem próximo passo</h1>
        <p className="text-sm text-muted-foreground">
          {clinic.name}: {linhas.length} cliente(s) em tratamento ou reavaliação sem horário marcado e sem
          tarefa aberta. Nenhum cliente pode ser esquecido.
        </p>
      </div>
      {error && (
        <p className="text-sm text-destructive">Não foi possível montar a lista. Atualize a tela.</p>
      )}
      {!error && linhas.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Todos os clientes em tratamento têm um próximo passo.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {linhas.map((l) => {
                const dias = diasDesde(l.last_activity_at, agoraMs);
                return (
                  <li key={l.client_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <Link href={`/prontuarios/${l.client_id}`} className="font-medium hover:underline">
                        {l.full_name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {MOTIVO_LABEL[l.reason] ?? l.reason}
                        {dias !== null && ` · última atividade há ${dias} dia(s)`}
                      </p>
                    </div>
                    <PhaseBadge phase={l.journey_phase} />
                    <IniciarContatoBotao clientId={l.client_id} />
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
