"use server";

// Horário por dia e feriados da unidade (0368 — Rita, Fase 0A.4).
//
// ⚠️ DA8: a agenda da equipe AINDA NÃO LÊ o horário por dia (Fase 1). Ele é o
// que a Rita vai informar e usar. As regras de linha da 0368 conferem tudo de
// novo no banco: a linha da REDE só o Admin grava; a da unidade, Admin ou
// Gerente; feriado estadual/municipal só do estado/cidade de uma unidade que a
// pessoa gere.

import { revalidatePath } from "next/cache";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { WEEKDAY_NAMES } from "@/lib/agenda-settings";
import {
  validarHorarioPorDia,
  type EscopoDoFeriado,
  type HorarioDoDia,
} from "@/lib/unidade-publica";

export type Resultado = { ok: boolean; error?: string };

const caminho = "/agenda/configuracao";

/** Grava os 7 dias (unidade, ou a rede quando `clinicId` é nulo). */
export async function salvarHorarioPorDia(
  clinicId: string | null,
  dias: HorarioDoDia[]
): Promise<Resultado> {
  const session = await getSessionContext();
  if (clinicId === null ? !session.isAdminMaster : !hasRoleInClinic(session, clinicId, ["unit_manager"])) {
    return {
      ok: false,
      error: clinicId === null
        ? "Só o Admin Master muda o horário padrão da rede."
        : "Apenas a Gerente da unidade (ou o Admin) muda o horário por dia.",
    };
  }
  const conferido = validarHorarioPorDia(dias, WEEKDAY_NAMES);
  if (!conferido.ok) return { ok: false, error: conferido.erro };

  const supabase = await createClient();
  const linhas = dias.map((d) => ({
    clinic_id: clinicId,
    weekday: d.weekday,
    closed: d.closed,
    open_time: d.closed ? null : d.open,
    close_time: d.closed ? null : d.close,
    lunch_start: d.closed || !d.lunchStart ? null : d.lunchStart,
    lunch_end: d.closed || !d.lunchEnd ? null : d.lunchEnd,
    updated_at: new Date().toISOString(),
    updated_by: session.userId,
  }));
  const { data, error } = await supabase
    .from("clinic_weekday_hours")
    .upsert(linhas, { onConflict: "clinic_id,weekday" })
    .select("weekday");
  if (error) {
    console.error("salvarHorarioPorDia:", error.code);
    return { ok: false, error: "Não foi possível salvar o horário por dia." };
  }
  // A regra de linha recusa em silêncio (0 linhas): dizer, não fingir.
  if ((data ?? []).length !== 7) {
    return { ok: false, error: "O horário não foi gravado (sem permissão para esta unidade)." };
  }
  revalidatePath(caminho);
  return { ok: true };
}

/** A unidade deixa o horário próprio e volta a seguir o padrão da rede. */
export async function usarHorarioDaRede(clinicId: string): Promise<Resultado> {
  const session = await getSessionContext();
  if (!hasRoleInClinic(session, clinicId, ["unit_manager"])) {
    return { ok: false, error: "Apenas a Gerente da unidade (ou o Admin) muda o horário por dia." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("clinic_weekday_hours").delete().eq("clinic_id", clinicId);
  if (error) {
    console.error("usarHorarioDaRede:", error.code);
    return { ok: false, error: "Não foi possível voltar ao padrão da rede." };
  }
  revalidatePath(caminho);
  return { ok: true };
}

export async function adicionarFeriado(entrada: {
  date: string;
  name: string;
  scope: EscopoDoFeriado;
  state: string | null;
  city: string | null;
}): Promise<Resultado> {
  const session = await getSessionContext();
  const nome = entrada.name.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada.date)) return { ok: false, error: "Informe a data." };
  if (nome.length < 2 || nome.length > 80) return { ok: false, error: "Informe o nome do feriado (até 80 caracteres)." };
  if (entrada.scope === "national" && !session.isAdminMaster) {
    return { ok: false, error: "Só o Admin Master cadastra feriado nacional." };
  }
  const uf = entrada.scope === "national" ? null : (entrada.state ?? "").trim().toUpperCase();
  const cidade = entrada.scope === "city" ? (entrada.city ?? "").trim() : null;
  if (entrada.scope !== "national" && !/^[A-Z]{2}$/.test(uf ?? "")) {
    return { ok: false, error: "A unidade não tem estado cadastrado." };
  }
  if (entrada.scope === "city" && (cidade ?? "").length < 2) {
    return { ok: false, error: "A unidade não tem cidade cadastrada." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("holidays")
    .insert({ holiday_date: entrada.date, name: nome, scope: entrada.scope, state: uf, city: cidade, created_by: session.userId })
    .select("id");
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Esse feriado já está cadastrado." };
    if (error.code === "42501") return { ok: false, error: "Sem permissão para cadastrar este feriado." };
    console.error("adicionarFeriado:", error.code);
    return { ok: false, error: "Não foi possível cadastrar o feriado." };
  }
  if ((data ?? []).length !== 1) return { ok: false, error: "O feriado não foi gravado (sem permissão)." };
  revalidatePath(caminho);
  return { ok: true };
}

export async function removerFeriado(id: string): Promise<Resultado> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("holidays").delete().eq("id", id).select("id");
  if (error) {
    console.error("removerFeriado:", error.code);
    return { ok: false, error: "Não foi possível remover o feriado." };
  }
  if ((data ?? []).length !== 1) return { ok: false, error: "Sem permissão para remover este feriado." };
  revalidatePath(caminho);
  return { ok: true };
}
