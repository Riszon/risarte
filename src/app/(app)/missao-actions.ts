"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import type { MetaDoTreino } from "@/lib/certificacao";
import { medirMatricula, registrarSeCumprida } from "@/lib/certificacao-servidor";
import { recadoDaConclusao } from "@/lib/certificacao-conclusao";
import type { UserRole } from "@/lib/roles";

export type ActionResult = { ok: boolean; error?: string };

/**
 * ⚠️ O CLIQUE QUE COMEÇA A MISSÃO.
 *
 * Só a própria pessoa inicia — e a trava de verdade está no banco
 * (`ONLY_THE_PERSON_STARTS`), não aqui. A razão não é formalidade: o marco só
 * significa alguma coisa se ela SOUBER que dali em diante está sendo medida.
 * Admin iniciando pelos outros devolveria exatamente o problema que a 0273
 * existe para resolver — a pessoa estaria sendo avaliada enquanto ainda
 * pensava que estava aprendendo.
 */
export async function iniciarMinhaMissao(
  enrollmentId: string
): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "Sessão expirada. Entre de novo." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("start_training_mission", {
    p_enrollment_id: enrollmentId,
  });

  if (error) {
    const m = error.message;
    return {
      ok: false,
      error: m.includes("ONLY_THE_PERSON_STARTS")
        ? "Só você pode começar a sua própria missão."
        : m.includes("ENROLLMENT_NOT_FOUND")
          ? "Esta convocação não existe mais."
          : m.includes("ENROLLMENT_DISMISSED")
            ? "Você foi dispensado desta turma."
            : "Não foi possível iniciar a missão. Tente de novo.",
    };
  }

  await logAudit({
    action: "update",
    entityType: "training_enrollments",
    entityId: enrollmentId,
  });

  revalidatePath("/");
  return { ok: true };
}

/**
 * "CONFERIR MINHA MISSÃO" (0281) — mede agora e, se cumpriu, registra.
 *
 * O Início já faz isso a cada abertura; o botão existe para a pessoa que
 * acabou de fazer o último cadastro no treino e quer saber na hora, sem
 * adivinhar que precisa recarregar a página.
 *
 * ⚠️ Só a PRÓPRIA missão: a matrícula é lida como a pessoa (RLS) e o dono é
 * conferido. O registro em si é do servidor (`registrarSeCumprida`).
 */
export async function conferirMinhaMissao(
  enrollmentId: string
): Promise<ActionResult & { cumprida?: boolean; recado?: string }> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "Sessão expirada. Entre de novo." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("training_enrollments")
    .select("id, user_id, role, status, started_at")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (error) {
    return { ok: false, error: "Não foi possível conferir agora. Tente de novo em instantes." };
  }
  if (!data || data.user_id !== ctx.userId) {
    return { ok: false, error: "Esta missão não é sua." };
  }
  if (data.status !== "em_andamento" || !data.started_at) {
    return { ok: false, error: "Esta missão não está valendo agora." };
  }

  const papel = data.role as UserRole;
  const { data: metas, error: erroDasMetas } = await supabase
    .from("training_requirements")
    .select("role, indicator, minimum_count")
    .eq("role", papel)
    .returns<MetaDoTreino[]>();
  if (erroDasMetas) {
    return { ok: false, error: "Não foi possível conferir agora. Tente de novo em instantes." };
  }

  const medicao = await medirMatricula({
    email: ctx.email,
    role: papel,
    started_at: String(data.started_at),
    metas: metas ?? [],
  });
  if (medicao.estado !== "medido") {
    return {
      ok: false,
      error:
        medicao.estado === "sem_medicao"
          ? `Não deu para medir agora: ${medicao.motivo}. O seu trabalho no treino não se perdeu.`
          : "A missão ainda não começou.",
    };
  }

  const registrado = await registrarSeCumprida(String(data.id), medicao);
  revalidatePath("/");
  if (registrado) {
    return { ok: true, cumprida: true, recado: recadoDaConclusao(registrado) };
  }
  if (medicao.progresso.cumprida) {
    return {
      ok: false,
      error: "Você cumpriu a missão, mas não consegui registrar agora. Tente de novo em instantes — nada se perdeu.",
    };
  }
  return { ok: true, cumprida: false, recado: "Ainda faltam critérios — o progresso está logo abaixo." };
}
