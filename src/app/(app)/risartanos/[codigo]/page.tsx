import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarDays, Lock } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  TAMANHO_DA_SENHA_SUGERIDA,
  chaveDaFicha,
  faltaNoCadastro,
  senhaSugerida,
  situacaoDeAcesso,
} from "@/lib/risartanos";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";
import { CONTRACT_LABELS, type ContractType } from "@/lib/staff";
import {
  alcanceDoUsuario,
  carregarClinicas,
  carregarEspecialidades,
  carregarFicha,
  carregarFuncoes,
  carregarAmbientesDoUsuario,
  podeVerEquipe,
} from "../dados";
import { treinoConfigurado } from "@/lib/treino";
import { isTreino } from "@/lib/environment";
import { podeDarOuTirarAdmin, podeMexerNoAcessoDe } from "@/lib/admins";
import { carregarHierarquia } from "@/lib/admins-db";
import { AvisoSomenteConsulta } from "@/components/aviso-somente-consulta";
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
 * A FICHA DO RISARTANO — duas abas: Cadastro e Acesso.
 *
 * A ordem é a do mundo real, e a tela impõe: primeiro a pessoa existe no
 * cadastro, depois ela ganha acesso ao sistema. Enquanto o cadastro estiver
 * incompleto, a aba do Acesso diz o que falta em vez de oferecer um login sobre
 * uma ficha pela metade — e não há outro caminho para criar acesso.
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
  // O Admin mexe em acesso — menos no treino, onde tudo é cópia (0260).
  const adminEdita = session.isAdminMaster && !isTreino();
  const searchParams = await props.searchParams;
  const aba = searchParams.aba === "acesso" ? "acesso" : "cadastro";

  const inativasAqui = new Set(staff.inactiveUnitIds);
  const unidadesDoAcesso = (acesso?.units ?? []).map((u) => ({
    ...u,
    inativo: inativasAqui.has(u.clinicId),
    gerida: adminEdita || alcance.gerirIds.has(u.clinicId),
  }));

  const [especialidades, funcoes] = await Promise.all([
    carregarEspecialidades(supabase, staff.specialties),
    acesso ? carregarFuncoes(supabase, acesso.userId) : Promise.resolve([]),
  ]);
  // Clínicas e logins livres só servem ao Admin (é ele quem mexe em acesso).
  const clinicas = adminEdita ? await carregarClinicas(supabase) : [];
  const loginsLivres =
    adminEdita && !acesso ? await loginsSemCadastro(supabase) : [];
  // 0259: os três ambientes desta pessoa.
  const ambientes = acesso
    ? await carregarAmbientesDoUsuario(supabase, acesso.userId)
    : {};
  // 0262: o acesso de um Admin só o Admin Principal altera.
  const hierarquia = acesso
    ? await carregarHierarquia(supabase, session, acesso.userId)
    : null;
  const mexeNoAcesso =
    adminEdita && (!hierarquia || podeMexerNoAcessoDe(hierarquia));

  const situacao = situacaoDeAcesso({
    tipo: "risartano",
    ativo: staff.isActive,
    temAcesso: Boolean(acesso),
    acessoAtivo: acesso?.loginActive ?? false,
  });
  const falta = faltaNoCadastro(staff as unknown as Record<string, unknown>);

  // Dias de atendimento: só faz sentido para quem é dentista em alguma unidade
  // que este gestor administra (H4.6 E1).
  const ehDentista = unidadesDoAcesso.some(
    (u) => u.roleLabel === ROLE_LABELS.dentist
  );
  const unidadesDaAgenda = unidadesDoAcesso
    .filter((u) => u.gerida)
    .map((u) => ({ clinicId: u.clinicId, clinicName: u.clinicName }));

  // A senha provisória é sorteada AQUI, no servidor: sortear no desenho faria o
  // navegador mostrar uma senha diferente da que o servidor montou.
  const sorteio = new Uint8Array(TAMANHO_DA_SENHA_SUGERIDA);
  crypto.getRandomValues(sorteio);

  const funcaoPrevista = (staff.roleTitle ?? null) as UserRole | null;
  const funcaoRotulo =
    funcaoPrevista && funcaoPrevista in ROLE_LABELS
      ? ROLE_LABELS[funcaoPrevista]
      : staff.roleTitle;

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
            {funcaoRotulo ? `${funcaoRotulo} · ` : ""}
            {ficha.unidadeOrigem ?? "—"}
            {staff.contractType
              ? ` · ${CONTRACT_LABELS[staff.contractType as ContractType]}`
              : ""}
          </p>
        </div>
      </header>

      <AvisoSomenteConsulta />

      <nav className="flex gap-1 border-b">
        <Aba href={`/risartanos/${codigo}`} ativa={aba === "cadastro"}>
          Cadastro
        </Aba>
        <Aba href={`/risartanos/${codigo}?aba=acesso`} ativa={aba === "acesso"}>
          Acesso
          {falta.length === 0 && situacao === "sem_acesso" && (
            <span className="ml-1.5 rounded-full bg-gold/20 px-1.5 text-[10px] font-medium text-gold-tinta">
              a liberar
            </span>
          )}
        </Aba>
      </nav>

      {aba === "cadastro" ? (
        <section className="space-y-4 rounded-xl border bg-card p-4">
          <FormularioDoRisartano
            units={[]}
            staff={staff}
            photoUrl={ficha.fotoUrl}
            specialtyOptions={especialidades}
            podeGerir={podeGerir}
            modoTreino={isTreino()}
          />
        </section>
      ) : falta.length > 0 && !acesso ? (
        // A TRAVA: sem cadastro completo não se cria acesso, e não há outro
        // caminho para criar. Quem JÁ tem login não cai aqui — esconder o
        // acesso existente não impediria nada e ainda tiraria da tela quem
        // pode entrar no sistema agora (ver o bloco de aviso abaixo).
        <section className="space-y-3 rounded-xl border border-gold/40 bg-gold/5 p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Lock className="size-4 text-gold-tinta" />
            Finalize o cadastro para liberar o acesso
          </h2>
          <p className="text-sm text-muted-foreground">
            Ninguém entra no sistema sem ficha completa. Falta preencher:{" "}
            <b>{falta.join(", ")}</b>.
          </p>
          <Link
            href={`/risartanos/${codigo}`}
            className="inline-block text-sm font-medium underline underline-offset-2"
          >
            Ir para o cadastro
          </Link>
        </section>
      ) : (
        <>
          {falta.length > 0 && (
            <p className="rounded-xl border border-gold/40 bg-gold/5 px-4 py-3 text-sm">
              Esta pessoa já entra no sistema, mas o cadastro está incompleto —
              falta <b>{falta.join(", ")}</b>.{" "}
              <Link
                href={`/risartanos/${codigo}`}
                className="font-medium underline underline-offset-2"
              >
                Completar agora
              </Link>
              .
            </p>
          )}

          <AcessoDoRisartano
            staffId={staff.id}
            staffNome={staff.preferredName || staff.fullName}
            staffEmail={staff.email}
            staffAtivo={staff.isActive}
            unidadeDoCadastro={{
              id: staff.clinicId,
              name: ficha.unidadeOrigem ?? "a unidade do cadastro",
            }}
            funcaoPrevista={funcaoPrevista}
            senhaSugerida={senhaSugerida(sorteio)}
            ambientes={ambientes}
            treinoConfigurado={treinoConfigurado()}
            acesso={acesso}
            funcoes={funcoes}
            clinicas={clinicas}
            loginsLivres={loginsLivres}
            isAdmin={mexeNoAcesso}
            modoTreino={isTreino()}
            admin={
              hierarquia
                ? {
                    alvoEAdmin: hierarquia.alvoEAdmin,
                    alvoEPrincipal: hierarquia.alvoEPrincipal,
                    podeDarOuTirar: adminEdita && podeDarOuTirarAdmin(hierarquia),
                    bloqueadoPorHierarquia: adminEdita && !mexeNoAcesso,
                  }
                : undefined
            }
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
        </>
      )}
    </div>
  );
}

function Aba({
  href,
  ativa,
  children,
}: {
  href: string;
  ativa: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={ativa ? "page" : undefined}
      className={[
        "-mb-px border-b-2 px-4 py-2 text-sm transition-colors",
        ativa
          ? "border-primary font-medium text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      ].join(" ")}
    >
      {children}
    </Link>
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
