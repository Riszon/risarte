import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  resolveOnlineAgenda,
  type OnlineAgendaRow,
} from "@/lib/agenda-settings";
import { EditorDaJornada } from "./editor-da-jornada";

export const metadata: Metadata = { title: "Agenda do comercial" };

/**
 * A AGENDA DO COMERCIAL ONLINE (0268) — relato OC-00072.
 *
 * Separada da configuração da unidade de propósito: aquela fala de sala,
 * cadeira e porta aberta; esta fala de uma pessoa que atende de casa e alcança
 * várias unidades. Juntá-las na mesma tela convidaria a repetir o erro que o
 * relato apontou — tratar a apresentação online como se ela acontecesse dentro
 * da clínica.
 */
export default async function AgendaComercialPage(props: {
  searchParams: Promise<{ consultor?: string }>;
}) {
  const session = await getSessionContext();
  const ehFranqueadora = Object.values(session.rolesByClinic)
    .flat()
    .includes("franchisor_staff");
  // Decisão do dono: Admin Master e Franqueadora. Quem não é nenhum dos dois
  // nem descobre que a tela existe (a RLS recusaria a escrita de qualquer jeito).
  if (!session.isAdminMaster && !ehFranqueadora) notFound();

  const sp = await props.searchParams;
  const escopo = typeof sp.consultor === "string" ? sp.consultor : "";

  const supabase = await createClient();
  const [{ data: linhas }, { data: papeis }] = await Promise.all([
    supabase
      .from("online_agenda_settings")
      .select("user_id, open_time, close_time, weekdays")
      .returns<OnlineAgendaRow[]>(),
    supabase
      .from("user_clinic_roles")
      .select("user_id, profiles ( id, full_name, is_active )")
      .eq("role", "commercial_consultant")
      .returns<
        { user_id: string; profiles: { id: string; full_name: string; is_active: boolean } | null }[]
      >(),
  ]);

  // O mesmo consultor pode atender várias unidades — é o ponto do relato. Ele
  // aparece UMA vez na lista, porque a jornada é da pessoa, não do vínculo.
  const consultores = [
    ...new Map(
      (papeis ?? [])
        .filter((p) => p.profiles?.is_active)
        .map((p) => [p.profiles!.id, { id: p.profiles!.id, full_name: p.profiles!.full_name }])
    ).values(),
  ].sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR"));

  const todas = linhas ?? [];
  const valores = resolveOnlineAgenda(todas, escopo || null);
  const temExcecao = Boolean(escopo) && todas.some((l) => l.user_id === escopo);

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Agenda do comercial (online)
        </h1>
        <p className="text-sm text-muted-foreground">
          A apresentação comercial acontece <strong>online</strong>: ela não usa
          sala nem cadeira, e <strong>não depende do horário da unidade</strong>
          {" "}— o consultor trabalha remoto e atende várias unidades. Aqui ficam
          os dias e horários em que ele atende. O padrão da rede vale para todos;
          quem tiver jornada diferente ganha a sua.
        </p>
      </div>

      <EditorDaJornada
        escopo={escopo}
        consultores={consultores}
        valores={valores}
        temExcecao={temExcecao}
      />

      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        <p className="mb-1 font-medium text-foreground">O que ainda impede uma apresentação</p>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            <strong>Férias do próprio consultor</strong>, marcadas no
            planejamento anual.
          </li>
          <li>
            <strong>Fechamento de agenda que inclua ele</strong> (treinamento,
            evento). Fechamento só de salas não impede.
          </li>
          <li>Um horário em que ele já tem outro compromisso.</li>
        </ul>
        <p className="mt-1.5">
          Feriado da unidade, dia fechado da unidade e recesso da rede{" "}
          <strong>não</strong> impedem mais — foi o que o relato OC-00072 pediu.
        </p>
      </div>
    </div>
  );
}
