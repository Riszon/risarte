import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, UserPlus } from "lucide-react";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  carregarAcessos,
  carregarAmbientesDoUsuario,
  carregarClinicas,
  carregarFuncoes,
} from "../../dados";
import { treinoConfigurado } from "@/lib/treino";
import { isTreino } from "@/lib/environment";
import { podeDarOuTirarAdmin, podeMexerNoAcessoDe } from "@/lib/admins";
import { carregarHierarquia } from "@/lib/admins-db";
import { AvisoSomenteConsulta } from "@/components/aviso-somente-consulta";
import { AcessoDoRisartano } from "../../acesso";
import { SeloDeAcesso } from "../../selos";

export const metadata: Metadata = { title: "Acesso sem cadastro" };

/**
 * UM LOGIN SEM CADASTRO DE RISARTANO.
 *
 * Existe porque a união tem duas pontas: a maioria dos casos é "Risartano sem
 * login", mas o contrário acontece (o próprio Admin, e os usuários de teste do
 * treino). Em vez de esconder, a tela mostra e oferece o conserto —
 * "Completar cadastro" abre o formulário já com nome e e-mail.
 *
 * Só o Admin Master entra: mexer em acesso sempre foi dele.
 */
export default async function AcessoSemCadastroPage(
  props: PageProps<"/risartanos/acesso/[userId]">
) {
  const session = await requireAdminMaster();
  const { userId } = await props.params;
  const supabase = await createClient();

  const { data: perfil } = await supabase
    .from("profiles")
    .select("id, full_name, email, is_active, is_admin_master")
    .eq("id", userId)
    .maybeSingle<{
      id: string;
      full_name: string;
      email: string | null;
      is_active: boolean;
      is_admin_master: boolean;
    }>();
  if (!perfil) notFound();

  // Já ganhou cadastro enquanto esta tela estava aberta? Então ela não é mais a
  // tela certa — a ficha do Risartano é.
  const { data: vinculado } = await supabase
    .from("staff_members")
    .select("id, code")
    .eq("user_id", perfil.id)
    .maybeSingle<{ id: string; code: string | null }>();

  const [acessos, clinicas, funcoes, ambientes] = await Promise.all([
    carregarAcessos(supabase, [perfil.id]),
    carregarClinicas(supabase),
    carregarFuncoes(supabase, perfil.id),
    carregarAmbientesDoUsuario(supabase, perfil.id),
  ]);
  const acesso = acessos.get(perfil.id) ?? null;
  // 0262: o acesso de um Admin só o Admin Principal altera.
  const hierarquia = await carregarHierarquia(supabase, session, perfil.id);
  const edita = !isTreino();
  const mexeNoAcesso = edita && podeMexerNoAcessoDe(hierarquia);

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <Link
        href="/risartanos"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Risartanos
      </Link>

      <header className="flex flex-wrap items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold-tinta">
          <UserPlus className="size-6" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeloDeAcesso situacao="cadastro_incompleto" />
            {perfil.is_admin_master && (
              <span className="rounded-full bg-gold px-2 py-0.5 text-[11px] font-medium text-gold-foreground">
                Admin Master
              </span>
            )}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            {perfil.full_name || perfil.email || "—"}
          </h1>
          <p className="text-sm text-muted-foreground">{perfil.email ?? "—"}</p>
        </div>
      </header>

      <AvisoSomenteConsulta />

      {vinculado ? (
        <p className="rounded-xl border bg-card p-4 text-sm">
          Este login já tem cadastro de Risartano.{" "}
          <Link
            href={`/risartanos/${vinculado.code ?? vinculado.id}`}
            className="font-medium underline underline-offset-2"
          >
            Abrir a ficha
          </Link>
          .
        </p>
      ) : (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold/40 bg-gold/5 p-4">
          <div>
            <h2 className="text-sm font-semibold">Falta o cadastro</h2>
            <p className="text-sm text-muted-foreground">
              Esta pessoa entra no sistema, mas não tem ficha de Risartano —
              nenhum dado de contato, contrato ou unidade de origem.
            </p>
          </div>
          {!isTreino() && (
            <Button
              nativeButton={false}
              render={<Link href={`/risartanos/novo?acesso=${perfil.id}`} />}
            >
              Completar cadastro
            </Button>
          )}
        </section>
      )}

      <AcessoDoRisartano
        staffId={null}
        staffNome={perfil.full_name || perfil.email || "—"}
        staffEmail={perfil.email}
        staffAtivo
        unidadeDoCadastro={null}
        funcaoPrevista={null}
        senhaSugerida=""
        ambientes={ambientes}
        treinoConfigurado={treinoConfigurado()}
        acesso={acesso}
        funcoes={funcoes}
        clinicas={clinicas}
        loginsLivres={[]}
        isAdmin={mexeNoAcesso}
        modoTreino={isTreino()}
        admin={{
          alvoEAdmin: hierarquia.alvoEAdmin,
          alvoEPrincipal: hierarquia.alvoEPrincipal,
          podeDarOuTirar: edita && podeDarOuTirarAdmin(hierarquia),
          bloqueadoPorHierarquia: edita && !mexeNoAcesso,
        }}
        isSelf={session.userId === perfil.id}
      />
    </div>
  );
}
