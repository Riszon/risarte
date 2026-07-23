import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Store } from "lucide-react";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { Button } from "@/components/ui/button";
import type { PaymentMethod } from "@/lib/commercial";
import {
  VendaDiretaClient,
  type DirectSaleRow,
  type SaleProcedure,
} from "./venda-direta-client";

export const metadata: Metadata = { title: "Venda direta" };

const SALE_ROLES = ["receptionist", "clinical_coordinator", "unit_manager"] as const;

export default async function VendaDiretaPage() {
  const session = await getSessionContext();
  const clinicId = session.activeClinic?.id ?? null;
  const canManage =
    session.isAdminMaster ||
    (clinicId ? hasRoleInClinic(session, clinicId, [...SALE_ROLES]) : false);
  // Também podem VER: franqueado e comercial com escopo (leitura via RLS).
  const canView =
    canManage ||
    (clinicId ? hasRoleInClinic(session, clinicId, ["franchisee"]) : false) ||
    Object.values(session.rolesByClinic)
      .flat()
      .some((r) =>
        ["commercial_consultant", "commercial_assistant"].includes(r)
      );
  if (!canView) redirect("/");

  await logAudit({
    action: "view",
    entityType: "direct_sale_page",
    entityId: clinicId ?? "all",
    clinicId: clinicId ?? undefined,
  });

  const supabase = await createClient();

  // Procedimentos vendáveis (lista configurável) para o formulário.
  const { data: procRows } = await supabase
    .from("procedures")
    .select("id, name, default_price_cents")
    .eq("direct_sale", true)
    .eq("is_active", true)
    .order("name");
  const procedures: SaleProcedure[] = (procRows ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    priceCents: (p.default_price_cents as number) ?? 0,
  }));

  // Vendas da unidade ativa (RLS já limita ao escopo do usuário).
  let salesQuery = supabase
    .from("direct_sales")
    .select(
      "id, client_name, description, value_cents, payment_method, paid, paid_by, launched, launched_by, cancelled, created_by, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (clinicId) salesQuery = salesQuery.eq("clinic_id", clinicId);
  const { data: saleRows } = await salesQuery;

  const rows = (saleRows ?? []) as {
    id: string;
    client_name: string | null;
    description: string;
    value_cents: number;
    payment_method: string | null;
    paid: boolean;
    paid_by: string | null;
    launched: boolean;
    launched_by: string | null;
    cancelled: boolean;
    created_by: string | null;
    created_at: string;
  }[];

  // Resolve nomes das pessoas envolvidas.
  const ids = [
    ...new Set(
      rows
        .flatMap((s) => [s.paid_by, s.launched_by, s.created_by])
        .filter((x): x is string => Boolean(x))
    ),
  ];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids);
    for (const p of people ?? []) names.set(p.id, p.full_name as string);
  }

  const sales: DirectSaleRow[] = rows.map((s) => ({
    id: s.id,
    clientName: s.client_name,
    description: s.description,
    valueCents: s.value_cents,
    paymentMethod: (s.payment_method as PaymentMethod | null) ?? null,
    paid: s.paid,
    paidByName: s.paid_by ? (names.get(s.paid_by) ?? null) : null,
    launched: s.launched,
    launchedByName: s.launched_by ? (names.get(s.launched_by) ?? null) : null,
    cancelled: s.cancelled,
    createdByName: s.created_by ? (names.get(s.created_by) ?? null) : null,
    createdAt: s.created_at,
  }));

  // Config da lista (só Admin).
  let allProcedures: { id: string; name: string; directSale: boolean }[] = [];
  if (session.isAdminMaster) {
    const { data: all } = await supabase
      .from("procedures")
      .select("id, name, direct_sale")
      .eq("is_active", true)
      .order("name");
    allProcedures = (all ?? []).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      directSale: Boolean(p.direct_sale),
    }));
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Store className="size-6 text-gold" />
            Venda direta na unidade
          </h1>
          <p className="text-sm text-muted-foreground">
            Procedimentos vendidos direto na clínica (urgência, consulta avulsa,
            limpeza...). A recepção fecha, o coordenador lança; o gerente faz os
            dois. Tudo entra nos números do comercial.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/comercial" />}
        >
          <ArrowLeft className="mr-1 size-3.5" />
          Funil
        </Button>
      </div>

      <VendaDiretaClient
        canManage={canManage}
        isAdmin={session.isAdminMaster}
        procedures={procedures}
        sales={sales}
        allProcedures={allProcedures}
      />
    </div>
  );
}
