"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { APP_VERSION } from "@/lib/version";
import { ROLE_LABELS } from "@/lib/roles";

type Resultado = { ok: boolean; error?: string; code?: string };

/**
 * Registrar um problema.
 *
 * O QUE O SISTEMA PREENCHE, A PESSOA NÃO DIGITA. A seção 9.4 do manual pedia
 * doze linhas copiadas à mão — data, hora, usuário, papel, unidade, tela,
 * versão, navegador. Ninguém preenche isso no meio do expediente, então o que
 * chegava era "não deu certo", sem nada do que torna o problema encontrável.
 *
 * Aqui a pessoa escreve só o que ela sabe e o sistema não tem como saber.
 */
export async function registrarProblema(
  formData: FormData
): Promise<Resultado> {
  const session = await getSessionContext();
  const clinicId = session.activeClinic?.id ?? null;

  if (!clinicId) {
    return {
      ok: false,
      error: "Escolha uma unidade no menu lateral antes de registrar.",
    };
  }

  const titulo = String(formData.get("title") ?? "").trim();
  const oQueAconteceu = String(formData.get("what_happened") ?? "").trim();
  const esperado = String(formData.get("expected") ?? "").trim();
  const tipo = String(formData.get("kind") ?? "erro");
  const gravidade = String(formData.get("severity") ?? "media");
  const tela = String(formData.get("screen") ?? "").trim();
  const digest = String(formData.get("error_digest") ?? "").trim();
  const navegador = String(formData.get("user_agent") ?? "").trim();

  if (titulo.length < 5) {
    return { ok: false, error: "Escreva um resumo com pelo menos 5 letras." };
  }
  if (oQueAconteceu.length < 10) {
    // Relato de uma palavra volta para a pessoa dias depois como pergunta, e a
    // essa altura ninguém lembra. Melhor pedir agora, com o caso fresco.
    return {
      ok: false,
      error: "Conte o que aconteceu com um pouco mais de detalhe.",
    };
  }
  if (!["erro", "duvida", "sugestao"].includes(tipo)) {
    return { ok: false, error: "Tipo inválido." };
  }
  if (!["baixa", "media", "alta"].includes(gravidade)) {
    return { ok: false, error: "Gravidade inválida." };
  }

  // O papel CONGELADO: quem relata hoje como recepcionista e vira gerente em
  // outubro não pode aparecer como gerente num problema que viu no balcão.
  const papeis = session.rolesByClinic[clinicId] ?? [];
  const papel = session.isAdminMaster
    ? "Admin Master"
    : papeis.map((p) => ROLE_LABELS[p]).join(", ") || null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("system_reports")
    .insert({
      clinic_id: clinicId,
      reporter_id: session.userId,
      reporter_role: papel,
      kind: tipo,
      severity: gravidade,
      title: titulo,
      what_happened: oQueAconteceu,
      expected: esperado || null,
      screen: tela || null,
      app_version: APP_VERSION,
      error_digest: digest || null,
      // Cortado: o navegador manda uma linha longa e só os primeiros campos
      // dizem alguma coisa (sistema e versão do navegador).
      user_agent: navegador ? navegador.slice(0, 300) : null,
    })
    .select("code")
    .single<{ code: string }>();

  if (error) {
    return {
      ok: false,
      error:
        error.code === "42P01"
          ? "Esta tela precisa da migração 0247, ainda não aplicada neste banco."
          : "Não foi possível registrar agora. Tente de novo em instantes.",
    };
  }

  // Só ids e metadados — nunca o texto do relato, que pode citar paciente.
  await logAudit({
    action: "create",
    entityType: "system_reports",
    entityId: data.code,
    clinicId,
  });

  revalidatePath("/sistema");
  return { ok: true, code: data.code };
}

/** Responder e mudar a situação — Admin Master, conferido também no banco. */
export async function responderProblema(
  formData: FormData
): Promise<Resultado> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) {
    return { ok: false, error: "Você não tem permissão para isto." };
  }

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const resposta = String(formData.get("answer") ?? "").trim();
  const versao = String(formData.get("resolved_version") ?? "").trim();

  if (!["aberto", "em_analise", "resolvido", "nao_e_defeito"].includes(status)) {
    return { ok: false, error: "Situação inválida." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_system_report", {
    p_report_id: id,
    p_status: status,
    p_answer: resposta || null,
    p_resolved_version: versao || null,
  });

  if (error) {
    // A regra vive no banco (`ANSWER_REQUIRED`): encerrar sem dizer por quê é
    // o que faz a equipe parar de relatar.
    if (error.message.includes("ANSWER_REQUIRED")) {
      return {
        ok: false,
        error: "Escreva a resposta antes de encerrar — quem relatou vai lê-la.",
      };
    }
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Você não tem permissão para isto." };
    }
    return { ok: false, error: "Não foi possível salvar agora." };
  }

  await logAudit({
    action: "update",
    entityType: "system_reports",
    entityId: id,
    clinicId: session.activeClinic?.id,
    details: { status },
  });

  revalidatePath("/sistema");
  return { ok: true };
}
