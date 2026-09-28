import "server-only";
import { fullAccessClinicIds, type SessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { indicaDb } from "@/lib/indica/db";

export type Unidade = { id: string; name: string };

/**
 * As unidades onde esta pessoa pode registrar indicação.
 *
 * Unidade ativa comum → só ela. Na Franqueadora (SDR, consultor, rede, Admin)
 * a pessoa escolhe: vale o alcance de unidades dela, o MESMO que o banco usa
 * em `indica.eh_risartano` — oferecer uma unidade que o banco recusa seria
 * mostrar uma porta pintada.
 */
export async function unidadesParaIndicar(session: SessionContext): Promise<Unidade[]> {
  const ativa = session.activeClinic;
  if (ativa && ativa.type === "franchise_unit") {
    return [{ id: ativa.id, name: ativa.name }];
  }
  const supabase = await createClient();
  let consulta = supabase
    .from("clinics")
    .select("id, name")
    .eq("type", "franchise_unit")
    .eq("is_active", true)
    .order("name");
  if (!session.isAdminMaster) {
    const ids = await fullAccessClinicIds();
    const nomeadas = session.clinics.filter((c) => c.type === "franchise_unit").map((c) => c.id);
    const todas = [...new Set([...ids, ...nomeadas])];
    if (todas.length === 0) return [];
    consulta = consulta.in("id", todas);
  }
  const { data } = await consulta.returns<Unidade[]>();
  return data ?? [];
}

/** A versão do regulamento que o Embaixador precisa aceitar (vem do banco). */
export async function regulamentoVigente(): Promise<string | null> {
  const db = await indicaDb();
  const { data, error } = await db.rpc("config_valor", {
    p_chave: "regulamento_versao_vigente",
  });
  if (error) return null;
  return typeof data === "string" ? data : null;
}

/** Nomes de Risartanos por id (quem pediu, quem converteu, quem mexeu). */
export async function nomesDePessoas(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unicos.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", unicos)
    .returns<{ id: string; full_name: string | null }[]>();
  return new Map((data ?? []).map((p) => [p.id, p.full_name ?? "—"]));
}
