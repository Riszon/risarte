import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { empresarialDb } from "@/lib/empresarial/db";
import { canViewEmpresarial } from "@/lib/empresarial/access";
import { buildIcs, icsFileName } from "@/lib/empresarial/agenda";
import {
  MEETING_MODE_LABELS,
  type MeetingMode,
} from "@/lib/empresarial/constants";

/**
 * "Adicionar à minha agenda" — devolve a reunião como arquivo de calendário.
 *
 * Google Agenda, Outlook e o celular abrem este formato. É o caminho que
 * funciona HOJE, sem credencial nenhuma; a sincronização de mão dupla com o
 * Google é etapa própria e depende da conta Google da empresa.
 *
 * A RLS é quem decide o que pode ser lido: a consulta usa a sessão da pessoa,
 * então um endereço adivinhado não devolve a reunião de outro consultor.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const { meetingId } = await params;

  const session = await getSessionContext();
  if (!canViewEmpresarial(session)) {
    return new NextResponse("Sem permissão.", { status: 403 });
  }

  const db = await empresarialDb();
  const { data: reuniao, error } = await db
    .from("lead_meetings")
    .select(
      "id, title, mode, location, starts_at, ends_at, status_note, commercial_leads ( company_name, contact_name )"
    )
    .eq("id", meetingId)
    .maybeSingle<{
      id: string;
      title: string | null;
      mode: MeetingMode;
      location: string | null;
      starts_at: string;
      ends_at: string;
      status_note: string | null;
      commercial_leads: {
        company_name: string;
        contact_name: string | null;
      } | null;
    }>();

  // Erro de consulta NÃO é "reunião não existe". Confundir os dois devolveria
  // 404 para um problema de banco, e o diagnóstico começaria no lugar errado.
  if (error) {
    console.error("ics: consulta falhou:", error.message);
    return new NextResponse("Não foi possível montar o arquivo.", { status: 500 });
  }
  if (!reuniao) {
    return new NextResponse("Reunião não encontrada.", { status: 404 });
  }

  const empresa = reuniao.commercial_leads?.company_name ?? "Risarte Empresarial";
  const partes = [
    `Risarte Empresarial — ${MEETING_MODE_LABELS[reuniao.mode]}`,
    reuniao.commercial_leads?.contact_name
      ? `Contato: ${reuniao.commercial_leads.contact_name}`
      : null,
    reuniao.status_note,
  ].filter(Boolean);

  const ics = buildIcs({
    id: reuniao.id,
    resumo: reuniao.title || `Apresentação Risarte Empresarial — ${empresa}`,
    descricao: partes.join("\n"),
    local: reuniao.location,
    inicio: reuniao.starts_at,
    fim: reuniao.ends_at,
  });

  return new NextResponse(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${icsFileName(empresa)}"`,
      // Reunião remarcada muda o arquivo: guardar em cache entregaria a data
      // velha para quem clicasse de novo.
      "cache-control": "no-store",
    },
  });
}
