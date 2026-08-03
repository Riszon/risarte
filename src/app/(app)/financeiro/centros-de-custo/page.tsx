import { redirect } from "next/navigation";
import { Network } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  canConfigureFinanceNetwork,
  canPostFinance,
  canViewFinance,
} from "@/lib/finance/access";
import type { CostCenter } from "@/lib/finance/accounts";
import { CostCenterManager } from "./cost-center-manager";

type Row = {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  scope: "franchisor" | "network" | "unit";
  clinic_id: string | null;
  active: boolean;
};

/**
 * FIN0 — árvore de centros de custo. São DADOS: criar centro é operação de
 * tela, sem migração. A unidade só cria filho de um centro da REDE, para o
 * consolidado continuar comparável entre 200 unidades.
 */
export default async function CostCentersPage() {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");

  const supabase = await createClient();
  const [{ data: rows }, { data: clinics }] = await Promise.all([
    supabase
      .from("cost_centers")
      .select("id, code, name, parent_id, scope, clinic_id, active")
      .order("code")
      .returns<Row[]>(),
    supabase
      .from("clinics")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
  ]);

  const centers: CostCenter[] = (rows ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    parentId: r.parent_id,
    scope: r.scope,
    clinicId: r.clinic_id,
    active: r.active,
  }));

  const activeClinicId = session.activeClinic?.id ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Network className="size-6 text-primary" />
          Centros de custo
        </h1>
        <p className="text-sm text-muted-foreground">
          Divisão por <strong>área</strong> — Clínico, Comercial,
          Administrativo, Marketing e Infraestrutura. Especialidade clínica não
          é centro de custo: a mesma cadeira e a mesma recepção atendem várias
          especialidades no mesmo dia.
        </p>
      </div>

      <CostCenterManager
        centers={centers}
        clinics={(clinics ?? []).map((c) => ({
          id: c.id as string,
          name: c.name as string,
        }))}
        activeClinicId={activeClinicId}
        canManageNetwork={canConfigureFinanceNetwork(session)}
        canManageUnit={canPostFinance(session, activeClinicId)}
      />
    </div>
  );
}
