"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { timeToMinutes } from "@/lib/agenda-settings";

export type ResultadoDaJornada = { ok: boolean; error?: string };

/**
 * Quem pode mexer na jornada do comercial: **Admin Master e Franqueadora**
 * (decisão do dono, 22/09/2026). O próprio consultor não muda a dele — quem
 * fecha a própria agenda sem ninguém ver some do funil sem explicação.
 *
 * A guarda de verdade está na RLS da tabela (0268); esta aqui existe para a
 * mensagem sair em português em vez de um erro cru do banco.
 */
async function exigirGestao(): Promise<{ error?: string; userId?: string }> {
  const session = await getSessionContext();
  if (session.isAdminMaster) return { userId: session.userId };
  const ehFranqueadora = Object.values(session.rolesByClinic)
    .flat()
    .includes("franchisor_staff");
  if (ehFranqueadora) return { userId: session.userId };
  return { error: "Só o Admin Master e a Franqueadora configuram a agenda do comercial." };
}

/**
 * Grava a jornada do atendimento ONLINE (0268).
 *
 * `userId` nulo = padrão da REDE. Com `userId` = a exceção daquele consultor.
 */
export async function salvarJornadaOnline(
  userId: string | null,
  input: { openTime: string; closeTime: string; weekdays: number[] }
): Promise<ResultadoDaJornada> {
  const guarda = await exigirGestao();
  if (guarda.error) return { ok: false, error: guarda.error };

  if (!/^\d{2}:\d{2}$/.test(input.openTime) || !/^\d{2}:\d{2}$/.test(input.closeTime)) {
    return { ok: false, error: "Horário inválido." };
  }
  if (timeToMinutes(input.openTime) >= timeToMinutes(input.closeTime)) {
    return { ok: false, error: "O início do atendimento deve ser antes do fim." };
  }
  const weekdays = [...new Set(input.weekdays)].filter((d) => d >= 0 && d <= 6);
  if (weekdays.length === 0) {
    // Zero dias apagaria o consultor da agenda em silêncio: ninguém
    // conseguiria marcar com ele e a tela não explicaria por quê.
    return { ok: false, error: "Escolha ao menos um dia de atendimento." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("online_agenda_settings").upsert(
    {
      user_id: userId,
      open_time: input.openTime,
      close_time: input.closeTime,
      weekdays,
      updated_at: new Date().toISOString(),
      updated_by: guarda.userId,
    },
    { onConflict: "user_id" }
  );
  if (error) {
    console.error("salvarJornadaOnline falhou:", error.message);
    return { ok: false, error: "Não foi possível salvar a jornada." };
  }

  await logAudit({
    action: "update",
    entityType: "online_agenda_settings",
    entityId: userId ?? "rede",
  });
  revalidatePath("/admin/agenda-comercial");
  revalidatePath("/agenda");
  return { ok: true };
}

/** Apaga a exceção: o consultor volta a seguir a rede. */
export async function voltarAoPadraoDaRede(userId: string): Promise<ResultadoDaJornada> {
  const guarda = await exigirGestao();
  if (guarda.error) return { ok: false, error: guarda.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("online_agenda_settings")
    .delete()
    .eq("user_id", userId);
  if (error) {
    console.error("voltarAoPadraoDaRede falhou:", error.message);
    return { ok: false, error: "Não foi possível voltar ao padrão." };
  }
  // A trilha só conhece create/update/view/anonymize/export/login. Voltar ao
  // padrão é uma ATUALIZAÇÃO da regra daquele consultor, não a exclusão de um
  // registro de negócio — e inventar uma ação nova aqui mudaria o vocabulário
  // da auditoria inteira por causa de uma tela.
  await logAudit({
    action: "update",
    entityType: "online_agenda_settings",
    entityId: userId,
    details: { voltou_ao_padrao_da_rede: true },
  });
  revalidatePath("/admin/agenda-comercial");
  revalidatePath("/agenda");
  return { ok: true };
}
