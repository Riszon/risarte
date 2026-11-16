"use server";

import { revalidatePath } from "next/cache";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import {
  ehEscopo,
  ehGatilho,
  ehModoDeGrupo,
  ehPoliticaDeAcesso,
  ehTipoDeTurma,
  oQueImpedeAbrir,
  indicadoresDoPapel,
  normalizarMeta,
  PAPEIS_COM_MISSAO,
  chaveDaConvocacao,
  lerAproveitadas,
  type CandidatoDaUnidade,
  type Medicao,
  type MetaDoTreino,
} from "@/lib/certificacao";
import {
  guardarProgresso,
  medirMatricula,
  medirVarias,
  registrarSeCumprida,
} from "@/lib/certificacao-servidor";
import type { ResultadoDaConclusao } from "@/lib/certificacao-conclusao";
import type { UserRole } from "@/lib/roles";
import { todayInBrazil } from "@/lib/dates";

export type ActionResult = { ok: boolean; error?: string };

/**
 * Grava a missão de UMA função. A tela salva função por função de propósito:
 * um botão só, salvando as treze, faria o Admin perder o trabalho das outras
 * doze quando errasse um número — e ele não saberia qual.
 */
export async function salvarMissao(
  papel: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdminMaster();

  if (!(PAPEIS_COM_MISSAO as readonly string[]).includes(papel)) {
    return { ok: false, error: "Função desconhecida." };
  }
  const role = papel as UserRole;

  // Só os indicadores DAQUELA função entram. Ler o formulário inteiro deixaria
  // um campo renomeado no navegador gravar meta para indicador de outro papel.
  const metas: Record<string, number> = {};
  for (const indicador of indicadoresDoPapel(role)) {
    metas[indicador.chave] = normalizarMeta(formData.get(indicador.chave));
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_training_requirements", {
    p_role: role,
    p_metas: metas,
  });

  if (error) {
    return {
      ok: false,
      error:
        error.message === "NOT_ALLOWED"
          ? "Só o Admin Master define as metas de treino."
          : "Não foi possível salvar as metas. Tente de novo.",
    };
  }

  await logAudit({
    action: "update",
    entityType: "training_requirements",
    entityId: role,
  });

  revalidatePath("/admin/certificacao");
  return { ok: true };
}

/**
 * Grava os dois eixos de liberação e, junto, o grupo do teste coletivo (0272).
 *
 * ⚠️ NUM FORMULÁRIO SÓ, de propósito. O grupo só existe por causa do modo
 * coletivo; salvá-los separadamente abriria a janela em que a liberação já é
 * coletiva e o grupo ainda está vazio — e nessa janela ninguém seria liberado,
 * sem nada na tela explicando por quê.
 */
export async function salvarPortao(formData: FormData): Promise<ActionResult> {
  await requireAdminMaster();

  const escopo = String(formData.get("release_scope") ?? "");
  const gatilho = String(formData.get("release_trigger") ?? "");
  const modo = String(formData.get("cohort_mode") ?? "papeis");

  // Valor fora da lista é recusado AQUI, com nome: deixar chegar ao banco daria
  // um "erro ao salvar" sem nada explicando qual dos campos está errado.
  if (!ehEscopo(escopo)) return { ok: false, error: "Escopo inválido." };
  if (!ehGatilho(gatilho)) return { ok: false, error: "Gatilho inválido." };
  if (!ehModoDeGrupo(modo)) return { ok: false, error: "Modo de grupo inválido." };

  const supabase = await createClient();

  const { error } = await supabase.rpc("save_training_settings", {
    p_scope: escopo,
    p_trigger: gatilho,
  });
  if (error) {
    return {
      ok: false,
      error:
        error.message === "NOT_ALLOWED"
          ? "Só o Admin Master muda as regras de liberação."
          : "Não foi possível salvar as regras. Tente de novo.",
    };
  }

  // O formulário só traz as caixas do modo que está aparecendo. As duas listas
  // são enviadas mesmo assim (uma vazia) porque o banco guarda as duas: trocar
  // de modo para conferir e voltar não pode apagar o que já foi montado — e o
  // que for enviado vazio é justamente o que o Admin não está editando agora.
  const papeisMarcados = formData.getAll("cohort_roles").map(String);
  const pessoasMarcadas = formData.getAll("cohort_members").map(String);

  const { error: erroGrupo } = await supabase.rpc("save_training_cohort", {
    p_mode: modo,
    p_roles: modo === "papeis" ? papeisMarcados : null,
    p_members: modo === "pessoas" ? pessoasMarcadas : null,
  });
  if (erroGrupo) {
    return {
      ok: false,
      error:
        erroGrupo.message === "NOT_ALLOWED"
          ? "Só o Admin Master muda o grupo do teste coletivo."
          : "As regras foram salvas, mas o grupo não. Tente salvar de novo.",
    };
  }

  await logAudit({
    action: "update",
    entityType: "training_settings",
    details: {
      escopo,
      gatilho,
      modo,
      participantes:
        modo === "papeis" ? papeisMarcados.length : pessoasMarcadas.length,
    },
  });

  revalidatePath("/admin/certificacao");
  return { ok: true };
}

