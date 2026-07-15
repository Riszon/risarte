import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SpecialtiesEditor, type SpecialtyItem } from "./specialties-editor";

export const metadata: Metadata = { title: "Especialidades" };

export default async function SpecialtiesPage() {
  const session = await getSessionContext();
  const isPlanner = Object.values(session.rolesByClinic).some((roles) =>
    roles.includes("planner_dentist")
  );
  if (!session.isAdminMaster && !isPlanner) redirect("/");

  const supabase = await createClient();
  const [{ data: rows }, { data: procSpecs }] = await Promise.all([
    supabase
      .from("specialties")
      .select("id, name, is_active, sort_order")
      .order("sort_order")
      .returns<
        { id: string; name: string; is_active: boolean; sort_order: number }[]
      >(),
    supabase
      .from("procedures")
      .select("specialty")
      .not("specialty", "is", null)
      .returns<{ specialty: string }[]>(),
  ]);

  // Quantos procedimentos usam cada especialidade (informativo).
  const countByName = new Map<string, number>();
  for (const r of procSpecs ?? []) {
    const key = (r.specialty ?? "").trim();
    if (key) countByName.set(key, (countByName.get(key) ?? 0) + 1);
  }

  const items: SpecialtyItem[] = (rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    isActive: r.is_active,
    procedureCount: countByName.get(r.name.trim()) ?? 0,
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <div>
        <Link
          href="/procedimentos"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Voltar aos procedimentos
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Especialidades</h1>
        <p className="text-sm text-muted-foreground">
          Lista padrão da rede usada nos procedimentos e nos Risartanos. Adicione,
          renomeie, reordene ou desative. Ao renomear, os procedimentos e
          profissionais que usavam o nome antigo são atualizados automaticamente.
          Desativar não apaga nada — só tira das listas de escolha.
        </p>
      </div>

      <SpecialtiesEditor items={items} />
    </div>
  );
}
