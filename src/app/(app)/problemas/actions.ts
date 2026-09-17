"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { APP_VERSION } from "@/lib/version";
import { ROLE_LABELS } from "@/lib/roles";
import { ehModulo } from "@/lib/system-reports";

type Resultado = {
  ok: boolean;
  error?: string;
  code?: string;
  /** O id do relato ou da mensagem criada — é nele que os anexos se prendem. */
  id?: string | null;
};

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
  const modulo = String(formData.get("module") ?? "").trim();

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
  // O módulo é o que permite contar "sugestões por módulo" no painel. Sem ele
  // o relato cai em "Sem módulo" e some da conta que o dono pediu.
  if (!ehModulo(modulo)) {
    return { ok: false, error: "Escolha em que parte do sistema aconteceu." };
  }

  // O papel CONGELADO: quem relata hoje como recepcionista e vira gerente em
  // outubro não pode aparecer como gerente num problema que viu no balcão.
  const papeis = session.rolesByClinic[clinicId] ?? [];
  const papel = session.isAdminMaster
    ? "Admin Master"
    : papeis.map((p) => ROLE_LABELS[p]).join(", ") || null;

  const supabase = await createClient();
  const registro = {
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
  };
  let { data, error } = await supabase
    .from("system_reports")
    .insert({ ...registro, module: modulo })
    .select("id, code")
    .single<{ id: string; code: string }>();

  // Banco ainda sem a 0256: a coluna `module` não existe. Grava sem ela em vez
  // de perder o relato — o texto da pessoa vale mais que a categoria.
  if (error && (error.code === "PGRST204" || error.code === "42703")) {
    ({ data, error } = await supabase
      .from("system_reports")
      .insert(registro)
      .select("id, code")
      .single<{ id: string; code: string }>());
  }

  if (error || !data) {
    return {
      ok: false,
      error:
        error?.code === "42P01"
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

  revalidatePath("/problemas");
  return { ok: true, code: data.code, id: data.id };
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
  const { data: mensagemId, error } = await supabase.rpc("answer_system_report", {
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
    if (error.message.includes("NOTHING_TO_SAVE")) {
      return {
        ok: false,
        error: "Escreva uma resposta ou mude a situação — não havia nada para salvar.",
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

  revalidatePath("/problemas", "layout");
  // A 0256 devolvia nada; a 0257 devolve o id da mensagem (nulo quando só a
  // situação mudou).
  return { ok: true, id: typeof mensagemId === "string" ? mensagemId : null };
}

/**
 * Complementar o próprio relato enquanto está aberto (0256).
 *
 * A regra — só quem relatou, só enquanto aberto — mora no banco
 * (`add_system_report_comment`). Aqui só se traduz a recusa.
 */
export async function complementarProblema(
  formData: FormData
): Promise<Resultado> {
  const session = await getSessionContext();
  const id = String(formData.get("id") ?? "");
  const texto = String(formData.get("body") ?? "").trim();

  if (texto.length < 3) {
    return { ok: false, error: "Escreva o que quer acrescentar." };
  }

  const supabase = await createClient();
  const { data: mensagemId, error } = await supabase.rpc("add_system_report_comment", {
    p_report_id: id,
    p_body: texto,
  });

  if (error) {
    if (error.message.includes("REPORT_CLOSED")) {
      return {
        ok: false,
        error: "Este relato já foi encerrado. Se não resolveu, use \"Não resolveu\".",
      };
    }
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Só quem relatou pode complementar." };
    }
    return { ok: false, error: mensagemDeMigracao(error) };
  }

  await logAudit({
    action: "update",
    entityType: "system_reports",
    entityId: id,
    clinicId: session.activeClinic?.id,
    details: { acao: "complemento" },
  });

  revalidatePath("/problemas", "layout");
  return { ok: true, id: typeof mensagemId === "string" ? mensagemId : null };
}

/**
 * Reabrir o próprio relato quando a solução não funcionou (decisão do dono,
 * 16/09/2026). Sempre com motivo: reabrir sem dizer o que falhou devolve a
 * quem vai corrigir o mesmo problema, sem pista do que faltou.
 */
export async function reabrirProblema(formData: FormData): Promise<Resultado> {
  const session = await getSessionContext();
  const id = String(formData.get("id") ?? "");
  const motivo = String(formData.get("reason") ?? "").trim();

  if (motivo.length < 10) {
    return {
      ok: false,
      error: "Conte o que não funcionou (pelo menos 10 letras) — é por aí que a correção recomeça.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_system_report", {
    p_report_id: id,
    p_reason: motivo,
  });

  if (error) {
    if (error.message.includes("REPORT_NOT_CLOSED")) {
      return { ok: false, error: "Este relato ainda está aberto — use o complemento." };
    }
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Só quem relatou pode reabrir." };
    }
    if (error.message.includes("REASON_REQUIRED")) {
      return { ok: false, error: "Conte o que não funcionou." };
    }
    return { ok: false, error: mensagemDeMigracao(error) };
  }

  await logAudit({
    action: "update",
    entityType: "system_reports",
    entityId: id,
    clinicId: session.activeClinic?.id,
    details: { acao: "reabertura" },
  });

  revalidatePath("/problemas", "layout");
  return { ok: true };
}

function mensagemDeMigracao(error: { code?: string; message: string }): string {
  // Função inexistente = banco sem a 0256.
  return error.code === "PGRST202" || error.message.includes("Could not find the function")
    ? "Esta ação precisa da migração 0256, ainda não aplicada neste banco."
    : "Não foi possível salvar agora. Tente de novo em instantes.";
}

/**
 * Marcar como lida a resposta de um relato de quem chamou.
 *
 * ⚠️ É O QUE FAZ O INDICADOR DA BOIA ZERAR — e sem ele o número da equipe não
 * zeraria nunca: relato respondido continuaria contando para sempre. Alerta que
 * não zera é alerta que ninguém lê, a lição que `finance_alerts` (0230) já tinha
 * pago uma vez.
 *
 * A escrita passa por `mark_system_report_seen()` (0256; a 0252 marcava
 * todos) porque a política de UPDATE da 0247 é do Admin Master e SÓ dele, de
 * propósito. Afrouxá-la para caber esta marca devolveria a quem relatou o poder
 * de fechar o próprio relato, e a fila viraria uma lista que se resolve
 * sozinha. A função é a porta
 * estreita: uma coluna, e só nas linhas de quem chamou.
 *
 * Não há `logAudit` aqui de propósito: "abri a tela e li a resposta do meu
 * próprio relato" não é acesso a dado de ninguém, e registrar isso encheria a
 * trilha de linhas sem valor investigativo — a trilha existe para o que toca
 * ficha de paciente.
 */
export async function marcarRelatoVisto(reportId: string): Promise<void> {
  await getSessionContext();
  const supabase = await createClient();
  // ⚠️ POR RELATO (0256): a etiqueta "Resposta nova" fica no relato até a
  // pessoa abrir AQUELE relato. Banco sem a 0256 não tem esta função: cai
  // na da 0252, que marca todos — o comportamento de antes, não um erro.
  const { error } = await supabase.rpc("mark_system_report_seen", {
    p_report_id: reportId,
  });
  if (error) {
    // Sem a 0252 também: o número fica teimoso, a tela não quebra.
    await supabase.rpc("mark_system_reports_seen");
  }
  // A lista precisa apagar a etiqueta "Resposta nova" quando a pessoa voltar.
  revalidatePath("/problemas");
}

// -----------------------------------------------------------------------------
// Anexos (0257)
// -----------------------------------------------------------------------------

/**
 * Registrar um anexo que o NAVEGADOR já enviou ao Storage.
 *
 * O arquivo sobe direto do navegador (a política do bucket decide quem pode) e
 * só depois é registrado aqui. A ordem é essa porque arquivo grande passando
 * pelo servidor estouraria o limite de tamanho de uma ação. O banco confere que
 * o arquivo existe mesmo (`FILE_NOT_FOUND`) antes de aceitar o registro.
 */
export async function registrarAnexo(input: {
  reportId: string;
  messageId: string | null;
  path: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: "captura" | "arquivo";
}): Promise<Resultado> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_system_report_attachment", {
    p_report_id: input.reportId,
    p_message_id: input.messageId,
    p_path: input.path,
    p_file_name: input.fileName || "arquivo",
    p_mime_type: input.mimeType,
    p_size_bytes: input.sizeBytes,
    p_kind: input.kind,
  });

  if (error) {
    const m = error.message;
    const texto = m.includes("TOO_MANY_ATTACHMENTS")
      ? "Este relato já tem 10 anexos. Remova um para enviar outro."
      : m.includes("NOT_ALLOWED")
        ? "Só quem relatou (com o relato aberto) e o suporte podem anexar."
        : m.includes("FILE_NOT_FOUND")
          ? "O arquivo não chegou ao servidor. Tente anexar de novo."
          : mensagemDeMigracao(error);
    return { ok: false, error: texto };
  }

  // Sem nome de arquivo no registro: ele pode citar paciente.
  await logAudit({
    action: "create",
    entityType: "system_report_attachments",
    entityId: String(data),
    clinicId: session.activeClinic?.id,
    details: { relato: input.reportId, tipo: input.kind },
  });

  revalidatePath("/problemas", "layout");
  return { ok: true, id: String(data) };
}

/**
 * Remover um anexo — quem enviou ou o Admin Master.
 *
 * Existe por causa da LGPD: um print com dado de paciente enviado por engano
 * tem de poder sair. O banco grava a lápide (quem e quando) e devolve o
 * caminho; o arquivo é apagado pela API do Storage, com a sessão da própria
 * pessoa — a política do bucket confere de novo quem pode.
 */
export async function removerAnexo(attachmentId: string): Promise<Resultado> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: caminho, error } = await supabase.rpc(
    "remove_system_report_attachment",
    { p_attachment_id: attachmentId }
  );

  if (error) {
    return {
      ok: false,
      error: error.message.includes("NOT_ALLOWED")
        ? "Só quem enviou o anexo ou o suporte podem removê-lo."
        : error.message.includes("ATTACHMENT_NOT_FOUND")
          ? "Este anexo já foi removido."
          : mensagemDeMigracao(error),
    };
  }

  const { error: erroArquivo } = await supabase.storage
    .from("system-reports")
    .remove([String(caminho)]);

  await logAudit({
    // A trilha não tem "delete": o registro não some, vira lápide.
    action: "update",
    entityType: "system_report_attachments",
    entityId: attachmentId,
    clinicId: session.activeClinic?.id,
    details: { acao: "remocao", arquivo_apagado: !erroArquivo },
  });

  revalidatePath("/problemas", "layout");
  if (erroArquivo) {
    // A lápide já está gravada, então o link não é mais oferecido a ninguém.
    return {
      ok: true,
      error: "O anexo saiu da conversa, mas o arquivo não foi apagado do servidor. Avise o suporte.",
    };
  }
  return { ok: true };
}