/**
 * A PRÉVIA: quem entraria na turma, antes de convocar — para UMA ou VÁRIAS
 * unidades (0275).
 *
 * ⚠️ Existe para o Admin VER antes de decidir. Convocar às cegas e descobrir
 * depois quem foi chamado é como se convoca a pessoa errada — e convocação
 * errada gasta a confiança da equipe no portão.
 */
export async function previaDaTurma(
  clinicIds: string[],
  tipo: string
): Promise<{ ok: boolean; error?: string; candidatos?: CandidatoDaUnidade[] }> {
  await requireAdminMaster();
  if (!ehTipoDeTurma(tipo)) return { ok: false, error: "Tipo inválido." };
  if (clinicIds.length === 0) return { ok: true, candidatos: [] };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("training_candidates_multi", {
    p_clinic_ids: clinicIds,
    p_kind: tipo,
  });

  if (error) return { ok: false, error: "Não foi possível montar a prévia." };
  const candidatos = (data ?? []) as CandidatoDaUnidade[];

  // 0412 (AP172): o que dá para aproveitar de outra certificação. Só novatos
  // (D3). Falhar aqui não derruba a prévia: sem a resposta, ninguém ganha a
  // opção e a turma abre com a missão completa, como sempre.
  if (tipo === "novatos" && candidatos.length > 0) {
    const { data: reuso, error: erroDoReuso } = await supabase.rpc("training_reuse_preview", {
      p_clinic_ids: clinicIds,
      p_kind: tipo,
    });
    if (erroDoReuso) {
      console.error("previaDaTurma: aproveitamento indisponível:", erroDoReuso.message);
    } else {
      const porChave = new Map<string, unknown>();
      for (const r of (reuso ?? []) as { user_id: string; role: string; items: unknown }[]) {
        porChave.set(chaveDaConvocacao({ user_id: r.user_id, role: r.role }), r.items);
      }
      for (const c of candidatos) {
        const itens = lerAproveitadas(porChave.get(chaveDaConvocacao(c)));
        if (itens.length > 0) c.aproveitaveis = itens;
      }
    }
  }

  return { ok: true, candidatos };
}

