"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { indicaDb } from "@/lib/indica/db";
import { canViewIndica } from "@/lib/indica/access";
import { mensagemDoBanco } from "@/lib/indica/erros";

type Resultado = { ok: true } | { ok: false; error: string };
const SEM_PERMISSAO = "Você não tem permissão para o Indica +Risos.";

/** Converte o texto da tela no tipo do padrão da rede (número, sim/não ou texto). */
function paraJson(texto: string, tipoDoPadrao: string): unknown | undefined {
  const t = texto.trim();
  if (tipoDoPadrao === "number") {
    const n = Number(t.replace(",", "."));
    return t !== "" && Number.isFinite(n) ? n : undefined;
  }
  if (tipoDoPadrao === "boolean") return t === "true" ? true : t === "false" ? false : undefined;
  return t === "" ? undefined : t;
}

/**
 * Grava uma NOVA versão de um parâmetro (a anterior fica no histórico).
 *
 * `unidadeId` nulo = padrão da rede (franqueadora; pode travar e definir a
 * faixa). Com unidade = o gestor dela, dentro da faixa — quem confere é o banco
 * (`config_confere_unidade` + RLS).
 */
export async function salvarParametro(dados: {
  chave: string;
  unidadeId: string | null;
  valor: string;
  tipoDoPadrao: string;
  grupo: string;
  descricao: string | null;
  min?: string;
  max?: string;
  travado?: boolean;
}): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };
  const valor = paraJson(dados.valor, dados.tipoDoPadrao);
  if (valor === undefined) return { ok: false, error: "Valor inválido para este parâmetro." };

  const numeroOuNulo = (s?: string) => {
    if (s === undefined || s.trim() === "") return null;
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  };
  const min = dados.unidadeId ? null : numeroOuNulo(dados.min);
  const max = dados.unidadeId ? null : numeroOuNulo(dados.max);
  if (Number.isNaN(min) || Number.isNaN(max)) return { ok: false, error: "Faixa inválida." };
  if (min !== null && max !== null && min > max) {
    return { ok: false, error: "O mínimo da faixa não pode passar do máximo." };
  }
  if (typeof valor === "number" && !dados.unidadeId) {
    if ((min !== null && valor < min) || (max !== null && valor > max)) {
      return { ok: false, error: "O padrão da rede precisa ficar dentro da faixa." };
    }
  }

  const db = await indicaDb();
  const { error } = await db.from("config").insert({
    escopo: dados.unidadeId ? "unidade" : "rede",
    unidade_id: dados.unidadeId,
    grupo: dados.grupo,
    chave: dados.chave,
    valor,
    min,
    max,
    travado: dados.unidadeId ? false : Boolean(dados.travado),
    descricao: dados.descricao,
    atualizado_por: session.userId,
  });
  if (error) {
    console.error("config:", error.message);
    return { ok: false, error: mensagemDoBanco(error) };
  }
  await logAudit({
    action: "update",
    entityType: "indica_config",
    entityId: dados.chave,
    clinicId: dados.unidadeId ?? undefined,
    details: { escopo: dados.unidadeId ? "unidade" : "rede" },
  });
  revalidatePath("/indica-mais-risos/configuracoes");
  return { ok: true };
}

export async function salvarNivel(
  id: string,
  dados: { nome: string; criterio: number; multiplicador: number; beneficios: string; ativo: boolean }
): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };
  if (!dados.nome.trim()) return { ok: false, error: "Informe o nome do nível." };
  if (!Number.isInteger(dados.criterio) || dados.criterio < 0) {
    return { ok: false, error: "Critério: número inteiro de fechamentos (0 ou mais)." };
  }
  if (!(dados.multiplicador > 0 && dados.multiplicador <= 9.99)) {
    return { ok: false, error: "Multiplicador entre 0,01 e 9,99." };
  }
  const db = await indicaDb();
  const { data, error } = await db
    .from("niveis")
    .update({
      nome: dados.nome.trim(),
      criterio_conversoes: dados.criterio,
      multiplicador: dados.multiplicador,
      beneficios: dados.beneficios.trim() || null,
      ativo: dados.ativo,
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("niveis:", error.message);
    return { ok: false, error: error ? mensagemDoBanco(error) : "Só a franqueadora altera os níveis." };
  }
  await logAudit({ action: "update", entityType: "indica_nivel", entityId: id });
  revalidatePath("/indica-mais-risos/configuracoes");
  return { ok: true };
}
