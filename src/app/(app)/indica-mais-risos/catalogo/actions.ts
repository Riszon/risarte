"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { indicaDb } from "@/lib/indica/db";
import { canViewIndica } from "@/lib/indica/access";
import { mensagemDoBanco } from "@/lib/indica/erros";
import { ITEM_TIPOS, PARCEIRO_TIPOS, type ItemTipo, type ParceiroTipo } from "@/lib/indica/rotulos";
import { parseBRLToCents } from "@/lib/pricing";

type Resultado = { ok: true } | { ok: false; error: string };
const SEM_PERMISSAO = "Você não tem permissão para o Indica +Risos.";

/**
 * Cadastra ou altera um item do catálogo. Quem pode, a RLS decide: item da
 * rede (sem unidade) = franqueadora; item de unidade = gestor de todas elas.
 */
export async function salvarItem(formData: FormData, id?: string): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };

  const campo = (n: string) => String(formData.get(n) ?? "").trim();
  const tipo = campo("tipo") as ItemTipo;
  if (!ITEM_TIPOS.includes(tipo)) return { ok: false, error: "Escolha o tipo do item." };
  const nome = campo("nome");
  if (!nome) return { ok: false, error: "Informe o nome do item." };
  const custo = Number(campo("custo_riso_coins"));
  if (!Number.isInteger(custo) || custo <= 0) {
    return { ok: false, error: "O custo em Riso Coins precisa ser um número inteiro maior que zero." };
  }
  const valor = campo("valor") ? parseBRLToCents(campo("valor")) : null;
  if (campo("valor") && valor === null) return { ok: false, error: "Valor em reais inválido." };
  if (tipo === "credito_risarte" && !valor) {
    return { ok: false, error: "Crédito Risarte precisa do valor em reais (é o valor do voucher)." };
  }
  const estoque = campo("estoque") === "" ? null : Number(campo("estoque"));
  if (estoque !== null && (!Number.isInteger(estoque) || estoque < 0)) {
    return { ok: false, error: "Estoque inválido (deixe em branco para ilimitado)." };
  }
  const unidades = formData.getAll("unidades").map(String).filter(Boolean);

  const linha = {
    tipo,
    nome,
    descricao: campo("descricao") || null,
    custo_riso_coins: custo,
    valor_centavos: valor,
    parceiro_id: campo("parceiro_id") || null,
    estoque,
    unidades,
    nivel_minimo_id: campo("nivel_minimo_id") || null,
    ativo: formData.get("ativo") === "on",
  };

  const db = await indicaDb();
  const { data, error } = id
    ? await db.from("catalogo_itens").update(linha).eq("id", id).select("id").maybeSingle()
    : await db
        .from("catalogo_itens")
        .insert({ ...linha, criado_por: session.userId })
        .select("id")
        .maybeSingle();
  if (error || !data) {
    if (error) console.error("catalogo_itens:", error.message);
    return {
      ok: false,
      error: error ? mensagemDoBanco(error) : "Você não pode alterar este item.",
    };
  }
  await logAudit({
    action: id ? "update" : "create",
    entityType: "indica_catalogo_item",
    entityId: (data as { id: string }).id,
  });
  revalidatePath("/indica-mais-risos/catalogo");
  return { ok: true };
}

export async function salvarParceiro(formData: FormData, id?: string): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };
  const campo = (n: string) => String(formData.get(n) ?? "").trim();
  const tipo = campo("tipo") as ParceiroTipo;
  if (!PARCEIRO_TIPOS.includes(tipo)) return { ok: false, error: "Escolha o tipo do parceiro." };
  const nome = campo("nome");
  if (!nome) return { ok: false, error: "Informe o nome do parceiro." };
  const codigo = campo("codigo").toUpperCase() || null;
  if (codigo && !/^[A-Z0-9-]{3,20}$/.test(codigo)) {
    return { ok: false, error: "Código do parceiro: letras, números e hífen (3 a 20)." };
  }
  const linha = {
    nome,
    tipo,
    contato: campo("contato") || null,
    codigo,
    unidade_id: campo("unidade_id") || null,
    ativo: formData.get("ativo") === "on",
  };
  const db = await indicaDb();
  const { data, error } = id
    ? await db.from("parceiros").update(linha).eq("id", id).select("id").maybeSingle()
    : await db
        .from("parceiros")
        .insert({ ...linha, criado_por: session.userId })
        .select("id")
        .maybeSingle();
  if (error || !data) {
    if (error) console.error("parceiros:", error.message);
    if (error?.code === "23505") return { ok: false, error: "Já existe um parceiro com este código." };
    return { ok: false, error: error ? mensagemDoBanco(error) : "Você não pode alterar este parceiro." };
  }
  await logAudit({
    action: id ? "update" : "create",
    entityType: "indica_parceiro",
    entityId: (data as { id: string }).id,
  });
  revalidatePath("/indica-mais-risos/catalogo");
  return { ok: true };
}