/** Abre UMA turma para as unidades escolhidas e convoca a lista conferida. */
export async function abrirTurma(formData: FormData): Promise<ActionResult> {
  await requireAdminMaster();

  const unidades = [...new Set(formData.getAll("clinic_ids").map(String).filter(Boolean))];
  const tipo = String(formData.get("kind") ?? "");
  const nota = String(formData.get("note") ?? "");
  // Pares "pessoa:função" — a mesma pessoa pode vir com duas funções, e o Admin
  // pode convocar só uma delas.
  const escolhidos = formData.getAll("convocados").map(String).filter(Boolean);
  // 0412 (AP172): pares "pessoa:função" marcados como "só as tarefas
  // diferentes". Só valem para quem também está sendo convocado.
  const reduzidos = formData
    .getAll("reduzidos")
    .map(String)
    .filter((k) => k && escolhidos.includes(k));
  const redeToda = formData.get("whole_network") === "sim";
  // Sem a caixa na tela (turma de novatos) o campo nem é enviado — e o padrão
  // é o único que não pode parar a clínica.
  const politica = String(formData.get("access_policy") ?? "mantem");
  const prazo = String(formData.get("deadline") ?? "").trim();

  if (unidades.length === 0) return { ok: false, error: "Escolha ao menos uma unidade." };
  if (!ehTipoDeTurma(tipo)) return { ok: false, error: "Escolha o tipo de turma." };
  if (!ehPoliticaDeAcesso(politica)) {
    return { ok: false, error: "Política de acesso inválida." };
  }

  // A mesma conferência da tela, refeita aqui: a tela pode ser contornada, e
  // esta é a decisão que TIRA ACESSO de gente ao sistema real.
  const impedimento = oQueImpedeAbrir({
    politica,
    tipo,
    prazo: prazo || null,
    hoje: todayInBrazil(),
  });
  if (impedimento) return { ok: false, error: impedimento };
  if (reduzidos.length > 0 && tipo !== "novatos") {
    return { ok: false, error: "Aproveitar tarefas de outra certificação vale só para turma de novatos." };
  }
  if (escolhidos.length === 0) {
    return {
      ok: false,
      error: "Nenhuma pessoa marcada. Uma turma sem ninguém não convoca nada.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("open_training_campaign", {
    p_clinic_ids: unidades,
    p_kind: tipo,
    p_note: nota || null,
    p_only: escolhidos,
    p_access_policy: politica,
    p_deadline: politica === "prazo" ? prazo : null,
    p_whole_network: redeToda,
    // Só vai quando há escolha: assim a turma abre igual num banco sem a 0412.
    ...(reduzidos.length > 0 ? { p_reduced: reduzidos } : {}),
  });

  if (error) {
    const m = error.message;
    return {
      ok: false,
      error:
        m.includes("NOT_ALLOWED")
          ? "Só o Admin Master abre turmas."
          : m.includes("CAMPAIGN_ALREADY_OPEN")
            ? // Só antes da 0411 chegar a este banco (a trava por unidade saiu).
              "Este banco ainda não recebeu a atualização que permite mais de uma turma por unidade. Encerre a turma atual ou peça para aplicar a atualização."
            : m.includes("UNKNOWN_UNIT")
              ? "Alguma das unidades escolhidas não existe ou foi desativada. Recarregue a tela."
              : m.includes("NO_UNITS")
                ? "Escolha ao menos uma unidade."
                : m.includes("NOBODY_TO_ENROLL")
                  ? "Ninguém foi convocado: as pessoas marcadas já estão numa turma aberta nesta função, ou não entram nesta turma."
                  : m.includes("POLICY_ONLY_FOR_RECYCLING")
                    ? "Suspender acesso só vale para reciclagem."
                    : m.includes("REUSE_ONLY_FOR_NEWCOMERS")
                    ? "Aproveitar tarefas de outra certificação vale só para turma de novatos."
                    : m.includes("DEADLINE_IN_THE_PAST")
                      ? "A data limite precisa ser futura."
                      : m.includes("DEADLINE_REQUIRED")
                        ? "Escolha a data limite da reciclagem."
                        : "Não foi possível abrir a turma.",
    };
  }

  await logAudit({
    action: "create",
    entityType: "training_campaigns",
    details: {
      tipo,
      unidades: unidades.length,
      redeToda,
      convocados: escolhidos.length,
      aproveitando: reduzidos.length,
      politica,
      prazo: prazo || null,
    },
  });

  revalidatePath("/admin/certificacao");
  return { ok: true };
}

/**
 * O PROGRESSO DE UMA UNIDADE DA TURMA, medido na hora em que o Admin abre.
 *
 * ⚠️ POR QUE SOB DEMANDA, E NÃO AO ABRIR A TELA. Uma turma da rede toda com
 * 200 unidades pode ter 2.000 pessoas; com 5 critérios cada, medir tudo ao
 * abrir a tela seriam 10.000 consultas ao banco de treino — a tela não abriria.
 * Medindo uma unidade por vez, quando o Admin a expande, o custo acompanha o
 * que ele de fato quer ver.
 */
export async function medirUnidadeDaTurma(
  campaignId: string,
  clinicId: string
): Promise<{
  ok: boolean;
  error?: string;
  medidas?: Record<string, Medicao>;
  /** 0281: quem cumpriu e foi registrado nesta medição (chave → resultado). */
  concluidas?: Record<string, ResultadoDaConclusao>;
}> {
  await requireAdminMaster();
  const supabase = await createClient();

  const [{ data: matriculas, error }, { data: metas }] = await Promise.all([
    supabase
      .from("training_enrollments")
      .select("id, user_id, role, status, started_at, reused_items, profiles!training_enrollments_user_id_fkey(email)")
      .eq("campaign_id", campaignId)
      .eq("clinic_id", clinicId),
    supabase
      .from("training_requirements")
      .select("role, indicator, minimum_count")
      .returns<MetaDoTreino[]>(),
  ]);
  if (error) return { ok: false, error: "Não foi possível ler as matrículas." };

  const emailDe = (v: unknown): string | null => {
    const o = Array.isArray(v) ? v[0] : v;
    return (o as { email?: string | null } | null)?.email ?? null;
  };

  const lista = (matriculas ?? []).map((m) => ({
    id: String(m.id),
    chave: chaveDaConvocacao({ user_id: String(m.user_id), role: String(m.role) }),
    role: m.role as UserRole,
    status: String(m.status),
    started_at: m.started_at ? String(m.started_at) : null,
    email: emailDe(m.profiles),
    aproveitadas: lerAproveitadas(m.reused_items),
  }));

  const medidas = await medirVarias(lista, async (m) => {
    // Quem não começou não é medido: não há janela de contagem (lei do marco).
    if (m.status !== "em_andamento" || !m.started_at) return { estado: "nao_comecou" };
    if (!m.email) {
      return { estado: "sem_medicao", motivo: "esta pessoa não tem e-mail no cadastro" };
    }
    return medirMatricula({
      email: m.email,
      role: m.role,
      started_at: m.started_at,
      metas: metas ?? [],
      aproveitadas: m.aproveitadas,
    });
  });

  // ⚠️ 0281: MEDIU E CUMPRIU → REGISTRA, igual ao Início. Sem isto, a
  // conclusão de quem não abre o Início dependeria só dessa pessoa voltar.
  const concluidas: Record<string, ResultadoDaConclusao> = {};
  for (const m of lista) {
    if (m.status !== "em_andamento") continue;
    // 0303: o retrato que o painel de acompanhamento lê.
    await guardarProgresso(m.id, medidas.get(m.chave) ?? null);
    const r = await registrarSeCumprida(m.id, medidas.get(m.chave) ?? null);
    if (r) concluidas[m.chave] = r;
  }
  if (Object.keys(concluidas).length > 0) revalidatePath("/admin/certificacao");

  return { ok: true, medidas: Object.fromEntries(medidas), concluidas };
}

