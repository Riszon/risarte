import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, ListChecks, Sparkles } from "lucide-react";
import { getSessionContext, pode } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { novidadesPara } from "@/lib/changelog";
import { canViewStock } from "@/lib/stock-access";
import { APP_VERSION, LATEST_MIGRATION } from "@/lib/version";
import { cn } from "@/lib/utils";
import { Novidades } from "./novidades";
import { PainelDoRelogio } from "./relogio";
import { Problemas, type Relato } from "./problemas";
import { Alertas, type Alerta } from "./alertas";

export const metadata: Metadata = { title: "Sistema" };

/**
 * O DIÁRIO DO SISTEMA — novidades, problemas e alertas.
 *
 * Três perguntas que a equipe faz e que não tinham onde ser respondidas:
 * "o que mudou?", "onde eu aviso que quebrou?" e "o que o sistema está me
 * avisando?". Antes disto as três iam para o WhatsApp do dono, onde não viram
 * fila, não viram histórico e não viram resposta que a próxima pessoa leia.
 *
 * As abas são LINKS, não estado de tela: assim a tela de erro consegue mandar
 * a pessoa direto para o formulário já preenchido, e o endereço pode ser
 * colado numa conversa.
 */

const ABAS = [
  { chave: "novidades", rotulo: "Novidades", icone: Sparkles },
  { chave: "problemas", rotulo: "Problemas", icone: ListChecks },
  { chave: "alertas", rotulo: "Alertas", icone: Bell },
] as const;

type Chave = (typeof ABAS)[number]["chave"];

