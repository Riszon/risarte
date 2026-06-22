import type { Metadata } from "next";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Procedure, UnitPrice } from "@/lib/pricing";
import { PriceEditor } from "./price-editor";

export const metadata: Metadata = { title: "Tabela de Preços" };

export default async function PricesPage(props: PageProps<"/admin/precos">) {
  await requireAdminMaster();
  const searchParams = await props.searchParams;
  const unitId =
    typeof searchParams.unidade === "string" ? searchParams.unidade : "";

  const supabase = await createClient();
  const [{ data: procRows }, { data: units }] = await Promise.all([
    supabase
      .from("procedures")
      .select("id, code, name, category, default_price_cents, is_active")
      .order("category", { nullsFirst: true })
      .order("name")
      .returns<
        {
          id: string;
          code: string | null;
          name: string;
          category: string | null;
          default_price_cents: number;
          is_active: boolean;
        }[]
      >(),
    supabase
      .from("clinics")
      .select("id, name")
      .eq("type", "franchise_unit")
      .eq("is_active", true)
      .order("name"),
  ]);

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

  const procedures: Procedure[] = (procRows ?? []).map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    category: p.category,
    defaultPriceCents: p.default_price_cents,
    isActive: p.is_active,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Tabela de Preços
        </h1>
        <p className="text-sm text-muted-foreground">
          Catálogo de procedimentos com o preço padrão da rede. Cada unidade pode
          ter o seu preço — quando não tiver, vale o padrão da rede.
        </p>
      </div>
      <PriceEditor
        procedures={procedures}
        units={units ?? []}
        selectedUnitId={unitId}
        overrides={overrides}
      />
    </div>
  );
}
