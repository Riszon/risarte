import "server-only";
import { createClient } from "@/lib/supabase/server";
import { empresarialDb } from "@/lib/empresarial/db";
import type { MethodologyPillar } from "@/lib/journey";
import type { EmployeeStatus, Relationship } from "@/lib/empresarial/constants";

/**
 * Uma linha do extrato: um ATENDIMENTO (ou um lançamento sem horário vinculado).
 * Decisão do dono: o extrato mostra data, chegada (check-in), fim do atendimento
 * e a economia — sem nome de procedimento e sem o que o cliente pagou.
 */
export type UsageLine = {
  /** Data do atendimento (ou do lançamento, quando não há horário). */
  date: string;
  /** Chegada na clínica (check-in) — null quando não houve atendimento. */
  checkInAt: string | null;
  /** Fim do atendimento — null quando ainda não concluído. */
  doneAt: string | null;
  fullCents: number;
  chargedCents: number;
  savedCents: number;
};

export type MemberStats = {
  clientId: string;
  name: string;
  cpf: string;
  /** Titular ou o parentesco do dependente. */
  role: "HOLDER" | "DEPENDENT";
  relationship: Relationship | null;
  /** Nome do titular (quando é dependente). */
  holderName: string | null;
  status: EmployeeStatus;
  clinicName: string | null;

  // Economia (benefit_usage)
  fullCents: number;
  chargedCents: number;
  savedCents: number;
  usageCount: number;
  usages: UsageLine[];

  // Sessões de tratamento
  sessionsDone: number;
  sessionsOpen: number;

  // Agenda
  attendancesDone: number;
  futureAppointments: number;
  noShows: number;
  cancellations: number;
  lateArrivals: number;

  // Procedimentos (itens do plano / da venda direta)
  proceduresDone: number;
  proceduresOpen: number;
  /** Nomes — só aparecem no relatório se o usuário pedir o detalhamento. */
  doneProcedureNames: string[];
  openProcedureNames: string[];
};

export type BenefitsReport = {
  company: {
    id: string;
    legalName: string;
    tradeName: string | null;
    cnpj: string;
  };
  members: MemberStats[];
  totals: {
    membersWithUsage: number;
    fullCents: number;
    chargedCents: number;
    savedCents: number;
    usageCount: number;
    sessionsDone: number;
    sessionsOpen: number;
    attendancesDone: number;
    futureAppointments: number;
    noShows: number;
    cancellations: number;
    lateArrivals: number;
    proceduresDone: number;
    proceduresOpen: number;
  };
  /** Distribuição por pilar da metodologia (sessões), com percentual. */
  byPillar: {
    pillar: MethodologyPillar | "unset";
    count: number;
    percent: number;
  }[];
  /** Por unidade franqueada: quantos foram atendidos e quantos estão vinculados. */
  byClinic: {
    clinicId: string;
    clinicName: string;
    attendedMembers: number;
    linkedMembers: number;
    sessionsDone: number;
    savedCents: number;
  }[];
  generatedAt: string;
};

type MemberSeed = {
  clientId: string;
  name: string;
  cpf: string;
  role: "HOLDER" | "DEPENDENT";
  relationship: Relationship | null;
  holderName: string | null;
  status: EmployeeStatus;
  clinicId: string | null;
};

/**
 * Extrato de benefícios/economia + indicadores de tratamento dos membros do
 * programa nesta empresa. Só considera quem já está vinculado a um cliente do
 * riSZon (sem client_id não há histórico clínico).
 *
 * O que o usuário vê respeita a RLS de `treatment_sessions`/`appointments`:
 * gestão da unidade enxerga a própria unidade; Admin/Franqueadora, a rede toda.
 */
