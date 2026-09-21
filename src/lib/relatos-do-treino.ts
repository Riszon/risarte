import "server-only";
import { clienteDoTreino, treinoConfigurado } from "@/lib/treino";
import { isTreino } from "@/lib/environment";
import {
  COLUNAS_DO_RELATO,
  carregarAnexos,
  carregarConversa,
  carregarRelatos,
  montarRelato,
  reporterDoRelato,
  type RelatoBruto,
} from "@/app/(app)/problemas/dados";
import type { Relato } from "@/lib/system-reports";

/**
 * OS RELATOS DO TREINO, VISTOS DO SISTEMA REAL (19/09/2026, decisão do dono).
 *
 * O dono quis uma visão única: *"relatar problema deve ser independente se o
 * usuário está em um ambiente de teste ou real"*. O relato continua nascendo
 * onde a pessoa está — inclusive no treino, com a captura de tela funcionando —
 * e a LISTA junta mora aqui, no sistema real.
 *
 * ⚠️ POR QUE A VISÃO JUNTA SÓ EXISTE DE UM LADO. A produção tem a chave do
 * treino (é assim que a cópia dos Risartanos funciona); o treino NÃO tem a da
 * produção, de propósito — é um ambiente aberto ao aprendizado, e uma chave da
 * produção lá dentro valeria mais que qualquer conveniência. Por isso quem
 * consolida é sempre a produção.
 *
 * ⚠️ AQUI NÃO HÁ RLS. A leitura usa a chave de serviço do treino, que passa por
 * cima de qualquer política — então a régua de quem vê o quê é aplicada NESTE
 * arquivo, e é a mesma da RLS de lá: o Admin Master vê tudo; cada pessoa vê os
 * relatos que ela mesma fez. Nada de terceiro sai daqui.
 */

/** A pessoa da produção, do outro lado da ponte. */
async function idNoTreino(prodUserId: string): Promise<string | null> {
  const treino = clienteDoTreino();
  if (!treino) return null;
  const { data } = await treino
    .from("mirror_user_map")
    .select("local_id")
    .eq("source_id", prodUserId)
    .maybeSingle<{ local_id: string }>();
  return data?.local_id ?? null;
}

export function podeOlharOTreino(): boolean {
  return !isTreino() && treinoConfigurado();
}

export type RelatosDoTreino = {
  relatos: Relato[];
  /** Não deu para olhar o treino (chave, rede, migração): a tela avisa. */
  aviso?: string;
};

/**
 * Lê os relatos do treino já no formato da tela — mesma consulta e mesmo
 * montador da lista do sistema real, para as duas listas não divergirem.
 */
export async function carregarRelatosDoTreino(entrada: {
  prodUserId: string;
  isAdminMaster: boolean;
  endereco: string | null;
  code?: string;
}): Promise<RelatosDoTreino> {
  if (!podeOlharOTreino()) return { relatos: [] };
  const treino = clienteDoTreino();
  if (!treino) return { relatos: [] };

  const meuIdLa = await idNoTreino(entrada.prodUserId);
  // Sem ponte, a pessoa não tem relato lá — e, sem ser Admin, não há o que ver.
  if (!entrada.isAdminMaster && !meuIdLa) return { relatos: [] };

  let q = treino
    .from("system_reports")
    .select(COLUNAS_DO_RELATO.completo)
    .order("created_at", { ascending: false })
    .limit(500);
  if (entrada.code) q = q.eq("code", entrada.code);
  // A régua da RLS de lá, aplicada aqui: sem ser Admin, só o que é seu.
  if (!entrada.isAdminMaster && meuIdLa) q = q.eq("reporter_id", meuIdLa);

  const { data, error } = await q;
  if (error) {
    console.error("relatos do treino:", error.code);
    return {
      relatos: [],
      aviso:
        "Não foi possível ler os relatos do ambiente de treino agora. A lista mostra só os do sistema.",
    };
  }

  const base = (entrada.endereco ?? "").replace(/\/+$/, "");
  return {
    relatos: (data as unknown as RelatoBruto[]).map((r) =>
      // `meu` compara com o id DE LÁ — os ids são de bancos diferentes.
      montarRelato(r, meuIdLa ?? "", "treino", base)
    ),
  };
}

