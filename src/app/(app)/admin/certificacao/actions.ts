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
  type CandidatoDaUnidade,
  type Medicao,
  type MetaDoTreino,
} from "@/lib/certificacao";
import { medirMatricula, medirVarias } from "@/lib/certificacao-servidor";
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
  return { ok: true, candidatos: (data ?? []) as CandidatoDaUnidade[] };
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
  });

  if (error) {
    const m = error.message;
    return {
      ok: false,
      error:
        m.includes("NOT_ALLOWED")
          ? "Só o Admin Master abre turmas."
          : m.includes("CAMPAIGN_ALREADY_OPEN")
            ? "Alguma das unidades escolhidas já tem uma turma aberta. Encerre a atual ou tire a unidade da seleção."
            : m.includes("UNKNOWN_UNIT")
              ? "Alguma das unidades escolhidas não existe ou foi desativada. Recarregue a tela."
              : m.includes("NO_UNITS")
                ? "Escolha ao menos uma unidade."
                : m.includes("NOBODY_TO_ENROLL")
                  ? "Ninguém foi convocado: nenhuma das pessoas marcadas entra nesta turma."
                  : m.includes("POLICY_ONLY_FOR_RECYCLING")
                    ? "Suspender acesso só vale para reciclagem."
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
): Promise<{ ok: boolean; error?: string; medidas?: Record<string, Medicao> }> {
  await requireAdminMaster();
  const supabase = await createClient();

  const [{ data: matriculas, error }, { data: metas }] = await Promise.all([
    supabase
      .from("training_enrollments")
      .select("user_id, role, status, started_at, profiles(email)")
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
    chave: chaveDaConvocacao({ user_id: String(m.user_id), role: String(m.role) }),
    role: m.role as UserRole,
    status: String(m.status),
    started_at: m.started_at ? String(m.started_at) : null,
    email: emailDe(m.profiles),
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
    });
  });

  return { ok: true, medidas: Object.fromEntries(medidas) };
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