/**
 * APROVAR A CONCLUSÃO (0281) — gatilho "aprovação". O banco confere que quem
 * aprova é o Admin Master e que a matrícula está pendente (dois cliques não
 * geram dois certificados).
 */
export async function aprovarConclusoes(
  enrollmentIds: string[]
): Promise<ActionResult & { aprovadas?: number; recusadas?: string[] }> {
  await requireAdminMaster();
  if (enrollmentIds.length === 0) return { ok: false, error: "Nada escolhido para aprovar." };
  const supabase = await createClient();
  let aprovadas = 0;
  const recusadas: string[] = [];
  // Uma por vez, de propósito: cada aprovação grava certificado, porta e
  // aviso; se uma falhar, as outras seguem, e a tela diz quais ficaram.
  for (const id of enrollmentIds) {
    const { error } = await supabase.rpc("approve_training_completion", { p_enrollment_id: id });
    if (error) {
      recusadas.push(id);
      if (!error.message.includes("NOT_PENDING")) {
        console.error("aprovarConclusoes falhou:", error.message);
      }
      continue;
    }
    aprovadas++;
    await logAudit({ action: "update", entityType: "training_enrollments", entityId: id, details: { aprovada: true } });
  }
  revalidatePath("/admin/certificacao");
  revalidatePath("/", "layout");
  if (aprovadas === 0) {
    return { ok: false, error: "Nenhuma aprovação foi registrada (talvez já tivessem sido aprovadas).", recusadas };
  }
  return { ok: true, aprovadas, recusadas };
}

/**
 * DISPENSAR UMA PESSOA DA TURMA (0411, relato OC-00015) — afastamento,
 * licença, ou quem saiu e o cadastro ainda não refletiu. Dispensada, ela deixa
 * de segurar a unidade na liberação coletiva. Quem é desligado ou perde a
 * função na unidade já é dispensado sozinho pelo banco; o botão é para o resto.
 */
export async function dispensarMatricula(
  enrollmentId: string,
  motivo: string
): Promise<ActionResult> {
  await requireAdminMaster();
  const texto = motivo.trim();
  if (!texto) return { ok: false, error: "Escreva o motivo da dispensa." };
  if (texto.length > 300) return { ok: false, error: "Motivo longo demais (até 300 letras)." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("dismiss_training_enrollment", {
    p_enrollment_id: enrollmentId,
    p_reason: texto,
  });

  if (error) {
    const m = error.message;
    return {
      ok: false,
      error: m.includes("NOT_ALLOWED")
        ? "Só o Admin Master dispensa da turma."
        : m.includes("NOT_DISMISSABLE")
          ? "Esta pessoa já concluiu ou já foi dispensada, ou a turma foi encerrada."
          : m.includes("ENROLLMENT_NOT_FOUND")
            ? "Matrícula não encontrada. Recarregue a tela."
            : m.includes("dismiss_training_enrollment")
              ? "Este banco ainda não recebeu a atualização da dispensa. Peça para aplicar a atualização."
              : "Não foi possível dispensar agora.",
    };
  }

  await logAudit({
    action: "update",
    entityType: "training_enrollments",
    entityId: enrollmentId,
    details: { dispensada: true },
  });

  revalidatePath("/admin/certificacao");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Encerra a turma. Não apaga nada: matrícula e certificado continuam. */
export async function encerrarTurma(id: string): Promise<ActionResult> {
  await requireAdminMaster();
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_training_campaign", { p_id: id });

  if (error) {
    return {
      ok: false,
      error:
        error.message === "NOT_ALLOWED"
          ? "Só o Admin Master encerra turmas."
          : "Não foi possível encerrar a turma.",
    };
  }

  await logAudit({ action: "update", entityType: "training_campaigns", entityId: id });
  revalidatePath("/admin/certificacao");
  return { ok: true };
}
