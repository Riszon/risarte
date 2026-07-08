import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Input } from "@/components/ui/input";
import { FilterForm } from "@/components/filter-form";
import {
  METHODOLOGY_PILLARS,
  PILLAR_LABELS,
  type MethodologyPillar,
} from "@/lib/journey";
import type { Procedure, ProcedureSession, UnitPrice } from "@/lib/pricing";
import { ProceduresEditor, type ProcedureChange } from "./procedures-editor";
import { ImportProcedures } from "./import-procedures";

export const metadata: Metadata = { title: "Procedimentos" };

type ProcedureRow = {
  id: string;
  code: string | null;
  tuss_code: string | null;
  name: string;
  specialty: string | null;
  default_price_cents: number;
  min_price_cents: number | null;
  max_price_cents: number | null;
  commission_percent: number;
  commission_fixed_cents: number;
  pillar: MethodologyPillar | null;
  estimated_minutes: number | null;
  is_active: boolean;
};

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

export default async function ProceduresPage(
  props: PageProps<"/procedimentos">
) {
  const session = await getSessionContext();
  const isPlanner = Object.values(session.rolesByClinic).some((roles) =>
    roles.includes("planner_dentist")
  );
  // Coordenador Clínico pode personalizar o PROTOCOLO da sua unidade (E2) —
  // entra só no modo unidade, sem mexer no catálogo/preços.
  const coordinatorUnitIds = Object.entries(session.rolesByClinic)
    .filter(([, roles]) => roles.includes("clinical_coordinator"))
    .map(([cid]) => cid);
  const canManageCatalog = session.isAdminMaster || isPlanner;
  if (!canManageCatalog && coordinatorUnitIds.length === 0) redirect("/");

  const sp = await props.searchParams;
  const search = typeof sp.q === "string" ? sp.q : "";
  const specialtyFilter = typeof sp.especialidade === "string" ? sp.especialidade : "";
  const statusFilter = typeof sp.status === "string" ? sp.status : "";
  const pillarFilter = typeof sp.pilar === "string" ? sp.pilar : "";
  let unitId = typeof sp.unidade === "string" ? sp.unidade : "";
  // Coordenador (sem catálogo): força uma das unidades dele (nunca modo rede).
  if (!canManageCatalog && !coordinatorUnitIds.includes(unitId)) {
    unitId = coordinatorUnitIds[0];
  }

  const supabase = await createClient();

  let query = supabase
    .from("procedures")
    .select(
      "id, code, tuss_code, name, specialty, default_price_cents, min_price_cents, max_price_cents, commission_percent, commission_fixed_cents, pillar, estimated_minutes, is_active"
    )
    .order("specialty", { nullsFirst: true })
    .order("name")
    .limit(1000);

  if (search.trim()) {
    const safe = search.replace(/[,()%]/g, " ").trim();
    if (safe) {
      query = query.or(
        `name.ilike.%${safe}%,tuss_code.ilike.%${safe}%,code.ilike.%${safe}%`
      );
    }
  }
  if (specialtyFilter) query = query.eq("specialty", specialtyFilter);
  if (statusFilter === "active") query = query.eq("is_active", true);
  if (statusFilter === "inactive") query = query.eq("is_active", false);
  if (pillarFilter) query = query.eq("pillar", pillarFilter);

  const [
    { data: procRows },
    { data: specialtyRows },
    { data: nameRows },
    { data: units },
  ] = await Promise.all([
    query.returns<ProcedureRow[]>(),
    supabase
      .from("procedures")
      .select("specialty")
      .not("specialty", "is", null)
      .returns<{ specialty: string }[]>(),
    supabase
      .from("procedures")
      .select("name")
      .eq("is_active", true)
      .order("name")
      .limit(2000)
      .returns<{ name: string }[]>(),
    supabase
      .from("clinics")
      .select("id, name")
      .eq("type", "franchise_unit")
      .eq("is_active", true)
      .order("name"),
  ]);

  const nameSuggestions = [...new Set((nameRows ?? []).map((n) => n.name))];
  const unitOptions = canManageCatalog
    ? (units ?? [])
    : (units ?? []).filter((u) => coordinatorUnitIds.includes(u.id));

  const procedures: Procedure[] = (procRows ?? []).map((p) => ({
    id: p.id,
    code: p.code,
    tussCode: p.tuss_code,
    name: p.name,
    specialty: p.specialty,
    defaultPriceCents: p.default_price_cents,
    minPriceCents: p.min_price_cents,
    maxPriceCents: p.max_price_cents,
    commissionPercent: p.commission_percent,
    commissionFixedCents: p.commission_fixed_cents,
    pillar: p.pillar,
    estimatedMinutes: p.estimated_minutes,
    isActive: p.is_active,
  }));

  const specialties = [
    ...new Set((specialtyRows ?? []).map((s) => s.specialty).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));

  // Unit price overrides (when a unit is selected).
  let overrides: UnitPrice[] = [];
  if (unitId) {
    const { data: priceRows } = await supabase
      .from("clinic_procedure_prices")
      .select("procedure_id, price_cents")
      .eq("clinic_id", unitId)
      .returns<{ procedure_id: string; price_cents: number }[]>();
    overrides = (priceRows ?? []).map((r) => ({
      procedureId: r.procedure_id,
      priceCents: r.price_cents,
    }));
  }

  // Network session protocols for the listed procedures (E1).
  const ids = procedures.map((p) => p.id);
  const sessionsByProcedure: Record<string, ProcedureSession[]> = {};
  if (ids.length > 0) {
    const { data: sessionRows } = await supabase
      .from("procedure_sessions")
      .select(
        "id, procedure_id, clinic_id, session_index, name, estimated_minutes, min_interval_days"
      )
      .is("clinic_id", null)
      .in("procedure_id", ids)
      .order("session_index")
      .returns<
        {
          id: string;
          procedure_id: string;
          clinic_id: string | null;
          session_index: number;
          name: string | null;
          estimated_minutes: number;
          min_interval_days: number | null;
        }[]
      >();
    for (const r of sessionRows ?? []) {
      (sessionsByProcedure[r.procedure_id] ??= []).push({
        id: r.id,
        procedureId: r.procedure_id,
        clinicId: r.clinic_id,
        sessionIndex: r.session_index,
        name: r.name,
        estimatedMinutes: r.estimated_minutes,
        minIntervalDays: r.min_interval_days,
      });
    }
  }

  // Unit-specific session protocols (E2), when a unit is selected.
  const unitSessionsByProcedure: Record<string, ProcedureSession[]> = {};
  if (unitId && ids.length > 0) {
    const { data: unitSessionRows } = await supabase
      .from("procedure_sessions")
      .select(
        "id, procedure_id, clinic_id, session_index, name, estimated_minutes, min_interval_days"
      )
      .eq("clinic_id", unitId)
      .in("procedure_id", ids)
      .order("session_index")
      .returns<
        {
          id: string;
          procedure_id: string;
          clinic_id: string | null;
          session_index: number;
          name: string | null;
          estimated_minutes: number;
          min_interval_days: number | null;
        }[]
      >();
    for (const r of unitSessionRows ?? []) {
      (unitSessionsByProcedure[r.procedure_id] ??= []).push({
        id: r.id,
        procedureId: r.procedure_id,
        clinicId: r.clinic_id,
        sessionIndex: r.session_index,
        name: r.name,
        estimatedMinutes: r.estimated_minutes,
        minIntervalDays: r.min_interval_days,
      });
    }
  }

  // Change history for the listed procedures.
  const changesByProcedure: Record<string, ProcedureChange[]> = {};
  if (ids.length > 0) {
    const { data: changeRows } = await supabase
      .from("procedure_changes")
      .select("id, procedure_id, changed_at, description, profiles ( full_name )")
      .in("procedure_id", ids)
      .order("changed_at", { ascending: false })
      .limit(300)
      .returns<
        {
          id: string;
          procedure_id: string;
          changed_at: string;
          description: string;
          profiles: { full_name: string } | null;
        }[]
      >();
    for (const c of changeRows ?? []) {
      (changesByProcedure[c.procedure_id] ??= []).push({
        id: c.id,
        changedAt: c.changed_at,
        description: c.description,
        byName: c.profiles?.full_name ?? null,
      });
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Procedimentos</h1>
        <p className="text-sm text-muted-foreground">
          {canManageCatalog
            ? `Catálogo de procedimentos da rede (${procedures.length}). Preço padrão da rede com ajuste por unidade; código interno gerado automaticamente.`
            : "Protocolo de sessões da sua unidade. Clique no relógio de um procedimento para personalizar os tempos/sessões (a base é o padrão da Rede)."}
        </p>
      </div>

      <FilterForm className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Buscar por nome, TUSS ou código..."
          className="max-w-xs"
          list="proc-suggestions"
          autoComplete="off"
        />
        <datalist id="proc-suggestions">
          {nameSuggestions.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <select name="especialidade" defaultValue={specialtyFilter} className={selectClass}>
          <option value="">Todas as especialidades</option>
          {specialties.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select name="pilar" defaultValue={pillarFilter} className={selectClass}>
          <option value="">Todos os pilares</option>
          {METHODOLOGY_PILLARS.map((p) => (
            <option key={p} value={p}>
              {PILLAR_LABELS[p]}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={statusFilter} className={selectClass}>
          <option value="">Ativos e inativos</option>
          <option value="active">Somente ativos</option>
          <option value="inactive">Somente inativos</option>
        </select>
        <select name="unidade" defaultValue={unitId} className={selectClass}>
          {canManageCatalog && <option value="">Padrão da rede</option>}
          {unitOptions.map((u) => (
            <option key={u.id} value={u.id}>
              {canManageCatalog ? `Unidade: ${u.name}` : u.name}
            </option>
          ))}
        </select>
      </FilterForm>

      {!unitId && <ImportProcedures />}

      <ProceduresEditor
        procedures={procedures}
        specialties={specialties}
        selectedUnitId={unitId}
        unitName={(units ?? []).find((u) => u.id === unitId)?.name ?? null}
        overrides={overrides}
        changesByProcedure={changesByProcedure}
        sessionsByProcedure={sessionsByProcedure}
        unitSessionsByProcedure={unitSessionsByProcedure}
        canManageCatalog={canManageCatalog}
      />
    </div>
  );
}
