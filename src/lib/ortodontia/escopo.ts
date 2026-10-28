import type { SessionContext } from "@/lib/auth";
import { ehRede } from "./access";

export type OrthoScope = {
  /** Nulo = a rede toda (só para quem enxerga a rede). */
  clinicIds: string[] | null;
  /** A unidade escolhida (ou a ativa), quando é uma só. */
  clinicId: string | null;
  canSeeNetwork: boolean;
  label: string;
};

/**
 * Que unidades a tela mostra: a rede escolhe no filtro (`?unidade=all|id`);
 * a unidade vê só a própria. Mesmo desenho do painel do PPR+.
 */
export function resolveOrthoScope(session: SessionContext, unidadeParam?: string | null): OrthoScope {
  const canSeeNetwork = ehRede(session);
  const active = session.activeClinic;
  const activeIsUnit = active?.type === "franchise_unit";

  if (!canSeeNetwork) {
    return {
      clinicIds: active ? [active.id] : [],
      clinicId: active?.id ?? null,
      canSeeNetwork,
      label: active?.name ?? "unidade",
    };
  }
  if (unidadeParam && unidadeParam !== "all") {
    const c = session.clinics.find((x) => x.id === unidadeParam);
    return { clinicIds: [unidadeParam], clinicId: unidadeParam, canSeeNetwork, label: c?.name ?? "unidade" };
  }
  if (!unidadeParam && activeIsUnit && active) {
    return { clinicIds: [active.id], clinicId: active.id, canSeeNetwork, label: active.name };
  }
  return { clinicIds: null, clinicId: null, canSeeNetwork, label: "Rede toda" };
}
