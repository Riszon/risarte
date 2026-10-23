import { hasRoleInClinic, pode, type SessionContext } from "@/lib/auth";
import type { Meta } from "./regras";

/**
 * Quem pode o quê no módulo de Metas — ESPELHO do banco, para a tela esconder
 * o que o banco recusaria. A barreira de verdade é `_goal_can_create` e
 * `can_view_goal` (0318).
 *
 * "A tela segue o banco": a matriz de permissões pode DESLIGAR um botão, mas
 * não consegue abrir o que o banco não aceita gravar — por isso cada
 * pergunta aqui exige a permissão E o papel que o banco aceita.
 */

export function canViewMetas(session: SessionContext): boolean {
  return pode(session, "modulo.metas");
}

/** Espelho de `is_network_viewer()`: Franqueadora/Rede numa clínica da Franqueadora. */
function ehRede(session: SessionContext): boolean {
  return session.clinics.some(
    (c) => c.type === "franchisor" && (session.rolesByClinic[c.id] ?? []).includes("franchisor_staff")
  );
}

/** D1: meta de rede ou de várias unidades = Admin e Franqueadora/Rede. */
export function podeCriarMetaDaRede(session: SessionContext): boolean {
  if (session.isAdminMaster) return true;
  return ehRede(session) && pode(session, "acao.metas.criar_rede");
}

/** D1: as unidades em que a pessoa pode criar meta própria (Gerente, Franqueado). */
export function unidadesParaMetaPropria(session: SessionContext): { id: string; name: string }[] {
  return session.clinics
    .filter(
      (c) =>
        c.type === "franchise_unit" &&
        hasRoleInClinic(session, c.id, ["unit_manager", "franchisee"]) &&
        pode(session, "acao.metas.criar_unidade", c.id)
    )
    .map((c) => ({ id: c.id, name: c.name }));
}

export function podeCriarMeta(session: SessionContext): boolean {
  return podeCriarMetaDaRede(session) || unidadesParaMetaPropria(session).length > 0;
}

/** Espelho de `_goal_can_create(scope, clinics)` para uma meta que já existe. */
export function podeEditarMeta(session: SessionContext, meta: Pick<Meta, "scope" | "clinic_ids">): boolean {
  if (podeCriarMetaDaRede(session)) return true;
  if (meta.scope !== "clinics" || meta.clinic_ids.length !== 1) return false;
  return unidadesParaMetaPropria(session).some((u) => u.id === meta.clinic_ids[0]);
}
