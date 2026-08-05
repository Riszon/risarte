import { redirect } from "next/navigation";
import { Truck } from "lucide-react";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance } from "@/lib/finance/access";
import { SupplierManager, type SupplierRow } from "./supplier-manager";

type Row = {
  id: string;
  clinic_id: string;
  name: string;
  document: string | null;
  kind: SupplierRow["kind"];
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  payment_notes: string | null;
  active: boolean;
};

/** FIN3 — fornecedores da unidade. Quem paga é quem cadastra. */
export default async function SuppliersPage() {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");

  const clinicId = session.activeClinic?.id ?? null;
  const supabase = await createClient();

  let query = supabase
    .from("suppliers")
    .select(
      "id, clinic_id, name, document, kind, contact_name, phone, email, payment_notes, active"
    )
    .order("name");
  if (clinicId) query = query.eq("clinic_id", clinicId);
  const { data: rows } = await query.returns<Row[]>();

  const canEdit =
    session.isAdminMaster ||
    Object.values(session.rolesByClinic).some((r) =>
      r.includes("finance_franchisor")
    ) ||
    hasRoleInClinic(session, clinicId, ["unit_manager"]);

  const suppliers: SupplierRow[] = (rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    document: r.document,
    kind: r.kind,
    contactName: r.contact_name,
    phone: r.phone,
    email: r.email,
    paymentNotes: r.payment_notes,
    active: r.active,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Truck className="size-6 text-primary" />
          Fornecedores
        </h1>
        <p className="text-sm text-muted-foreground">
          Quem a unidade paga: laboratório de prótese, dental, aluguel,
          contabilidade. Fornecedor já usado numa conta não é apagado — é
          desativado.
        </p>
      </div>

      {!clinicId ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Selecione uma unidade no menu lateral.
        </p>
      ) : (
        <SupplierManager
          clinicId={clinicId}
          suppliers={suppliers}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}
