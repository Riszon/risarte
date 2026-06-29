import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ClientForm } from "../client-form";

export const metadata: Metadata = { title: "Novo cliente" };

export default async function NewClientPage() {
  const session = await getSessionContext();

  // Receptionist (unit) or SDR (franqueadora) can register. Other franchisor
  // roles cannot.
  if (!hasRoleInClinic(session, session.activeClinic?.id, ["receptionist", "sdr"])) {
    redirect("/prontuarios");
  }

  const isFranchisor = session.activeClinic?.type === "franchisor";

  // The SDR registers at the Franqueadora (FRA code) and chooses a preferred
  // unit, so the client also appears in that unit's list.
  let preferredUnits: { id: string; name: string }[] = [];
  if (isFranchisor) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("clinics")
      .select("id, name")
      .eq("type", "franchise_unit")
      .eq("is_active", true)
      .order("name");
    preferredUnits = data ?? [];
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Novo cliente</h1>
        <p className="text-sm text-muted-foreground">
          {isFranchisor
            ? "Cadastro pela Franqueadora — escolha a unidade preferida do cliente."
            : `Cadastro em ${session.activeClinic?.name}.`}
        </p>
      </div>
      <ClientForm
        showPreferredUnit={isFranchisor}
        preferredUnits={preferredUnits}
      />
    </div>
  );
}