export async function loadBenefitsReport(
  companyId: string
): Promise<BenefitsReport | null> {
  const db = await empresarialDb();
  const supabase = await createClient();

  const { data: company } = await db
    .from("companies")
    .select("id, legal_name, trade_name, cnpj")
    .eq("id", companyId)
    .maybeSingle<{
      id: string;
      legal_name: string;
      trade_name: string | null;
      cnpj: string;
    }>();
  if (!company) return null;

  const { data: empRows } = await db
    .from("employees")
    .select(
      "id, full_name, cpf, status, client_id, clinic_id, dependents ( id, full_name, cpf, relationship, status, client_id, clinic_id )"
    )
    .eq("company_id", companyId)
    .order("full_name")
    .returns<
      {
        id: string;
        full_name: string;
        cpf: string;
        status: EmployeeStatus;
        client_id: string | null;
        clinic_id: string | null;
        dependents: {
          id: string;
          full_name: string | null;
          cpf: string;
          relationship: Relationship;
          status: EmployeeStatus;
          client_id: string | null;
          clinic_id: string | null;
        }[];
      }[]
    >();

  // Membros vinculados (titulares + dependentes), na ordem do extrato.
  const seeds: MemberSeed[] = [];
  for (const e of empRows ?? []) {
    if (e.client_id) {
      seeds.push({
        clientId: e.client_id,
        name: e.full_name,
        cpf: e.cpf,
        role: "HOLDER",
        relationship: null,
        holderName: null,
        status: e.status,
        clinicId: e.clinic_id,
      });
    }
    for (const d of e.dependents ?? []) {
      if (!d.client_id) continue;
      seeds.push({
        clientId: d.client_id,
        name: d.full_name ?? "Dependente",
        cpf: d.cpf,
        role: "DEPENDENT",
        relationship: d.relationship,
        holderName: e.full_name,
        status: d.status,
        clinicId: d.clinic_id,
      });
    }
  }

  const clientIds = [...new Set(seeds.map((s) => s.clientId))];

  // Sem ninguém vinculado ainda: devolve o relatório vazio (a tela explica).
  if (clientIds.length === 0) {
    return {
      company: {
        id: company.id,
        legalName: company.legal_name,
        tradeName: company.trade_name,
        cnpj: company.cnpj,
      },
      members: [],
      totals: {
        membersWithUsage: 0,
        fullCents: 0,
        chargedCents: 0,
        savedCents: 0,
        usageCount: 0,
        sessionsDone: 0,
        sessionsOpen: 0,
        attendancesDone: 0,
        futureAppointments: 0,
        noShows: 0,
        cancellations: 0,
        lateArrivals: 0,
        proceduresDone: 0,
        proceduresOpen: 0,
      },
      byPillar: [],
      byClinic: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const [{ data: usage }, { data: sessions }, { data: appts }] = await Promise.all([
    db
      .from("benefit_usage")
      .select(
        "client_id, procedure_id, used_at, appointment_id, amount_full_cents, amount_charged_cents, amount_saved_cents"
      )
      .eq("company_id", companyId)
      .in("client_id", clientIds)
      .order("used_at", { ascending: false })
      .returns<
        {
          client_id: string;
          procedure_id: string | null;
          used_at: string;
          appointment_id: string | null;
          amount_full_cents: number | null;
          amount_charged_cents: number | null;
          amount_saved_cents: number | null;
        }[]
      >(),
    supabase
      .from("treatment_sessions")
      .select(
        "id, client_id, clinic_id, status, procedure_id, procedure_name, item_id"
      )
      .in("client_id", clientIds)
      .returns<
        {
          id: string;
          client_id: string;
          clinic_id: string | null;
          status: string;
          procedure_id: string | null;
          procedure_name: string | null;
          item_id: string | null;
        }[]
      >(),
    supabase
      .from("appointments")
      .select(
        "id, client_id, clinic_id, status, attendance, starts_at, checked_in_at, done_at"
      )
      .in("client_id", clientIds)
      .returns<
        {
          id: string;
          client_id: string;
          clinic_id: string;
          status: string;
          attendance: string | null;
          starts_at: string;
          checked_in_at: string | null;
          done_at: string | null;
        }[]
      >(),
  ]);

  // Atendimentos por id (o extrato mostra data, chegada e fim).
  const apptById = new Map<
    string,
    { startsAt: string; checkInAt: string | null; doneAt: string | null }
  >();
  for (const a of appts ?? []) {
    apptById.set(a.id, {
      startsAt: a.starts_at,
      checkInAt: a.checked_in_at,
      doneAt: a.done_at,
    });
  }

  // Nomes de procedimento + pilar (para o extrato e a distribuição por pilar).
  const procIds = [
    ...new Set(
      [
        ...(usage ?? []).map((u) => u.procedure_id),
        ...(sessions ?? []).map((s) => s.procedure_id),
      ].filter((x): x is string => Boolean(x))
    ),
  ];
  const procName = new Map<string, string>();
  const procPillar = new Map<string, MethodologyPillar | null>();
  if (procIds.length > 0) {
    const { data: procs } = await supabase
      .from("procedures")
      .select("id, name, pillar")
      .in("id", procIds)
      .returns<{ id: string; name: string; pillar: MethodologyPillar | null }[]>();
    for (const p of procs ?? []) {
      procName.set(p.id, p.name);
      procPillar.set(p.id, p.pillar);
    }
  }

  const clinicIds = [
    ...new Set(
      [
        ...seeds.map((s) => s.clinicId),
        ...(sessions ?? []).map((s) => s.clinic_id),
        ...(appts ?? []).map((a) => a.clinic_id),
      ].filter((x): x is string => Boolean(x))
    ),
  ];
  const clinicName = new Map<string, string>();
  if (clinicIds.length > 0) {
    const { data: clinics } = await supabase
      .from("clinics")
      .select("id, name")
      .in("id", clinicIds);
    for (const c of clinics ?? []) clinicName.set(c.id, c.name);
  }

  const now = Date.now();
  const OPEN_SESSION = new Set(["pending", "scheduled"]);
  const FUTURE_STATUS = new Set(["scheduled", "confirmed"]);

  // Procedimentos: um procedimento é CONCLUÍDO quando todas as suas sessões
  // estão concluídas; em aberto se ainda tem sessão pendente/agendada. Vale para
  // plano (item_id) e para venda direta (sem item_id — agrupa pelo procedimento).
  const itemsByClient = new Map<
    string,
    Map<string, { total: number; done: number; name: string }>
  >();
  for (const s of sessions ?? []) {
    if (s.status === "cancelled") continue;
    const key = s.item_id ?? `proc:${s.procedure_id ?? s.procedure_name ?? "?"}`;
    const perClient = itemsByClient.get(s.client_id) ?? new Map();
    const name =
      s.procedure_name ??
      (s.procedure_id ? procName.get(s.procedure_id) : null) ??
      "Procedimento";
    const cur = perClient.get(key) ?? { total: 0, done: 0, name };
    cur.total++;
    if (s.status === "done") cur.done++;
    perClient.set(key, cur);
    itemsByClient.set(s.client_id, perClient);
  }

  const members: MemberStats[] = seeds.map((s) => {
    const uses = (usage ?? []).filter((u) => u.client_id === s.clientId);
    const sess = (sessions ?? []).filter((x) => x.client_id === s.clientId);
    const ap = (appts ?? []).filter((x) => x.client_id === s.clientId);

    const items = itemsByClient.get(s.clientId) ?? new Map();
    let proceduresDone = 0;
    let proceduresOpen = 0;
    const doneProcedureNames: string[] = [];
    const openProcedureNames: string[] = [];
    for (const v of items.values()) {
      if (v.total > 0 && v.done === v.total) {
        proceduresDone++;
        doneProcedureNames.push(v.name);
      } else {
        proceduresOpen++;
        openProcedureNames.push(
          v.done > 0 ? `${v.name} (${v.done}/${v.total} sessões)` : v.name
        );
      }
    }

    // Extrato: uma linha por ATENDIMENTO (agrupa os usos do mesmo horário).
    // Sem atendimento vinculado (ex.: venda direta sem horário), agrupa pelo dia.
    const lineMap = new Map<string, UsageLine>();
    for (const u of uses) {
      const appt = u.appointment_id ? apptById.get(u.appointment_id) : undefined;
      const key = u.appointment_id ?? `dia:${u.used_at.slice(0, 10)}`;
      const cur =
        lineMap.get(key) ??
        {
          date: appt?.startsAt ?? u.used_at,
          checkInAt: appt?.checkInAt ?? null,
          doneAt: appt?.doneAt ?? null,
          fullCents: 0,
          chargedCents: 0,
          savedCents: 0,
        };
      cur.fullCents += u.amount_full_cents ?? 0;
      cur.chargedCents += u.amount_charged_cents ?? 0;
      cur.savedCents += u.amount_saved_cents ?? 0;
      lineMap.set(key, cur);
    }
    const usageLines = [...lineMap.values()].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    return {
      clientId: s.clientId,
      name: s.name,
      cpf: s.cpf,
      role: s.role,
      relationship: s.relationship,
      holderName: s.holderName,
      status: s.status,
      clinicName: s.clinicId ? clinicName.get(s.clinicId) ?? null : null,

      fullCents: uses.reduce((a, u) => a + (u.amount_full_cents ?? 0), 0),
      chargedCents: uses.reduce((a, u) => a + (u.amount_charged_cents ?? 0), 0),
      savedCents: uses.reduce((a, u) => a + (u.amount_saved_cents ?? 0), 0),
      usageCount: uses.length,
      usages: usageLines,

      sessionsDone: sess.filter((x) => x.status === "done").length,
      sessionsOpen: sess.filter((x) => OPEN_SESSION.has(x.status)).length,

      attendancesDone: ap.filter(
        (x) => x.status === "completed" || x.attendance === "done"
      ).length,
      futureAppointments: ap.filter(
        (x) => FUTURE_STATUS.has(x.status) && new Date(x.starts_at).getTime() > now
      ).length,
      noShows: ap.filter((x) => x.status === "no_show").length,
      cancellations: ap.filter((x) => x.status === "cancelled").length,
      // Atraso: chegou (check-in) depois do horário marcado.
      lateArrivals: ap.filter(
        (x) =>
          x.checked_in_at != null &&
          new Date(x.checked_in_at).getTime() > new Date(x.starts_at).getTime()
      ).length,

      proceduresDone,
      proceduresOpen,
      doneProcedureNames,
      openProcedureNames,
    };
  });

  const sum = (pick: (m: MemberStats) => number) =>
    members.reduce((a, m) => a + pick(m), 0);

  // Distribuição por pilar (sessões concluídas + em aberto, pelo procedimento).
  const pillarCount = new Map<MethodologyPillar | "unset", number>();
  for (const s of sessions ?? []) {
    const p = s.procedure_id ? procPillar.get(s.procedure_id) ?? null : null;
    const key = (p ?? "unset") as MethodologyPillar | "unset";
    pillarCount.set(key, (pillarCount.get(key) ?? 0) + 1);
  }
  const pillarTotal = [...pillarCount.values()].reduce((a, b) => a + b, 0);
  const byPillar = [...pillarCount.entries()]
    .map(([pillar, count]) => ({
      pillar,
      count,
      percent: pillarTotal > 0 ? Math.round((count / pillarTotal) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Por unidade: atendidos (tem atendimento concluído lá) e vinculados (cadastro).
  const clinicAgg = new Map<
    string,
    { attended: Set<string>; linked: Set<string>; sessionsDone: number; saved: number }
  >();
  const ensure = (id: string) => {
    const cur =
      clinicAgg.get(id) ??
      { attended: new Set<string>(), linked: new Set<string>(), sessionsDone: 0, saved: 0 };
    clinicAgg.set(id, cur);
    return cur;
  };
  for (const s of seeds) if (s.clinicId) ensure(s.clinicId).linked.add(s.clientId);
  for (const a of appts ?? []) {
    if (a.status === "completed" || a.attendance === "done") {
      ensure(a.clinic_id).attended.add(a.client_id);
    }
  }
  for (const s of sessions ?? []) {
    if (s.clinic_id && s.status === "done") ensure(s.clinic_id).sessionsDone++;
  }
  // Economia por unidade: pela unidade do membro (é onde ele é atendido).
  for (const m of members) {
    const seed = seeds.find((s) => s.clientId === m.clientId);
    if (seed?.clinicId) ensure(seed.clinicId).saved += m.savedCents;
  }

  const byClinic = [...clinicAgg.entries()]
    .map(([clinicId, v]) => ({
      clinicId,
      clinicName: clinicName.get(clinicId) ?? "Unidade",
      attendedMembers: v.attended.size,
      linkedMembers: v.linked.size,
      sessionsDone: v.sessionsDone,
      savedCents: v.saved,
    }))
    .sort((a, b) => b.linkedMembers - a.linkedMembers);

  return {
    company: {
      id: company.id,
      legalName: company.legal_name,
      tradeName: company.trade_name,
      cnpj: company.cnpj,
    },
    members,
    totals: {
      membersWithUsage: members.filter((m) => m.usageCount > 0).length,
      fullCents: sum((m) => m.fullCents),
      chargedCents: sum((m) => m.chargedCents),
      savedCents: sum((m) => m.savedCents),
      usageCount: sum((m) => m.usageCount),
      sessionsDone: sum((m) => m.sessionsDone),
      sessionsOpen: sum((m) => m.sessionsOpen),
      attendancesDone: sum((m) => m.attendancesDone),
      futureAppointments: sum((m) => m.futureAppointments),
      noShows: sum((m) => m.noShows),
      cancellations: sum((m) => m.cancellations),
      lateArrivals: sum((m) => m.lateArrivals),
      proceduresDone: sum((m) => m.proceduresDone),
      proceduresOpen: sum((m) => m.proceduresOpen),
    },
    byPillar,
    byClinic,
    generatedAt: new Date().toISOString(),
  };
}
