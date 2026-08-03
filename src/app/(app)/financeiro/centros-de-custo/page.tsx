import { redirect } from "next/navigation";
import { Network } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canConfigureFinanceNetwork, canViewFinance } from "@/lib/finance/access";
import type { CostCenter } from "@/lib/finance/accounts";
import { CostCenterManager } from "./cost-center-manager";
import { CostCenterReport, type CenterTotals } from "./cost-center-report";

type Row = {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  scope: "franchisor" | "network" | "unit";
  clinic_id: string | null;
  active: boolean;
};

type EntryRow = {
  cost_center_id: string | null;
  amount_cents: number;
  direction: "inflow" | "outflow";
};

/**
 * FIN0 — centros de custo. Quem define a árvore é a FRANQUEADORA (é o que
 * mantém a rede comparável); a unidade consulta e tira relatório do seu
 * movimento por centro (decisão do dono, 31/07/2026).
 */
export default async function CostCentersPage(
  props: PageProps<"/financeiro/centros-de-custo">
) {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");

  const searchParams = await props.searchParams;
  const monthParam =
    typeof searchParams.mes === "string" ? searchParams.mes : "";
  const now = new Date();
  const month = /^\d{4}-\d{2}$/.test(monthParam)
    ? monthParam
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;

  const canManageNetwork = canConfigureFinanceNetwork(session);
  const activeClinicId = session.activeClinic?.id ?? null;

  const supabase = await createClient();
  const [{ data: rows }, { data: clinics }, { data: entries }] =
    await Promise.all([
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
      // O relatório é do movimento da unidade ativa (a RLS já limita o resto).
      activeClinicId
        ? supabase
            .from("financial_entries")
            .select("cost_center_id, amount_cents, direction")
            .eq("clinic_id", activeClinicId)
            .gte("accrual_date", start)
            .lt("accrual_date", end)
            .returns<EntryRow[]>()
        : Promise.resolve({ data: [] as EntryRow[] }),
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

  // Totais por centro (competência) — o razão ainda enche nas fases seguintes.
  const totalsByCenter = new Map<string, CenterTotals>();
  for (const e of entries ?? []) {
    const key = e.cost_center_id ?? "sem-centro";
    const acc = totalsByCenter.get(key) ?? {
      centerId: key,
      entries: 0,
      inflowCents: 0,
      outflowCents: 0,
    };
    acc.entries += 1;
    if (e.direction === "inflow") acc.inflowCents += e.amount_cents;
    else acc.outflowCents += e.amount_cents;
    totalsByCenter.set(key, acc);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Network className="size-6 text-primary" />
          Centros de custo
        </h1>
        <p className="text-sm text-muted-foreground">
          Divisão por <strong>área</strong> — Clínico, Comercial,
          Administrativo, Marketing e Infraestrutura.{" "}
          {canManageNetwork
            ? "A árvore é da rede: o que você cria aqui vale para todas as unidades."
            : "A árvore é definida pela Franqueadora, para que todas as unidades sejam comparáveis. Aqui você consulta e acompanha o movimento da sua unidade."}
        </p>
      </div>

      <CostCenterManager
        centers={centers}
        clinics={(clinics ?? []).map((c) => ({
          id: c.id as string,
          name: c.name as string,
        }))}
        activeClinicId={activeClinicId}
        canManageNetwork={canManageNetwork}
      />

      <CostCenterReport
        centers={centers}
        totals={[...totalsByCenter.values()]}
        month={month}
        clinicName={session.activeClinic?.name ?? ""}
      />
    </div>
  );
}
