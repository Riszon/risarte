import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { empresarialDb } from "@/lib/empresarial/db";
import {
  canViewEmpresarial,
  isProgramManager,
  isRislifeConsultant,
} from "@/lib/empresarial/access";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { isMeetingOpen, timesRescheduled } from "@/lib/empresarial/agenda";
import type { MeetingMode, MeetingStatus } from "@/lib/empresarial/constants";
import { AgendaLista, type ReuniaoView } from "./agenda-lista";

export const metadata: Metadata = { title: "Agenda · Risarte Empresarial" };

type ReuniaoRow = {
  id: string;
  lead_id: string;
  title: string | null;
  mode: MeetingMode;
  location: string | null;
  starts_at: string;
  ends_at: string;
  status: MeetingStatus;
  status_note: string | null;
  rescheduled_from: string | null;
  owner_id: string | null;
  commercial_leads: {
    company_name: string;
    contact_name: string | null;
    contact_phone: string | null;
  } | null;
};

export default async function AgendaDoProgramaPage() {
  const session = await getSessionContext();
  if (!canViewEmpresarial(session)) redirect("/");
  if (!isProgramManager(session) && !isRislifeConsultant(session)) {
    redirect("/empresarial");
  }

  const db = await empresarialDb();
  const { data: rows, error } = await db
    .from("lead_meetings")
    .select(
      "id, lead_id, title, mode, location, starts_at, ends_at, status, status_note, rescheduled_from, owner_id, commercial_leads ( company_name, contact_name, contact_phone )"
    )
    .order("starts_at", { ascending: true })
    .returns<ReuniaoRow[]>();

  // Régua vazia grita: lista vazia por ERRO de consulta e agenda realmente
  // vazia produzem a mesma tela em branco. Aqui elas são separadas.
  if (error) {
    console.error("agenda do programa:", error.message);
    throw new Error(
      "Não foi possível ler a agenda do programa. Confirme se a migração 1008 foi aplicada neste banco."
    );
  }
  const reunioes = rows ?? [];

  // Nomes de quem é responsável por cada reunião.
  const ownerIds = [
    ...new Set(reunioes.map((r) => r.owner_id).filter((x): x is string => !!x)),
  ];
  const nomePorId = new Map<string, string>();
  if (ownerIds.length) {
    const supabase = await createClient();
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ownerIds);
    for (const p of profs ?? []) {
      nomePorId.set(p.id, p.full_name || p.email || "—");
    }
  }

  const anteriorDe = new Map<string, string | null>(
    reunioes.map((r) => [r.id, r.rescheduled_from])
  );

  const views: ReuniaoView[] = reunioes.map((r) => ({
    id: r.id,
    leadId: r.lead_id,
    companyName: r.commercial_leads?.company_name ?? "(lead removido)",
    contactName: r.commercial_leads?.contact_name ?? null,
    contactPhone: r.commercial_leads?.contact_phone ?? null,
    title: r.title,
    mode: r.mode,
    location: r.location,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    status: r.status,
    statusNote: r.status_note,
    ownerName: r.owner_id ? nomePorId.get(r.owner_id) ?? null : null,
    vezesRemarcada: timesRescheduled(r.id, anteriorDe),
  }));

  // Três listas, e a do meio é a que importa: reunião cuja hora já passou e
  // ninguém disse o que houve. É ela que trava o funil em silêncio.
  const agora = new Date().getTime();
  const proximas = views.filter(
    (r) => isMeetingOpen(r.status) && new Date(r.startsAt).getTime() >= agora
  );
  const semDesfecho = views
    .filter(
      (r) => isMeetingOpen(r.status) && new Date(r.startsAt).getTime() < agora
    )
    .reverse();
  const encerradas = views
    .filter((r) => !isMeetingOpen(r.status))
    .reverse()
    .slice(0, 40);

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Programa corporativo"
        icone={CalendarDays}
        titulo="Agenda do programa"
        descricao="As reuniões do funil comercial. Dar a reunião por realizada move a empresa para Apresentado."
        voltar={{ href: "/empresarial/funil", rotulo: "Funil" }}
      />
      <AgendaLista
        proximas={proximas}
        semDesfecho={semDesfecho}
        encerradas={encerradas}
      />
    </div>
  );
}
