import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { empresarialDb } from "@/lib/empresarial/db";
import {
  canViewEmpresarial,
  isProgramManager,
  isRislifeConsultant,
} from "@/lib/empresarial/access";
import { Card, CardContent } from "@/components/ui/card";
import type {
  CaptureChannel,
  ContactChannel,
  ContactOutcome,
  LeadStage,
  MeetingMode,
  MeetingStatus,
} from "@/lib/empresarial/constants";
import { tempoNaFaseAtual, type StagePeriod } from "@/lib/empresarial/funnel";
import { LeadBoard, type LeadView } from "./lead-board";
import {
  BRAZIL_TIME_ZONE,
  addDaysIso,
  startOfDayInBrazil,
  todayInBrazil,
} from "@/lib/dates";
import Link from "next/link";
import { BarChart3, CalendarDays, KanbanSquare } from "lucide-react";
import {
  CabecalhoDeModulo,
  BOTAO_NO_CABECALHO,
} from "@/components/cabecalho-modulo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Funil · Risarte Empresarial" };

type LeadRow = {
  id: string;
  company_name: string;
  cnpj: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  stage: LeadStage;
  consultant_id: string | null;
  lost_reason: string | null;
  company_id: string | null;
  estimated_value_cents: number | null;
  next_action_at: string | null;
  next_action_note: string | null;
  notes: string | null;
  capture_channel: CaptureChannel | null;
  referral_name: string | null;
  referral_contact: string | null;
  updated_at: string;
};

type StageHistoryRow = {
  lead_id: string;
  stage: LeadStage;
  entered_at: string;
  left_at: string | null;
  is_initial: boolean;
};

type ContactAttemptRow = {
  id: string;
  lead_id: string;
  channel: ContactChannel;
  outcome: ContactOutcome;
  note: string | null;
  attempted_at: string;
  author_id: string | null;
};

type MeetingRow = {
  id: string;
  lead_id: string;
  title: string | null;
  mode: MeetingMode;
  location: string | null;
  starts_at: string;
  ends_at: string;
  status: MeetingStatus;
  status_note: string | null;
};

