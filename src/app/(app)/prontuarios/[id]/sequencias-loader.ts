import type { TreatmentPlan } from "@/lib/planning";
import { projectOptionSessions } from "./planning-actions";
import type { SequenciasPorPlano } from "../../planejamento/[clientId]/session-join-planner";

/**
 * Os atendimentos e a sequência de cada opção de cada plano. A principal vem
 * primeiro; opção sem procedimento não tem o que sequenciar. Quem não pode ler a
 * sequência recebe vazio do banco, e a tela não mostra nada.
 */
export async function carregarSequencias(plans: TreatmentPlan[]): Promise<SequenciasPorPlano> {
  const pares = await Promise.all(
    plans.map(async (plano) => {
      const opcoes = await Promise.all(
        plano.options
          .filter((o) => o.items.length > 0)
          .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
          .map(async (o) => ({
            id: o.id,
            title: o.title,
            isPrimary: o.isPrimary,
            items: o.items,
            sessions: await projectOptionSessions(o.id),
            confirmadaEm: o.sequenceConfirmedAt ?? null,
          }))
      );
      return [plano.id, opcoes.filter((o) => o.sessions.length > 0)] as const;
    })
  );
  return Object.fromEntries(pares);
}