export default async function SistemaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionContext();
  if (!pode(session, "menu.sistema")) redirect("/");

  const params = await searchParams;
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const pedida = um(params.aba) as Chave | undefined;
  const aba: Chave = ABAS.some((a) => a.chave === pedida)
    ? (pedida as Chave)
    : "novidades";

  const clinicId = session.activeClinic?.id ?? null;
  const papeis = clinicId ? (session.rolesByClinic[clinicId] ?? []) : [];

  const supabase = await createClient();

  // -------------------------------------------------------------- problemas
  // A RLS já limita ao que a pessoa pode ver (a unidade dela, ou tudo para o
  // Admin Master) — a consulta não repete a régua, senão passariam a existir
  // duas versões dela.
  let relatos: Relato[] = [];
  let semTabela = false;
  if (aba === "problemas") {
    const { data, error } = await supabase
      .from("system_reports")
      .select(
        "id, code, kind, severity, title, what_happened, expected, screen, app_version, error_digest, status, answer, answered_at, resolved_version, created_at, reporter_role, reporter_id, clinic_id, profiles!system_reports_reporter_id_fkey ( full_name ), clinics ( name )"
      )
      .order("created_at", { ascending: false })
      .limit(200);

    // Banco sem a 0247: a tela DIZ isso e desabilita o envio, em vez de fingir
    // que gravou. Mesmo caminho da tela de permissões (0246).
    semTabela = Boolean(error && error.code === "42P01");
    relatos = ((data ?? []) as unknown as RelatoBruto[]).map((r) => ({
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
  }

  // ---------------------------------------------------------------- alertas
  // ⚠️ NENHUMA PORTA NOVA. Os alertas vêm das mesmas fontes que já existem,
  // com as guardas que já existem: `finance_alerts` tem RLS por clínica com
  // financeiro visível, e as funções de estoque já checam papel. Criar aqui uma
  // consulta própria seria abrir uma segunda régua para o mesmo dado — e é
  // exatamente assim que uma delas fica desatualizada e vaza (lição da 0227).
  const alertas: Alerta[] = [];
  if (aba === "alertas") {
    const { data: financeiros } = await supabase
      .from("finance_alerts")
      .select("rule, reference, detail, amount_cents, first_seen_at, clinics ( name )")
      .is("cleared_at", null)
      .order("first_seen_at", { ascending: false })
      .limit(100);

    for (const a of (financeiros ?? []) as unknown as AlertaFinanceiro[]) {
      alertas.push({
        origem: "Financeiro",
        gravidade: a.rule === "caixa" ? "alta" : "media",
        titulo: ROTULO_REGRA[a.rule] ?? a.rule,
        detalhe: a.detail ?? a.reference,
        valorCentavos: a.amount_cents,
        unidade: a.clinics?.name ?? null,
        desde: a.first_seen_at,
        onde: "/financeiro",
      });
    }

    if (clinicId && canViewStock(session, clinicId)) {
      const [semKit, acabando, excesso] = await Promise.all([
        supabase.rpc("sessions_without_kit", { p_clinic_id: clinicId, p_days: 30 }),
        supabase.rpc("packages_running_out", {
          p_clinic_id: clinicId,
          // O mesmo 15% que a tela de Estoque usa — dois limites diferentes
          // fariam o alerta aparecer aqui e não lá, sem explicação nenhuma.
          p_threshold_percent: 15,
        }),
        supabase.rpc("overstocked_items", { p_clinic_id: clinicId }),
      ]);

      const contarSemKit = (semKit.data ?? []).length;
      if (contarSemKit > 0) {
        alertas.push({
          origem: "Estoque",
          gravidade: "media",
          titulo: "Sessões concluídas sem kit cadastrado",
          detalhe: `${contarSemKit} nos últimos 30 dias — o material saiu da gaveta e não saiu do saldo.`,
          valorCentavos: null,
          unidade: session.activeClinic?.name ?? null,
          desde: null,
          onde: "/estoque",
        });
      }

      const contarAcabando = (acabando.data ?? []).length;
      if (contarAcabando > 0) {
        alertas.push({
          origem: "Estoque",
          gravidade: "baixa",
          titulo: "Embalagens abertas chegando ao fim",
          detalhe: `${contarAcabando} ${contarAcabando === 1 ? "item" : "itens"} — pela estimativa, quase no fim.`,
          valorCentavos: null,
          unidade: session.activeClinic?.name ?? null,
          desde: null,
          onde: "/estoque",
        });
      }

      const contarExcesso = (excesso.data ?? []).length;
      if (contarExcesso > 0) {
        alertas.push({
          origem: "Estoque",
          gravidade: "baixa",
          titulo: "Itens acima do máximo",
          detalhe: `${contarExcesso} ${contarExcesso === 1 ? "item" : "itens"} — é dinheiro parado, e perda programada no que tem validade.`,
          valorCentavos: null,
          unidade: session.activeClinic?.name ?? null,
          desde: null,
          onde: "/estoque",
        });
      }
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Sistema</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O que mudou, o que está com problema e o que o sistema está avisando.
          Você está na versão{" "}
          <strong className="font-medium text-foreground">
            {APP_VERSION} · migração {LATEST_MIGRATION}
          </strong>
          .
        </p>
      </header>

      {/* O relógio fica ACIMA das abas: vale para as três, e foi um defeito de
          relógio que motivou esta tela existir na versão 0.227.0. */}
      <PainelDoRelogio
        servidorIso={new Date().toISOString()}
        fusoDoServidor={
          Intl.DateTimeFormat().resolvedOptions().timeZone || "desconhecido"
        }
      />

      <nav className="mb-6 flex gap-1 rounded-lg border bg-muted/40 p-1">
        {ABAS.map(({ chave, rotulo, icone: Icone }) => (
          <Link
            key={chave}
            href={`/sistema?aba=${chave}`}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm",
              aba === chave
                ? "bg-primary font-medium text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            <Icone className="size-4" />
            {rotulo}
          </Link>
        ))}
      </nav>

      {aba === "novidades" && (
        <Novidades versoes={novidadesPara(papeis, session.isAdminMaster)} />
      )}

      {aba === "problemas" && (
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
      )}

      {aba === "alertas" && (
        <Alertas alertas={alertas} podeVerEstoque={Boolean(clinicId)} />
      )}
    </div>
  );
}

const ROTULO_REGRA: Record<string, string> = {
  orcamento: "Orçamento perto do limite",
  caixa: "Caixa projetado negativo",
  equilibrio: "Faturamento atrás do ponto de equilíbrio",
  atraso: "Atraso acumulado acima do limite",
};

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

type AlertaFinanceiro = {
  rule: string;
  reference: string;
  detail: string | null;
  amount_cents: number | null;
  first_seen_at: string;
  clinics: { name: string } | null;
};