/** Quantos relatos do treino esperam o suporte (para o número da boia). */
export async function pendentesNoTreino(entrada: {
  prodUserId: string;
  isAdminMaster: boolean;
}): Promise<number> {
  if (!podeOlharOTreino()) return 0;
  const treino = clienteDoTreino();
  if (!treino) return 0;

  if (entrada.isAdminMaster) {
    const { count, error } = await treino
      .from("system_reports")
      .select("*", { head: true, count: "exact" })
      .in("status", ["aberto", "em_analise"]);
    if (error) {
      console.error("pendentes no treino (admin):", error.code);
      return 0;
    }
    return count ?? 0;
  }

  // Para quem relatou, o número é "respostas que você ainda não leu".
  const meuIdLa = await idNoTreino(entrada.prodUserId);
  if (!meuIdLa) return 0;
  const { count, error } = await treino
    .from("system_reports")
    .select("*", { head: true, count: "exact" })
    .eq("reporter_id", meuIdLa)
    .not("answer", "is", null)
    .is("reporter_seen_answer_at", null);
  if (error) {
    console.error("pendentes no treino (relator):", error.code);
    return 0;
  }
  return count ?? 0;
}

// -----------------------------------------------------------------------------
// UM relato do treino, aberto DENTRO do sistema real
// -----------------------------------------------------------------------------

/**
 * O mesmo relato, a mesma tela: o detalhe do sistema real sabe abrir um relato
 * que vive no banco do treino. As consultas são as MESMAS da tela normal —
 * muda só o cliente (o do treino) e os ids (os de lá).
 *
 * A régua de quem vê é aplicada aqui, porque a chave de serviço não tem RLS:
 * Admin Master vê qualquer um; as demais pessoas, só o que relataram.
 */
export async function carregarRelatoDoTreinoPorCodigo(entrada: {
  code: string;
  prodUserId: string;
  isAdminMaster: boolean;
  endereco: string | null;
}): Promise<{
  relato: Relato;
  conversa: Awaited<ReturnType<typeof carregarConversa>>;
  anexos: Awaited<ReturnType<typeof carregarAnexos>>;
  /** O id de quem relatou, NO BANCO DO TREINO. */
  reporterId: string | null;
} | null> {
  if (!podeOlharOTreino()) return null;
  const treino = clienteDoTreino();
  if (!treino) return null;

  const meuIdLa = await idNoTreino(entrada.prodUserId);
  const base = (entrada.endereco ?? "").replace(/\/+$/, "");
  const { relatos } = await carregarRelatos(treino, meuIdLa ?? "", {
    code: entrada.code,
    origem: { ambiente: "treino", base },
  });
  const relato = relatos[0];
  if (!relato) return null;
  // Não é seu e você não é Admin: para esta pessoa, ele não existe.
  if (!entrada.isAdminMaster && !relato.meu) return null;

  const reporterId = await reporterDoRelato(treino, relato.id);
  const [conversa, anexos] = await Promise.all([
    carregarConversa(treino, relato, reporterId),
    carregarAnexos(treino, relato, {
      userId: meuIdLa ?? "",
      isAdminMaster: entrada.isAdminMaster,
      reporterId,
    }),
  ]);
  return { relato, conversa, anexos, reporterId };
}

/**
 * A RESPOSTA DO ADMIN ATRAVESSANDO (0264). Quem grava é a chave de serviço do
 * treino, dizendo QUEM está respondendo — e o banco de lá confere que esse
 * alguém é Admin Master lá dentro. As regras (encerrar exige resposta, nada
 * para salvar) continuam num lugar só, no banco.
 */
export async function responderNoTreino(entrada: {
  reportId: string;
  status: string;
  answer: string | null;
  resolvedVersion: string | null;
  prodAdminId: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!podeOlharOTreino()) {
    return { ok: false, error: "O ambiente de treino não está ligado neste servidor." };
  }
  const treino = clienteDoTreino();
  if (!treino) {
    return { ok: false, error: "O ambiente de treino não está ligado neste servidor." };
  }
  const autor = await idNoTreino(entrada.prodAdminId);
  if (!autor) {
    return {
      ok: false,
      error: "Seu login ainda não existe no ambiente de treino. Sincronize o treino e tente de novo.",
    };
  }

  const { error } = await treino.rpc("answer_system_report_como", {
    p_report_id: entrada.reportId,
    p_status: entrada.status,
    p_answer: entrada.answer,
    p_resolved_version: entrada.resolvedVersion,
    p_autor: autor,
  });
  if (!error) return { ok: true };

  if (error.message.includes("ANSWER_REQUIRED")) {
    return { ok: false, error: "Escreva a resposta antes de encerrar — quem relatou vai lê-la." };
  }
  if (error.message.includes("NOTHING_TO_SAVE")) {
    return { ok: false, error: "Escreva uma resposta ou mude a situação — não havia nada para salvar." };
  }
  if (error.code === "PGRST202") {
    return { ok: false, error: "O banco do treino ainda não recebeu a migração 0264." };
  }
  console.error("responder no treino:", error.code);
  return { ok: false, error: "Não foi possível salvar no ambiente de treino agora." };
}
