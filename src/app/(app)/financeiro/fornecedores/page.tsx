import { redirect } from "next/navigation";
import Link from "next/link";
import { Truck } from "lucide-react";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance, isFinanceFranchisor } from "@/lib/finance/access";
import {
  SUPPLIER_COLUMNS,
  supplierFromRow,
  type SupplierKind,
} from "@/lib/fornecedores";
import { SupplierManager, type SupplierListRow } from "./supplier-manager";

/**
 * FIN3 + 0371 — fornecedores. A lista mostra os que VALEM na unidade ativa
 * (rede toda, só a Franqueadora, ou unidades escolhidas); a Franqueadora pode
 * ver todos os da rede.
 */
export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ todos?: string }>;
}) {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");
  const { todos } = await searchParams;

  const clinicId = session.activeClinic?.id ?? null;
  const full = session.isAdminMaster || isFinanceFranchisor(session);
  const showAll = full && todos === "1";
  const supabase = await createClient();

  const managedUnitIds = Object.entries(session.rolesByClinic)
    .filter(([, roles]) => roles.includes("unit_manager"))
    .map(([id]) => id);
  const canEdit = full || hasRoleInClinic(session, clinicId, ["unit_manager"]);

  const [{ data: kindRows }, { data: clinicRows }, { data: accountRows }, listed] =
    await Promise.all([
      supabase.from("supplier_kinds").select("code, label, sort_order, active").order("sort_order"),
      supabase.from("clinics").select("id, name, type, is_active").order("name"),
      supabase
        .from("chart_of_accounts")
        .select("code, name")
        .eq("active", true)
        .eq("is_analytic", true)
        .order("code"),
      clinicId || showAll
        ? showAll
          ? supabase.from("suppliers").select(SUPPLIER_COLUMNS).order("name")
          : supabase
              .rpc("suppliers_for_clinic", { p_clinic_id: clinicId })
              .select(SUPPLIER_COLUMNS)
              .order("name")
        : Promise.resolve({ data: [], error: null }),
    ]);

  const semMigracao = kindRows === null || listed.error !== null;
  const rows = ((listed.data ?? []) as unknown) as Record<string, unknown>[];
  const ids = rows.map((r) => r.id as string);

  const pessoasIds = [
    ...new Set(
      rows.flatMap((r) => [r.created_by, r.updated_by]).filter((v): v is string => typeof v === "string")
    ),
  ];
  const [{ data: linkRows }, { data: peopleRows }] = await Promise.all([
    ids.length
      ? supabase.from("supplier_clinics").select("supplier_id, clinic_id").in("supplier_id", ids)
      : Promise.resolve({ data: [] as { supplier_id: string; clinic_id: string }[] }),
    pessoasIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", pessoasIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const unidadesDe = new Map<string, string[]>();
  for (const l of (linkRows ?? []) as { supplier_id: string; clinic_id: string }[]) {
    unidadesDe.set(l.supplier_id, [...(unidadesDe.get(l.supplier_id) ?? []), l.clinic_id]);
  }
  const nomeDe = new Map(
    ((peopleRows ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name])
  );

  const suppliers: SupplierListRow[] = rows.map((r) => ({
    form: supplierFromRow(r, unidadesDe.get(r.id as string) ?? []),
    ownerClinicId: (r.clinic_id as string) ?? null,
    createdAt: (r.created_at as string) ?? null,
    createdByName: nomeDe.get(r.created_by as string) ?? null,
    updatedAt: (r.updated_at as string) ?? null,
    updatedByName: nomeDe.get(r.updated_by as string) ?? null,
  }));

  const kinds: SupplierKind[] = ((kindRows ?? []) as Record<string, unknown>[]).map((k) => ({
    code: k.code as string,
    label: k.label as string,
    sortOrder: Number(k.sort_order),
    active: k.active !== false,
  }));
  const clinics = ((clinicRows ?? []) as Record<string, unknown>[]).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    isFranchisor: c.type === "franchisor",
    active: c.is_active !== false,
  }));
  const accounts = ((accountRows ?? []) as { code: string; name: string }[]).map((a) => ({
    code: a.code,
    name: a.name,
  }));
  const activeIsFranchisor = clinics.find((c) => c.id === clinicId)?.isFranchisor ?? false;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Truck className="size-6 text-primary" />
          Fornecedores
        </h1>
        <p className="text-sm text-muted-foreground">
          Quem a rede paga: laboratório, dental, aluguel, contabilidade. Cada
          fornecedor vale só para a Franqueadora, para todas as unidades ou
          para as unidades escolhidas. Fornecedor já usado numa conta não é
          apagado — é desativado.
        </p>
        {full && (
          <p className="mt-2 text-xs">
            {showAll ? (
              <Link className="text-primary underline" href="/financeiro/fornecedores">
                Ver só os que valem em {session.activeClinic?.name ?? "a unidade ativa"}
              </Link>
            ) : (
              <Link className="text-primary underline" href="/financeiro/fornecedores?todos=1">
                Ver todos os fornecedores da rede
              </Link>
            )}
          </p>
        )}
      </div>

      {semMigracao ? (
        <p className="rounded-lg border border-amber-500/50 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Esta tela precisa de uma atualização do banco de dados (migração
          0371) que ainda não foi aplicada aqui. Até lá, os fornecedores não
          podem ser consultados nem alterados por esta tela.
        </p>
      ) : !clinicId && !showAll ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Selecione uma unidade no menu lateral.
        </p>
      ) : (
        <SupplierManager
          activeClinicId={clinicId}
          activeClinicName={showAll ? null : (session.activeClinic?.name ?? null)}
          activeIsFranchisor={activeIsFranchisor}
          suppliers={suppliers}
          kinds={kinds}
          clinics={clinics}
          accounts={accounts}
          canEdit={canEdit}
          full={full}
          managedUnitIds={managedUnitIds}
        />
      )}
    </div>
  );
}
