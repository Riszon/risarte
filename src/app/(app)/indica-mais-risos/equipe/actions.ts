"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { indicaDb } from "@/lib/indica/db";
import { canViewIndica, ehGestorIndica } from "@/lib/indica/access";
import { mensagemDoBanco } from "@/lib/indica/erros";
import { METRICAS, validarFaixas, type Faixa, type Metrica } from "@/lib/indica/metas";

type Resultado = { ok: true } | { ok: false; error: string };
const SEM_PERMISSAO = "Você não tem permissão para o Indica +Risos.";
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export type DadosMeta = {
  unidadeId: string;
  periodoTipo: "mes" | "trimestre" | "campanha";
  inicio: string;
  fim: string;
  metrica: Metrica;
  campanhaId: string;
  trava: string;
  faixas: Faixa[];
};

/** Cria a meta coletiva da unidade (já ativa). Quem pode: o gestor (RLS). */
export async function criarMeta(d: DadosMeta): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };
  if (!ehGestorIndica(session, d.unidadeId)) return { ok: false, error: "Meta é do gestor da unidade." };
  if (!DATA.test(d.inicio) || !DATA.test(d.fim) || d.fim < d.inicio) {
    return { ok: false, error: "Período inválido: o fim precisa ser igual ou depois do começo." };
  }
  if (!METRICAS.includes(d.metrica)) return { ok: false, error: "Escolha a métrica." };
  if (d.periodoTipo === "campanha" && !d.campanhaId) return { ok: false, error: "Escolha a campanha da meta." };
  const travaTxt = d.trava.trim().replace(",", ".");
  const trava = travaTxt === "" ? null : Number(travaTxt);
  if (trava !== null && !(Number.isFinite(trava) && trava >= 0 && trava <= 100)) {
    return { ok: false, error: "Trava de qualidade: percentual de 0 a 100 (vazio = sem trava)." };
  }
  const erro = validarFaixas(d.faixas);
  if (erro) return { ok: false, error: erro };

  const db = await indicaDb();
  const { data, error } = await db
    .from("metas_equipe")
    .insert({
      unidade_id: d.unidadeId,
      campanha_id: d.campanhaId || null,
      periodo_tipo: d.periodoTipo,
      periodo_inicio: d.inicio,
      periodo_fim: d.fim,
      metrica: d.metrica,
      faixas: d.faixas.map((f) => ({ ...f, nome: f.nome.trim() })),
      trava_qualidade_comparecimento: trava,
      status: "ativa",
      criado_por: session.userId,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error || !data) {
    if (error) console.error("metas_equipe:", error.message);
    return { ok: false, error: error ? mensagemDoBanco(error) : "Você não pode criar meta nesta unidade." };
  }
  await logAudit({ action: "create", entityType: "indica_meta", entityId: data.id, clinicId: d.unidadeId });
  revalidatePath("/indica-mais-risos/equipe");
  return { ok: true };
}

export async function encerrarMeta(id: string): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };
  const db = await indicaDb();
  const { data, error } = await db
    .from("metas_equipe")
    .update({ status: "encerrada", atualizado_em: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("metas_equipe:", error.message);
    return { ok: false, error: error ? mensagemDoBanco(error) : "Meta é do gestor da unidade." };
  }
  await logAudit({ action: "update", entityType: "indica_meta", entityId: id, details: { status: "encerrada" } });
  revalidatePath("/indica-mais-risos/equipe");
  return { ok: true };
}

export async function apurarMeta(id: string, tipo: "provisoria" | "final"): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };
  const db = await indicaDb();
  const { error } = await db.rpc("apurar_meta", { p_meta_id: id, p_tipo: tipo });
  if (error) {
    console.error("apurar_meta:", error.message);
    if (error.code === "23505") return { ok: false, error: "Esta meta já tem apuração final (reprove-a para refazer)." };
    return { ok: false, error: mensagemDoBanco(error) };
  }
  await logAudit({ action: "create", entityType: "indica_apuracao", entityId: id, details: { tipo } });
  revalidatePath("/indica-mais-risos/equipe");
  return { ok: true };
}

export async function aprovarApuracao(id: string, aprovar: boolean, motivo?: string): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };
  const db = await indicaDb();
  const { error } = await db.rpc("aprovar_apuracao", { p_id: id, p_aprovar: aprovar, p_motivo: motivo ?? null });
  if (error) {
    console.error("aprovar_apuracao:", error.message);
    return { ok: false, error: mensagemDoBanco(error) };
  }
  revalidatePath("/indica-mais-risos/equipe");
  revalidatePath(`/indica-mais-risos/equipe/apuracao/${id}`);
  return { ok: true };
}
