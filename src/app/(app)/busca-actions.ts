"use server";

import { getSessionContext, pode } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { JourneyPhase } from "@/lib/journey";

export type ClienteEncontrado = {
  id: string;
  fullName: string;
  code: string | null;
  status: "active" | "inactive" | "anonymized";
  journeyPhase: JourneyPhase;
  clinicName: string;
};

/**
 * A busca rápida de prontuários.
 *
 * ⚠️ O TERMO NÃO PASSA PELO ENDEREÇO. É por isso que isto é uma ação de
 * servidor e não uma página com `?q=`: nome e CPF de paciente não entram em
 * URL — regra de LGPD deste projeto desde o começo, e URL vai para histórico do
 * navegador, para registro do servidor e para o print que alguém manda no
 * grupo.
 *
 * Quem filtra o resultado é a RLS, dentro de `search_clients` (0251). A guarda
 * daqui é só de conforto: barra quem nem deveria ver a busca.
 */
export async function buscarProntuarios(
  termo: string
): Promise<ClienteEncontrado[]> {
  const session = await getSessionContext();
  if (!pode(session, "menu.prontuarios")) return [];

  const texto = termo.trim();
  if (texto.length < 2) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_clients", {
    p_term: texto,
    p_limit: 8,
  });

  if (error) {
    // Nunca o termo na mensagem: ele é dado de paciente.
    console.error("search_clients falhou:", error.message);
    return [];
  }

  return ((data ?? []) as {
    id: string;
    full_name: string;
    code: string | null;
    status: ClienteEncontrado["status"];
    journey_phase: JourneyPhase;
    clinic_name: string;
  }[]).map((c) => ({
    id: c.id,
    fullName: c.full_name,
    code: c.code,
    status: c.status,
    journeyPhase: c.journey_phase,
    clinicName: c.clinic_name,
  }));
}
