import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { chaveDaFicha, situacaoDeAcesso } from "@/lib/risartanos";
import { ROLE_LABELS } from "@/lib/roles";
import { CONTRACT_LABELS, type ContractType } from "@/lib/staff";
import {
  alcanceDoUsuario,
  carregarClinicas,
  carregarEspecialidades,
  carregarFicha,
  carregarFuncoes,
  podeVerEquipe,
} from "../dados";
import { AcessoDoRisartano } from "../acesso";
import { FormularioDoRisartano } from "../formulario";
import { SeloDeAcesso } from "../selos";
import { UnidadesDoRisartano } from "../unidades";
import { StaffScheduleDialog } from "../staff-schedule-dialog";

export async function generateMetadata(
  props: PageProps<"/risartanos/[codigo]">
): Promise<Metadata> {
  const { codigo } = await props.params;
  const chave = chaveDaFicha(codigo);
  return {
    title:
      chave?.por === "code" ? `${chave.valor} · Risartanos` : "Ficha do Risartano",
  };
}

/**
 * A FICHA DO RISARTANO — cadastro e acesso na mesma tela.
 *
 * O endereço prefere o CÓDIGO (`/risartanos/RIS-0007`): é ele que a equipe lê e
 * escreve. Quem pode ver é a RLS quem decide (`can_see_staff`, 0080) — cadastro
 * de outra unidade simplesmente não volta da consulta, e a tela responde "não
 * encontrado", sem dizer se existe.
 */
export default async function FichaDoRisartanoPage(
  props: PageProps<"/risartanos/[codigo]">
) {
  const session = await getSessionContext();
  if (!podeVerEquipe(session)) redirect("/");

  const { codigo } = await props.params;
  const chave = chaveDaFicha(codigo);
  // Endereço que não é código nem id não vira consulta: 404 antes do banco.
  if (!chave) notFound();

  const alcance = await alcanceDoUsuario(session);
  const supabase = await createClient();
  const ficha = await carregarFicha(supabase, chave);
  if (!ficha) notFound();

  const { staff, acesso, podeGerir } = ficha;
  const inativasAqui = new Set(staff.inactiveUnitIds);
  const unidadesDoAcesso = (acesso?.units ?? []).map((u) => ({
    ...u,
    inativo: inativasAqui.has(u.clinicId),
    gerida: session.isAdminMaster || alcance.gerirIds.has(u.clinicId),
  }));

  const [especialidades, funcoes] = await Promise.all([
    carregarEspecialidades(supabase, staff.specialties),
    acesso ? carregarFuncoes(supabase, acesso.userId) : Promise.resolve([]),
  ]);
  // Clínicas e logins livres só servem ao Admin (é ele quem mexe em acesso).
  const clinicas = session.isAdminMaster ? await carregarClinicas(supabase) : [];
  const loginsLivres =
    session.isAdminMaster && !acesso ? await loginsSemCadastro(supabase) : [];

  const situacao = situacaoDeAcesso({
    tipo: "risartano",
    ativo: staff.isActive,
    temAcesso: Boolean(acesso),
    acessoAtivo: acesso?.loginActive ?? false,
  });

  // Dias de atendimento: só faz sentido para quem é dentista em alguma unidade
  // que este gestor administra (H4.6 E1).
  const ehDentista = unidadesDoAcesso.some(
    (u) => u.roleLabel === ROLE_LABELS.dentist
  );
  const unidadesDaAgenda = unidadesDoAcesso
    .filter((u) => u.gerida)
    .map((u) => ({ clinicId: u.clinicId, clinicName: u.clinicName }));

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
        {ficha.fotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ficha.fotoUrl}
            alt=""
            className="size-16 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
            {(staff.preferredName || staff.fullName).slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {staff.code && (
              <span className="font-mono text-xs text-gold-tinta">{staff.code}</span>
            )}
            <SeloDeAcesso situacao={situacao} />
            {!staff.isActive && (
              <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                Fora da equipe
              </span>
            )}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            {staff.preferredName || staff.fullName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {staff.preferredName && staff.preferredName !== staff.fullName
              ? `${staff.fullName} · `
              : ""}
            {ficha.unidadeOrigem ?? "—"}
            {staff.contractType
              ? ` · ${CONTRACT_LABELS[staff.contractType as ContractType]}`
              : ""}
          </p>
        </div>
      </header>

      <AcessoDoRisartano
        staffId={staff.id}
        staffNome={staff.preferredName || staff.fullName}
        staffEmail={staff.email}
        staffAtivo={staff.isActive}
        acesso={acesso}
        funcoes={funcoes}
        clinicas={clinicas}
        loginsLivres={loginsLivres}
        isAdmin={session.isAdminMaster}
        isSelf={acesso?.userId === session.userId}
      />

      <UnidadesDoRisartano
        staffId={staff.id}
        ativo={staff.isActive}
        unidadeOrigem={ficha.unidadeOrigem}
        unidades={unidadesDoAcesso}
        podeGerir={podeGerir}
      />

      {ehDentista && unidadesDaAgenda.length > 0 && (
        <section className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-4">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <CalendarDays className="size-4 text-gold-tinta" />
              Dias de atendimento
            </h2>
            <p className="text-xs text-muted-foreground">
              Em que dias este dentista atende em cada unidade.
            </p>
          </div>
          <StaffScheduleDialog
            staffMemberId={staff.id}
            staffName={staff.preferredName || staff.fullName}
            units={unidadesDaAgenda}
            schedules={ficha.agendas}
          />
        </section>
      )}

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Cadastro</h2>
        <FormularioDoRisartano
          units={[]}
          staff={staff}
          photoUrl={ficha.fotoUrl}
          specialtyOptions={especialidades}
          podeGerir={podeGerir}
        />
      </section>
    </div>
  );
}

/** Logins ativos ainda sem cadastro — a lista do "vincular a um login". */
async function loginsSemCadastro(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ id: string; label: string }[]> {
  const [{ data: perfis }, { data: vinculos }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("is_active", true)
      .order("full_name"),
    supabase.from("staff_members").select("user_id").not("user_id", "is", null),
  ]);
  const usados = new Set((vinculos ?? []).map((v) => v.user_id as string));
  return (perfis ?? [])
    .filter((p) => !usados.has(p.id))
    .map((p) => ({
      id: p.id,
      label: `${p.full_name || p.email || "—"}${p.email ? ` (${p.email})` : ""}`,
    }));
}
