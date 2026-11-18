"use server";

/**
 * ASA7 (4022, spec 21.2 e 21.7) — as ações das peças que preparam o piloto:
 * as marcas da prontidão (débito e permissões da chave), a sonda da chave, o
 * levantamento, o interruptor de produção com a prontidão da rede, a cópia de
 * outra unidade e a conciliação das cobranças.
 */
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { levantarConta, sondarChave } from "@/lib/asaas/pecas-do-piloto";

export type Resultado = { ok: boolean; error?: string; aviso?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SO_ADMIN = "Só o Admin Master faz isto.";
const SEM_SERVIDOR = "O servidor não está configurado para falar com o Asaas.";

const MENSAGENS: Record<string, string> = {
  NOT_ALLOWED: "Você não tem permissão para esta ação.",
  ACCOUNT_NOT_FOUND: "Conta não encontrada.",
  REASON_REQUIRED: "Escreva o motivo (pelo menos 5 letras).",
  PROOF_REQUIRED: "Anexe o documento antes de gravar.",
  NETWORK_NOT_READY: "A prontidão da rede não está completa.",
  ISSUE_NOT_OPEN: "Esta divergência já não está aberta.",
  INVALID_UNITS: "Escolha duas unidades diferentes.",
  INVALID_BLOCKS: "Escolha o que copiar.",
};
function mensagem(error: { message?: string } | null | undefined): string {
  const m = error?.message ?? "";
  for (const [k, v] of Object.entries(MENSAGENS)) if (m.includes(k)) return k === "NETWORK_NOT_READY" ? `${v} Falta: ${m.split("NETWORK_NOT_READY:")[1]?.trim() ?? ""}` : v;
  return "Não foi possível concluir.";
}
const atualizar = () => revalidatePath("/central", "layout");

async function contaVisivel(accountId: string) {
  if (!UUID.test(accountId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("gateway_accounts").select("id, clinic_id, environment, status").eq("id", accountId)
    .maybeSingle<{ id: string; clinic_id: string | null; environment: string; status: string }>();
  return data ?? null;
}

// ---- a prontidão da unidade --------------------------------------------------------------

export async function declararDebitoDesabilitado(accountId: string): Promise<Resultado> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: SO_ADMIN };
  if (!(await contaVisivel(accountId))) return { ok: false, error: MENSAGENS.ACCOUNT_NOT_FOUND };
  const supabase = await createClient();
  const { error } = await supabase.rpc("gateway_declare_debit_disabled", { p_account_id: accountId });
  if (error) return { ok: false, error: mensagem(error) };
  atualizar();
  return { ok: true };
}

export async function declararPermissoesDaChave(accountId: string): Promise<Resultado> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: SO_ADMIN };
  const conta = await contaVisivel(accountId);
  if (!conta) return { ok: false, error: MENSAGENS.ACCOUNT_NOT_FOUND };
  const supabase = await createClient();
  const { error } = await supabase.rpc("gateway_declare_key_permissions", { p_account_id: accountId });
  if (error) return { ok: false, error: mensagem(error) };
  // A marca sozinha não basta: o riSZon confere a chave em seguida.
  const r = await sondarChaveAgora(accountId);
  atualizar();
  return r.ok ? { ok: true } : { ok: true, aviso: r.error };
}

/** Pede ao Asaas, só com leituras, o que a chave mínima não pode ler; as três têm de ser recusadas. */
export async function sondarChaveAgora(accountId: string): Promise<Resultado> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: SO_ADMIN };
  const conta = await contaVisivel(accountId);
  if (!conta) return { ok: false, error: MENSAGENS.ACCOUNT_NOT_FOUND };
  if (conta.status !== "active") return { ok: false, error: "Grave e valide a chave antes de conferir." };
  if (!isAdminClientConfigured()) return { ok: false, error: SEM_SERVIDOR };
  try {
    const r = await sondarChave(accountId, session.userId);
    atualizar();
    if (r.ok) return { ok: true };
    const respondeu = Object.entries(r.detalhe).filter(([, v]) => v === "respondeu").map(([k]) => k);
    if (respondeu.length) return { ok: false, error: `A chave tem permissão demais: o Asaas respondeu a ${respondeu.join(", ")}. Crie uma chave com as permissões mínimas.` };
    return { ok: false, error: "Não deu para conferir a chave agora (o Asaas não respondeu como esperado). Tente de novo." };
  } catch {
    return { ok: false, error: "Não deu para conferir a chave agora. Tente de novo." };
  }
}

export async function levantarAgora(accountId: string): Promise<Resultado> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: SO_ADMIN };
  const conta = await contaVisivel(accountId);
  if (!conta) return { ok: false, error: MENSAGENS.ACCOUNT_NOT_FOUND };
  if (conta.status !== "active") return { ok: false, error: "Grave e valide a chave antes do levantamento." };
  if (!isAdminClientConfigured()) return { ok: false, error: SEM_SERVIDOR };
  const r = await levantarConta(accountId, session.userId);
  atualizar();
  return r.ok ? { ok: true } : { ok: false, error: r.erro };
}