export default async function FunilPage() {
  const session = await getSessionContext();
  if (!canViewEmpresarial(session)) redirect("/");
  const canUse = isProgramManager(session) || isRislifeConsultant(session);
  if (!canUse) redirect("/empresarial");

  const db = await empresarialDb();
  const { data: leadRows } = await db
    .from("commercial_leads")
    .select(
      "id, company_name, cnpj, contact_name, contact_phone, stage, consultant_id, lost_reason, company_id, estimated_value_cents, next_action_at, next_action_note, notes, capture_channel, referral_name, referral_contact, updated_at"
    )
    .order("updated_at", { ascending: false })
    .returns<LeadRow[]>();
  const leads = leadRows ?? [];

  const leadIds = leads.map((l) => l.id);
  const { data: actRows } = leadIds.length
    ? await db
        .from("commercial_lead_activities")
        .select("id, lead_id, author_id, kind, note, created_at")
        .in("lead_id", leadIds)
        .order("created_at", { ascending: false })
        .returns<
          {
            id: string;
            lead_id: string;
            author_id: string | null;
            kind: string;
            note: string | null;
            created_at: string;
          }[]
        >()
    : { data: [] };

  // O relógio de cada fase (migração 1007). A conta é feita AQUI, no servidor,
  // e o cartão recebe um número de dias pronto — cronômetro que se desenha nos
  // dois lados dá horas diferentes e derruba a árvore do React.
  const { data: histRows, error: histErr } = leadIds.length
    ? await db
        .from("commercial_lead_stage_history")
        .select("lead_id, stage, entered_at, left_at, is_initial")
        .in("lead_id", leadIds)
        .order("entered_at", { ascending: true })
        .returns<StageHistoryRow[]>()
    : { data: [], error: null };
  // Régua vazia grita: se a tabela ainda não existe (migração não rodada), o
  // quadro continua abrindo — mas sem inventar "0 dias" para todo mundo.
  if (histErr) console.error("histórico de fases indisponível:", histErr.message);

  // Fase 2 e fase 3 do funil (migração 1008): o que já foi tentado e o que
  // está marcado. As duas consultas vão juntas para não somar ida e volta ao
  // banco — cada viagem daqui até São Paulo custa no relógio de quem abre.
  const [{ data: attemptRows }, { data: meetingRows }] = leadIds.length
    ? await Promise.all([
        db
          .from("lead_contact_attempts")
          .select("id, lead_id, channel, outcome, note, attempted_at, author_id")
          .in("lead_id", leadIds)
          .order("attempted_at", { ascending: false })
          .returns<ContactAttemptRow[]>(),
        db
          .from("lead_meetings")
          .select(
            "id, lead_id, title, mode, location, starts_at, ends_at, status, status_note"
          )
          .in("lead_id", leadIds)
          .order("starts_at", { ascending: false })
          .returns<MeetingRow[]>(),
      ])
    : [{ data: [] }, { data: [] }];

  const attemptsByLead = new Map<string, ContactAttemptRow[]>();
  for (const a of attemptRows ?? []) {
    attemptsByLead.set(a.lead_id, [...(attemptsByLead.get(a.lead_id) ?? []), a]);
  }
  const meetingsByLead = new Map<string, MeetingRow[]>();
  for (const m of meetingRows ?? []) {
    meetingsByLead.set(m.lead_id, [...(meetingsByLead.get(m.lead_id) ?? []), m]);
  }

  // Os limites por fase (1012): e o que faz o cartao ficar vermelho.
  const { data: limitRows } = await db
    .from("funnel_stage_limits")
    .select("stage, max_days")
    .returns<{ stage: string; max_days: number }[]>();
  const limites = Object.fromEntries(
    (limitRows ?? []).map((l) => [l.stage, l.max_days])
  );

  const historyByLead = new Map<string, StagePeriod[]>();
  for (const h of histRows ?? []) {
    const list = historyByLead.get(h.lead_id) ?? [];
    list.push({
      stage: h.stage,
      enteredAt: h.entered_at,
      leftAt: h.left_at,
      isInitial: h.is_initial,
    });
    historyByLead.set(h.lead_id, list);
  }
  const agora = new Date();

  // Nomes (consultores + autores de atividade).
  const userIds = [
    ...new Set(
      [
        ...leads.map((l) => l.consultant_id),
        ...(actRows ?? []).map((a) => a.author_id),
        ...(attemptRows ?? []).map((a) => a.author_id),
      ].filter((x): x is string => Boolean(x))
    ),
  ];
  const nameById = new Map<string, string>();
  if (userIds.length) {
    const supabase = await createClient();
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds);
    for (const p of profs ?? [])
      nameById.set(p.id, p.full_name || p.email || "—");
  }

  const activitiesByLead = new Map<string, LeadView["activities"]>();
  for (const a of actRows ?? []) {
    const list = activitiesByLead.get(a.lead_id) ?? [];
    list.push({
      id: a.id,
      kind: a.kind,
      note: a.note,
      createdAt: a.created_at,
      authorName: a.author_id ? nameById.get(a.author_id) ?? null : null,
    });
    activitiesByLead.set(a.lead_id, list);
  }

  const leadViews: LeadView[] = leads.map((l) => ({
    id: l.id,
    companyName: l.company_name,
    cnpj: l.cnpj,
    contactName: l.contact_name,
    contactPhone: l.contact_phone,
    stage: l.stage,
    consultantId: l.consultant_id,
    consultantName: l.consultant_id ? nameById.get(l.consultant_id) ?? null : null,
    lostReason: l.lost_reason,
    companyId: l.company_id,
    estimatedValueCents: l.estimated_value_cents,
    nextActionAt: l.next_action_at,
    nextActionNote: l.next_action_note,
    notes: l.notes,
    captureChannel: l.capture_channel,
    referralName: l.referral_name,
    referralContact: l.referral_contact,
    tempoNaFase: tempoNaFaseAtual(historyByLead.get(l.id) ?? [], agora),
    activities: activitiesByLead.get(l.id) ?? [],
    contactAttempts: (attemptsByLead.get(l.id) ?? []).map((a) => ({
      id: a.id,
      channel: a.channel,
      outcome: a.outcome,
      note: a.note,
      attemptedAt: a.attempted_at,
      authorName: a.author_id ? nameById.get(a.author_id) ?? null : null,
    })),
    meetings: (meetingsByLead.get(l.id) ?? []).map((m) => ({
      id: m.id,
      title: m.title,
      mode: m.mode,
      location: m.location,
      startsAt: m.starts_at,
      endsAt: m.ends_at,
      status: m.status,
      statusNote: m.status_note,
    })),
  }));

  // "Hoje do consultor": leads com próxima ação vencida/para hoje, ainda abertos.
  // O fim do dia BRASILEIRO: `setHours(23,59,...)` no servidor (UTC) marcava
  // 20:59 daqui, e a lista perdia as últimas horas do dia.
  const endToday = new Date(
    startOfDayInBrazil(addDaysIso(todayInBrazil(), 1)).getTime() - 1
  );
  const todayLeads = leadViews.filter(
    (l) =>
      l.nextActionAt != null &&
      new Date(l.nextActionAt) <= endToday &&
      l.stage !== "CLOSED_WON" &&
      l.stage !== "CLOSED_LOST"
  );

  // Consultores (para o gestor atribuir).
  const supabase = await createClient();
  const { data: consultantRows } = await supabase
    .from("user_clinic_roles")
    .select("user_id, profiles ( full_name, email )")
    .eq("role", "rislife_consultant")
    .returns<
      { user_id: string; profiles: { full_name: string; email: string } | null }[]
    >();
  const consultantMap = new Map<string, string>();
  for (const c of consultantRows ?? [])
    consultantMap.set(c.user_id, c.profiles?.full_name || c.profiles?.email || "—");
  const consultants = [...consultantMap.entries()].map(([id, label]) => ({
    id,
    label,
  }));

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Programa corporativo"
        icone={KanbanSquare}
        titulo="Funil comercial"
        descricao="Do primeiro contato ao fechamento. Ao fechar (ganho), a empresa é criada."
        voltar={{ href: "/empresarial", rotulo: "Empresas" }}
      >
        <Button
          variant="outline"
          size="sm"
          className={BOTAO_NO_CABECALHO}
          nativeButton={false}
          render={<Link href="/empresarial/funil/painel" />}
        >
          <BarChart3 className="mr-1 size-4" />
          Painel
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={BOTAO_NO_CABECALHO}
          nativeButton={false}
          render={<Link href="/empresarial/agenda" />}
        >
          <CalendarDays className="mr-1 size-4" />
          Agenda
        </Button>
      </CabecalhoDeModulo>

      {todayLeads.length > 0 && (
        <Card className="border-gold/40 bg-gold/5">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-gold-tinta">
              ★ Hoje do consultor ({todayLeads.length})
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {todayLeads.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{l.companyName}</span>
                  <span className="text-xs text-muted-foreground">
                    {l.nextActionNote || "próxima ação"} ·{" "}
                    {new Date(l.nextActionAt!).toLocaleString("pt-BR", { timeZone: BRAZIL_TIME_ZONE,
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <LeadBoard
        leads={leadViews}
        consultants={consultants}
        canManage={isProgramManager(session)}
        currentUserId={session.userId}
        limites={limites}
      />
    </div>
  );
}
