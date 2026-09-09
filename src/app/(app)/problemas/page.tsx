import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext, pode } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { APP_VERSION, LATEST_MIGRATION } from "@/lib/version";
import { Problemas, type Relato } from "./lista";

export const metadata: Metadata = { title: "Problemas" };

/**
 * PROBLEMAS — o canal entre quem opera e quem mantém o sistema.
 *
 * ⚠️ SEPARADA DE `/alertas` POR ORDEM DO DONO (08/09/2026) — ver o comentário
 * de `/alertas/page.tsx` para o motivo inteiro. Em resumo: as duas moravam na
 * mesma tela em abas, e os dois ícones da barra de cima abriam a MESMA página.
 * **Não juntar de novo.**
 *
 * A VERSÃO FICA NO CABEÇALHO desta tela, e não da outra, porque é aqui que ela
 * é usada: relato sem versão obriga quem for corrigir a adivinhar em qual
 * sistema o defeito aconteceu. O formulário já a grava sozinho; mostrá-la é o
 * que permite à pessoa dizer "estou na 0.236.0" antes mesmo de abrir o relato.
 */
export default async function ProblemasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionContext();
  if (!pode(session, "menu.sistema")) redirect("/");

  const params = await searchParams;
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const clinicId = session.activeClinic?.id ?? null;
  const supabase = await createClient();

  // A RLS já limita ao que a pessoa pode ver (a unidade dela, ou tudo para o
  // Admin Master) — a consulta não repete a régua, senão passariam a existir
  // duas versões dela.
  const { data, error } = await supabase
    .from("system_reports")
    .select(
      // `user_agent` era gravado e nunca lido: é no briefing para correção
      // que ele responde "só acontece no navegador dela".
      "id, code, kind, severity, title, what_happened, expected, screen, app_version, error_digest, user_agent, status, answer, answered_at, resolved_version, created_at, reporter_role, reporter_id, clinic_id, profiles!system_reports_reporter_id_fkey ( full_name ), clinics ( name )"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  // Banco sem a 0247: a tela DIZ isso e desabilita o envio, em vez de fingir
  // que gravou. Mesmo caminho da tela de permissões (0246).
  const semTabela = Boolean(error && error.code === "42P01");
  const relatos: Relato[] = ((data ?? []) as unknown as RelatoBruto[]).map((r) => ({
    id: r.id,
    code: r.code,
    kind: r.kind,
    severity: r.severity,
    title: r.title,
    whatHappened: r.what_happened,
    expected: r.expected,
    screen: r.screen,
    appVersion: r.app_version,
    errorDigest: r.error_digest,
    userAgent: r.user_agent,
    status: r.status,
    answer: r.answer,
    answeredAt: r.answered_at,
    resolvedVersion: r.resolved_version,
    createdAt: r.created_at,
    reporterRole: r.reporter_role,
    reporterName: r.profiles?.full_name ?? "—",
    clinicName: r.clinics?.name ?? "—",
    meu: r.reporter_id === session.userId,
  }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Problemas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Onde avisar que algo deu errado, tirar uma dúvida ou sugerir uma
          melhoria. Você está na versão{" "}
          <strong className="font-medium text-foreground">
            {APP_VERSION} · migração {LATEST_MIGRATION}
          </strong>
          .
        </p>
      </header>

      <Problemas
        relatos={relatos}
        isAdminMaster={session.isAdminMaster}
        semTabela={semTabela}
        semUnidade={!clinicId}
        abrirFormulario={um(params.relatar) === "1"}
        telaSugerida={um(params.tela) ?? ""}
        digestSugerido={um(params.digest) ?? ""}
        versaoAtual={APP_VERSION}
      />
    </div>
  );
}

type RelatoBruto = {
  id: string;
  code: string;
  kind: Relato["kind"];
  severity: Relato["severity"];
  title: string;
  what_happened: string;
  expected: string | null;
  screen: string | null;
  app_version: string | null;
  error_digest: string | null;
  user_agent: string | null;
  status: Relato["status"];
  answer: string | null;
  answered_at: string | null;
  resolved_version: string | null;
  created_at: string;
  reporter_role: string | null;
  reporter_id: string;
  clinic_id: string;
  profiles: { full_name: string } | null;
  clinics: { name: string } | null;
};
