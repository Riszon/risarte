import type { Metadata } from "next";
import Link from "next/link";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  APPOINTMENT_TYPE_LABELS,
  type AppointmentType,
  type AttendanceStatus,
} from "@/lib/appointments";

export const metadata: Metadata = { title: "Meu Dia" };

type ApptRow = {
  id: string;
  type: AppointmentType;
  status: string;
  starts_at: string;
  attendance: AttendanceStatus | null;
  clients: { id: string; full_name: string } | null;
};

type PendingRow = {
  id: string;
  procedure_name: string;
  name: string | null;
  client_id: string;
  clients: { full_name: string } | null;
};

const ATTENDANCE_BADGE: Record<
  AttendanceStatus,
  { label: string; className: string }
> = {
  waiting: { label: "Em espera", className: "bg-amber-100 text-amber-800" },
  in_service: { label: "Em atendimento", className: "bg-violet-100 text-violet-800" },
  done: { label: "Concluído", className: "bg-emerald-100 text-emerald-800" },
  gave_up: { label: "Desistiu", className: "bg-red-100 text-red-800" },
};

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

export default async function MeuDiaPage() {
  const session = await getSessionContext();
  const clinicId = session.activeClinic?.id ?? null;
  const isDentistHere =
    session.isAdminMaster || hasRoleInClinic(session, clinicId, ["dentist"]);

  if (!clinicId || !isDentistHere) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Meu Dia</h1>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Somente para o dentista</CardTitle>
            <CardDescription>
              Esta tela mostra os atendimentos e pendências do dentista na
              unidade ativa. Selecione uma unidade em que você atende como
              dentista no menu lateral.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const supabase = await createClient();
  const now = new Date();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const horizon = new Date(todayStart);
  horizon.setDate(horizon.getDate() + 14);

  const SELECT =
    "id, type, status, starts_at, attendance, clients ( id, full_name )";

  const [{ data: todayRows }, { data: upcomingRows }, { data: pendingRows }] =
    await Promise.all([
      supabase
        .from("appointments")
        .select(SELECT)
        .eq("clinic_id", clinicId)
        .eq("provider_user_id", session.userId)
        .gte("starts_at", todayStart.toISOString())
        .lt("starts_at", tomorrowStart.toISOString())
        .not("status", "in", "(cancelled,no_show)")
        .order("starts_at")
        .returns<ApptRow[]>(),
      supabase
        .from("appointments")
        .select(SELECT)
        .eq("clinic_id", clinicId)
        .eq("provider_user_id", session.userId)
        .gte("starts_at", tomorrowStart.toISOString())
        .lt("starts_at", horizon.toISOString())
        .in("status", ["scheduled", "confirmed"])
        .order("starts_at")
        .limit(20)
        .returns<ApptRow[]>(),
      supabase
        .from("treatment_sessions")
        .select("id, procedure_name, name, client_id, clients ( full_name )")
        .eq("clinic_id", clinicId)
        .eq("planner_provider_id", session.userId)
        .eq("status", "pending")
        .is("appointment_id", null)
        .order("created_at")
        .returns<PendingRow[]>(),
    ]);

  const today = todayRows ?? [];
  const upcoming = upcomingRows ?? [];
  const pending = pendingRows ?? [];

  // Agrupa as pendências por cliente (procedimentos em aberto destinados a você).
  const pendingByClient = new Map<
    string,
    { name: string; items: string[] }
  >();
  for (const p of pending) {
    const entry = pendingByClient.get(p.client_id) ?? {
      name: p.clients?.full_name ?? "—",
      items: [],
    };
    entry.items.push(p.name ? `${p.procedure_name} — ${p.name}` : p.procedure_name);
    pendingByClient.set(p.client_id, entry);
  }

  const remainingToday = today.filter(
    (a) => a.attendance !== "done" && a.attendance !== "gave_up"
  ).length;

  function ApptRowView({ a, showDay }: { a: ApptRow; showDay?: boolean }) {
    const att = a.attendance ? ATTENDANCE_BADGE[a.attendance] : null;
    const late =
      !a.attendance &&
      new Date(a.starts_at).getTime() < now.getTime() &&
      showDay !== true;
    return (
      <li className="flex items-center justify-between gap-2 rounded-md border p-3">
        <div className="min-w-0">
          {a.clients ? (
            <Link
              href={`/prontuarios/${a.clients.id}`}
              className="text-sm font-medium hover:underline"
            >
              {a.clients.full_name}
            </Link>
          ) : (
            <span className="text-sm font-medium">—</span>
          )}
          <p className="text-xs text-muted-foreground">
            {showDay ? `${dayLabel(a.starts_at)} · ` : ""}
            {time(a.starts_at)} · {APPOINTMENT_TYPE_LABELS[a.type]}
          </p>
        </div>
        {att ? (
          <Badge className={att.className}>{att.label}</Badge>
        ) : late ? (
          <Badge variant="destructive">Atrasado</Badge>
        ) : (
          <Badge variant="secondary">A chegar</Badge>
        )}
      </li>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Meu Dia — {session.fullName.split(" ")[0]}
        </h1>
        <p className="text-sm text-muted-foreground">
          {session.activeClinic?.name} ·{" "}
          {today.length === 0
            ? "sem atendimentos hoje"
            : `${today.length} atendimento(s) hoje, ${remainingToday} pendente(s)`}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Hoje <Badge variant="secondary">{today.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {today.length > 0 ? (
            <ul className="space-y-2">
              {today.map((a) => (
                <ApptRowView key={a.id} a={a} />
              ))}
            </ul>
          ) : (
            <p className="py-2 text-center text-sm text-muted-foreground">
              Você não tem atendimentos hoje.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Próximos (14 dias){" "}
            <Badge variant="secondary">{upcoming.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {upcoming.length > 0 ? (
            <ul className="space-y-2">
              {upcoming.map((a) => (
                <ApptRowView key={a.id} a={a} showDay />
              ))}
            </ul>
          ) : (
            <p className="py-2 text-center text-sm text-muted-foreground">
              Nenhum atendimento agendado nos próximos 14 dias.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Procedimentos em aberto destinados a você{" "}
            <Badge variant="secondary">{pending.length}</Badge>
          </CardTitle>
          <CardDescription>
            Sessões indicadas para você que ainda não têm agendamento — peça à
            Recepção para agendar (na ficha do cliente).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pendingByClient.size > 0 ? (
            <ul className="space-y-2">
              {[...pendingByClient.entries()].map(([cid, entry]) => (
                <li key={cid} className="rounded-md border p-3">
                  <Link
                    href={`/prontuarios/${cid}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {entry.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {entry.items.join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-2 text-center text-sm text-muted-foreground">
              Nenhum procedimento em aberto destinado a você.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
