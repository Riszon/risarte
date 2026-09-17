import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  alcanceDoUsuario,
  carregarClinicas,
  carregarEspecialidades,
  podeVerEquipe,
} from "../dados";
import { FormularioDoRisartano } from "../formulario";

export const metadata: Metadata = { title: "Novo Risartano" };

/**
 * NOVO RISARTANO.
 *
 * Quem cadastra é o mesmo de antes: Admin e Franqueadora/RH escolhem a unidade;
 * Gerente e Franqueado cadastram na unidade em que estão. O acesso ao sistema
 * não se pede aqui — depois de salvar, a ficha abre com o botão "Criar acesso"
 * (que é do Admin). Assim o cadastro nunca fica preso esperando um login.
 */
export default async function NovoRisartanoPage(
  props: PageProps<"/risartanos/novo">
) {
  const session = await getSessionContext();
  if (!podeVerEquipe(session)) redirect("/");

  const alcance = await alcanceDoUsuario(session);
  if (!alcance.podeCriar) redirect("/risartanos");

  const supabase = await createClient();
  const [especialidades, clinicas] = await Promise.all([
    carregarEspecialidades(supabase),
    carregarClinicas(supabase),
  ]);
  const unidades = (
    alcance.escopoIds
      ? clinicas.filter((c) => alcance.escopoIds!.includes(c.id))
      : clinicas
  ).map((c) => ({ id: c.id, name: c.name }));

  // "Completar cadastro" de um login que existe sem Risartano (só o Admin
  // chega aqui por esse caminho — é ele quem enxerga esses logins).
  const searchParams = await props.searchParams;
  const userId =
    typeof searchParams.acesso === "string" ? searchParams.acesso : "";
  let prefill: { fullName?: string; email?: string } | undefined;
  let vincular: string | undefined;
  if (userId && session.isAdminMaster) {
    const { data: perfil } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", userId)
      .maybeSingle<{ id: string; full_name: string; email: string | null }>();
    if (perfil) {
      prefill = { fullName: perfil.full_name, email: perfil.email ?? undefined };
      vincular = perfil.id;
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <Link
        href="/risartanos"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Risartanos
      </Link>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Novo Risartano</h1>
        <p className="text-sm text-muted-foreground">
          O cadastro da pessoa. O acesso ao sistema entra depois, na ficha dela.
        </p>
      </header>

      {vincular && (
        <p className="rounded-lg border border-gold/40 bg-gold/5 px-3 py-2 text-sm">
          Completando o cadastro de um login que já existe: o acesso continua o
          mesmo e passa a ter ficha.
        </p>
      )}

      <section className="rounded-xl border bg-card p-4">
        <FormularioDoRisartano
          units={unidades}
          canPickUnit={alcance.podeEscolherUnidade}
          activeClinicName={session.activeClinic?.name ?? null}
          specialtyOptions={especialidades}
          prefill={prefill}
          vincularUsuario={vincular}
        />
      </section>
    </div>
  );
}