export type Levantamento = {
  id: string; em: string; por: string | null; ok: boolean; cobrancas: number; cobrancas_cents: number;
  parcelamentos: number; assinaturas: number; erro: string | null;
  amostra: { id: string; vencimento: string | null; valor: number | null; situacao: string | null; forma: string | null }[];
};

export async function lerLevantamentos(accountId: string): Promise<Levantamento[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gateway_surveys_read", { p_account_id: accountId });
  if (error) return [];
  return (data ?? []) as Levantamento[];
}

// ---- o interruptor e a prontidão da rede ---------------------------------------------------

export type Producao = {
  ligada: boolean; mudou_em: string | null; mudou_por: string | null; motivo: string | null; pode_mudar: boolean;
  prontidao: { item: string; ok: boolean; detalhe: Record<string, unknown> }[];
  migracoes: { codigo: string; nome: string; na_producao: boolean }[];
};

export async function lerProducao(): Promise<Producao | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gateway_production_read");
  if (error) return null;
  return data as Producao;
}

export async function ligarProducao(ligar: boolean, motivo: string): Promise<Resultado> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: SO_ADMIN };
  const supabase = await createClient();
  const { error } = await supabase.rpc("gateway_production_switch", { p_on: ligar, p_reason: motivo });
  if (error) return { ok: false, error: mensagem(error) };
  atualizar();
  return { ok: true };
}

/** O documento do Asaas (PDF ou imagem) vai para a pasta privada `asaas-rede`. */
export async function anexarConfirmacaoDoAsaas(formData: FormData): Promise<Resultado> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: SO_ADMIN };
  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { ok: false, error: MENSAGENS.PROOF_REQUIRED };
  if (arquivo.size > 10 * 1024 * 1024) return { ok: false, error: "O arquivo passa de 10 MB." };
  if (!["application/pdf", "image/png", "image/jpeg"].includes(arquivo.type)) return { ok: false, error: "Use PDF, PNG ou JPG." };
  if (!isAdminClientConfigured()) return { ok: false, error: SEM_SERVIDOR };
  const ext = arquivo.type === "application/pdf" ? "pdf" : arquivo.type === "image/png" ? "png" : "jpg";
  const caminho = `confirmacao-uso-da-chave/${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}.${ext}`;
  const admin = createAdminClient();
  const up = await admin.storage.from("asaas-rede").upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
  if (up.error) return { ok: false, error: "Não foi possível guardar o arquivo." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("gateway_asaas_confirmation_save", { p_path: caminho, p_name: arquivo.name.slice(0, 200) });
  if (error) return { ok: false, error: mensagem(error) };
  atualizar();
  return { ok: true };
}

// ---- copiar de outra unidade ----------------------------------------------------------------

export async function previaDaCopia(destino: string, origem: string): Promise<{ ok: true; previa: Record<string, unknown> } | { ok: false; error: string }> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: SO_ADMIN };
  if (!UUID.test(destino) || !UUID.test(origem)) return { ok: false, error: MENSAGENS.INVALID_UNITS };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("central_copy_preview", { p_target: destino, p_source: origem });
  if (error) return { ok: false, error: mensagem(error) };
  return { ok: true, previa: data as Record<string, unknown> };
}

export async function copiarDeOutraUnidade(destino: string, origem: string, blocos: string[]): Promise<Resultado> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: SO_ADMIN };
  if (!UUID.test(destino) || !UUID.test(origem)) return { ok: false, error: MENSAGENS.INVALID_UNITS };
  const supabase = await createClient();
  const { error } = await supabase.rpc("central_copy_apply", { p_target: destino, p_source: origem, p_blocks: blocos });
  if (error) return { ok: false, error: mensagem(error) };
  atualizar();
  return { ok: true };
}

// ---- a conciliação das cobranças ------------------------------------------------------------

export type DivergenciaComOAsaas = {
  id: string; tipo: string; status: "aberta" | "ignorada"; clinica: string | null; clinic_id: string | null;
  cobranca: string | null; asaas: string | null; valor: number | null; detalhe: Record<string, unknown>;
  desde: string; visto: string; ignorada_em: string | null; ignorada_por: string | null; motivo: string | null; cliente: string | null;
};
export type LeituraDasDivergencias = {
  pode_ignorar: boolean;
  divergencias: DivergenciaComOAsaas[];
  rodadas: { conta: string; tipo: string; em: string; conferidas: number; chamadas: number; novas: number; abertas: number; erro: string | null }[];
};

export async function lerDivergenciasComOAsaas(clinicId: string | null): Promise<LeituraDasDivergencias | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gateway_charge_issues_read", { p_clinic_id: clinicId });
  if (error) return null;
  return data as LeituraDasDivergencias;
}

export async function ignorarDivergenciaComOAsaas(id: string, motivo: string): Promise<Resultado> {
  if (!UUID.test(id)) return { ok: false, error: "Divergência inválida." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("gateway_charge_issue_ignore", { p_issue_id: id, p_reason: motivo });
  if (error) return { ok: false, error: mensagem(error) };
  revalidatePath("/financeiro/cobrancas");
  return { ok: true };
}
