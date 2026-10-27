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
 * 0325 (GP4–GP6): o preço do pacote (desconto ou acréscimo) só o Admin define.
 */
export default async function GruposPage() {
  const session = await getSessionContext();
  const isPlanner = Object.values(session.rolesByClinic).some((roles) =>
    roles.includes("planner_dentist")
  );
  if (!session.isAdminMaster && !isPlanner) redirect("/");

  const supabase = await createClient();
  const activeClinicId = session.activeClinic?.id ?? null;
  const [grupos, { data: procRows, error: procErro }, { data: levelRows }, { data: matrixRows }] = await Promise.all([
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
    // O repasse por nível — a MESMA fonte do cartão do procedimento (0212):
    // `payout_matrix` aplica os quatro degraus da apuração, na unidade ativa.
    supabase
      .from("career_levels")
      .select("id, name, clinic_id, sort_order")
      .eq("active", true)
      .order("sort_order")
      .order("name"),
    supabase.rpc("payout_matrix", { p_clinic_id: activeClinicId, p_date: null }),
  ]);
  const niveis = (levelRows ?? [])
    .filter((l) => l.clinic_id === null || l.clinic_id === activeClinicId)
    .map((l) => ({ id: l.id as string, name: l.name as string }));
  const repasses: Record<string, Record<string, { amountCents: number; source: string }>> = {};
  for (const r of (matrixRows ?? []) as { procedure_id: string; level_id: string; amount_cents: number; source: string }[]) {
    (repasses[r.procedure_id] ??= {})[r.level_id] = { amountCents: Number(r.amount_cents ?? 0), source: r.source };
  }

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
          plano de tratamento. Cada procedimento entra no plano como se fosse
          lançado à mão, com o preço do catálogo — e, se o grupo tiver{" "}
          <strong>preço de pacote</strong> (desconto ou acréscimo, definido pelo
          Admin Master), com esse ajuste. Os grupos valem para a rede inteira.
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
        <GruposEditor
          grupos={grupos.grupos}
          procedimentos={procedimentos}
          podeDefinirPreco={session.isAdminMaster}
          niveis={niveis}
          repasses={repasses}
          unidade={session.activeClinic?.name ?? null}
        />
      )}
    </div>
  );
}
