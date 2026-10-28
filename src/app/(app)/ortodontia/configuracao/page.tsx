import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Settings } from "lucide-react";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewOrtho, canViewOrthoDashboard } from "@/lib/ortodontia/access";
import { loadOrthoProcedures, loadOrthoSettingsRows } from "@/lib/ortodontia/db";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { OrthoSettingsEditor } from "./settings-editor";

export const metadata: Metadata = { title: "Ortodontia — Configuração" };

/**
 * A cascata da ortodontia: padrão da rede (Admin) e ajuste por unidade
 * (Gerente da unidade ou Admin). Quem não configura nada não entra.
 */
export default async function OrtoConfiguracaoPage() {
  const session = await getSessionContext();
  if (!canViewOrtho(session)) redirect("/");
  const unidadesQueGere = session.clinics.filter(
    (c) => c.type === "franchise_unit" && (session.isAdminMaster || hasRoleInClinic(session, c.id, ["unit_manager"]))
  );
  if (!session.isAdminMaster && unidadesQueGere.length === 0) {
    redirect(canViewOrthoDashboard(session) ? "/ortodontia" : "/ortodontia/atencao");
  }

  const supabase = await createClient();
  const [rows, procedures] = await Promise.all([loadOrthoSettingsRows(supabase), loadOrthoProcedures(supabase)]);

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Ortodontia"
        icone={Settings}
        titulo="Configuração da Ortodontia"
        descricao="O padrão da rede vale para toda unidade sem ajuste próprio. Cada caso nasce com estes valores e pode ser ajustado ao abrir."
        voltar={{ href: "/ortodontia", rotulo: "Painel" }}
      />
      {rows === null ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          A configuração ainda não existe neste banco (falta a migração 0329). Nada pode ser salvo até ela rodar.
        </p>
      ) : (
        <OrthoSettingsEditor
          rows={rows}
          clinics={unidadesQueGere.map((c) => ({ id: c.id, name: c.name }))}
          isAdmin={session.isAdminMaster}
          procedures={procedures}
        />
      )}
    </div>
  );
}
