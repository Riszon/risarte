import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { carregarGrupos } from "@/lib/procedimentos/grupos-db";
import { GruposEditor, type ProcedimentoParaGrupo } from "./grupos-editor";

export const metadata: Metadata = { title: "Grupos de procedimentos" };

/**
 * GRUPOS DE PROCEDIMENTOS (0324). Atalho para o Planner lançar vários
 * procedimentos de uma vez no plano ("Implante + prótese sobre implante").
 * GP1: o Admin Master e o Planner criam e editam; os grupos são da rede.
 */
export default async function GruposPage() {
  const session = await getSessionContext();
  const isPlanner = Object.values(session.rolesByClinic).some((roles) =>
    roles.includes("planner_dentist")
  );
  if (!session.isAdminMaster && !isPlanner) redirect("/");

  const supabase = await createClient();
  const [grupos, { data: procRows, error: procErro }] = await Promise.all([
    carregarGrupos(supabase),
    supabase
      .from("procedures")
      .select("id, code, name, specialty, default_price_cents")
      .eq("is_active", true)
      .order("name")
      // A API devolve no máximo 1.000 (AP35); o catálogo da rede tem ~380.
      .limit(1000)
      .returns<
        { id: string; code: string | null; name: string; specialty: string | null; default_price_cents: number }[]
      >(),
  ]);

  const procedimentos: ProcedimentoParaGrupo[] = (procRows ?? []).map((p) => ({
    id: p.id,
    nome: p.name,
    codigo: p.code,
    especialidade: p.specialty,
    precoCents: p.default_price_cents,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <div>
        <Link
          href="/procedimentos"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Voltar aos procedimentos
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Grupos de procedimentos</h1>
        <p className="text-sm text-muted-foreground">
          Junte procedimentos que costumam andar juntos — implante + prótese
          sobre implante, canal + restauração — para lançar todos de uma vez no
          plano de tratamento. O grupo não tem preço próprio: no plano, cada
          procedimento entra com o preço do catálogo, como se fosse lançado à
          mão. Os grupos valem para a rede inteira.
        </p>
      </div>

      {!grupos.ok ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Não foi possível ler os grupos agora. Se o aviso continuar, o banco
          pode não ter recebido a atualização 0324.
        </p>
      ) : procErro ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Não foi possível ler o catálogo de procedimentos agora. Tente de novo
          em instantes.
        </p>
      ) : (
        <GruposEditor grupos={grupos.grupos} procedimentos={procedimentos} />
      )}
    </div>
  );
}
