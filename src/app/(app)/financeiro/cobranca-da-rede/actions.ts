"use server";

/**
 * ASA6 (4021, spec 20 e 20.15): a COBRANÇA MENSAL DA REDE às unidades.
 *
 * Quem decide é o BANCO (cada função confere o papel de novo): o Financeiro da
 * Franqueadora e o Admin Master abrem, decidem, aprovam e emitem; o Gerente e o
 * franqueado conferem e contestam a da própria unidade. A emissão e o
 * cancelamento no Asaas saem daqui, pela conta da franqueadora.
 */
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitirCobrancaMensal } from "@/lib/asaas/cobranca-mensal";
import { cancelarNoAsaas } from "@/lib/asaas/cobranca";

type Resultado = { ok: true; aviso?: string } | { ok: false; error: string };

const CAMINHO = "/financeiro/cobranca-da-rede";

const mensagem = (m: string): string => {
  if (m.includes("NOT_ALLOWED")) return "Sua função não permite esta ação.";
  if (m.includes("REASON_REQUIRED")) return "Escreva o motivo (pelo menos 5 letras).";
  if (m.includes("CONFIG_MISSING")) return `Falta configurar: ${m.split("CONFIG_MISSING:")[1]?.trim() ?? "a cobrança mensal"} (Central › Taxas da franquia).`;
  if (m.includes("MONTHLY_NOT_STARTED")) return "A unidade ainda não tem o primeiro mês da cobrança mensal (Central › Taxas da franquia).";
  if (m.includes("PERIOD_BEFORE_START")) return "Este mês é anterior ao primeiro mês da cobrança mensal da unidade.";
  if (m.includes("PERIOD_NOT_CLOSED")) return "O mês ainda não terminou. A prévia é do mês que já fechou.";
  if (m.includes("PERIOD_CLOSED_FIXED"))
    return `O mês ${m.split("PERIOD_CLOSED_FIXED:")[1]?.trim() ?? ""} está fechado na contabilidade e não tem a taxa fixa lançada. Reabra o mês ou mude o primeiro mês da cobrança.`;
  if (m.includes("LATER_BATCH_EXISTS")) return "Já existe a cobrança de um mês seguinte desta unidade.";
  if (m.includes("BATCH_EXISTS")) return "Esta unidade já tem a prévia deste mês.";
  if (m.includes("BATCH_NOT_PREVIEW")) return "Esta cobrança não está mais em prévia.";
  if (m.includes("OPEN_CONTEST")) return "Há contestação aberta. O Financeiro decide antes.";
  if (m.includes("PREVIEW_OPEN")) return "A janela da prévia ainda está aberta e a unidade não conferiu.";
  if (m.includes("PREVIEW_CLOSED")) return "A janela da prévia terminou. A contestação agora é depois da emissão.";
  if (m.includes("ITEM_NOT_CONTESTABLE")) return "Esta linha não se contesta (crédito, ajuste negativo ou saldo anterior decidido pelo Financeiro).";
  if (m.includes("ITEM_ALREADY_CONTESTED")) return "Esta linha já foi contestada e decidida.";
  if (m.includes("BATCH_NOT_CONTESTABLE")) return "Esta cobrança não aceita contestação agora.";
  if (m.includes("ITEM_NOT_CONTESTED")) return "Esta linha não está contestada.";
  if (m.includes("LINE_PARTLY_INVOICED")) return "Parte desta linha já foi cobrada em outro mês. Dispense pela tela das taxas da rede.";
  if (m.includes("BATCH_NOT_CANCELLABLE")) return "Esta cobrança não pode ser cancelada (já paga ou não emitida).";
  if (m.includes("CONTEST_AFTER_ISSUE")) return "Esta cobrança tem contestação depois da emissão. Ela não é cancelada.";
  if (m.includes("BATCH_NOT_APPROVED")) return "Esta cobrança não está aprovada.";
  if (m.includes("ALREADY_DECIDED")) return "O saldo anterior desta unidade já foi decidido.";
  if (m.includes("PARTIAL_PAYABLE")) return "Há conta de taxa paga em parte. Dispense à mão nas Contas a pagar.";
  if (m.includes("INSTALLMENTS_REQUIRED")) return "Para parcelar, escolha de 2 a 24 parcelas.";
  if (m.includes("INVALID_DECISION")) return "Escolha incluir, parcelar ou dispensar.";
  if (m.includes("PERIOD_CLOSED")) return "O mês está fechado na contabilidade.";
  if (m.includes("ISSUE_NOT_OPEN")) return "Esta divergência não está mais aberta.";
  return "Não foi possível concluir. Tente de novo.";
};

async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(nome, args);
  if (error) {
    console.error(`${nome} failed:`, error.message);
    return { data: null, error: mensagem(error.message) };
  }
  return { data: data as T, error: null };
}

// ---- a configuração (Central › Taxas da franquia) ---------------------------------

export type ConfigDaRede = {
  fine_percent: string;
  interest_percent_month: string;
  due_day: string;
  period_kind: string;
  preview_days: string;
  partial_month_rule: string;
  revenue_recognition: string;
  example_values: boolean;
};

export type ConfigDaUnidade = {
  fine_percent: string;
  interest_percent_month: string;
  due_day: string;
  finance_email: string;
  monthly_from: string;
  started_on: string;
  ended_on: string;
  example_values: boolean;
};

/** Valor de exemplo só no treino e no sandbox (20.15.6): nunca com a conta de produção. */
async function exemploPermitido(): Promise<boolean> {
  const { data } = await rpc<{ root_account?: { environment?: string } | null }>("franchise_billing_config_read", {});
  return data?.root_account?.environment !== "production";
}

export async function salvarConfigDaRede(c: ConfigDaRede): Promise<Resultado> {
  if (c.example_values && !(await exemploPermitido())) return { ok: false, error: "Valor de exemplo não vale com a conta de produção." };
  const r = await rpc("franchise_billing_settings_save", { p: c });
  if (r.error) return { ok: false, error: r.error };
  revalidatePath("/central/rede/taxas");
  return { ok: true };
}

export async function salvarConfigDaUnidade(clinicId: string, c: ConfigDaUnidade): Promise<Resultado> {
  if (c.example_values && !(await exemploPermitido())) return { ok: false, error: "Valor de exemplo não vale com a conta de produção." };
  const r = await rpc("franchise_billing_unit_save", { p_clinic_id: clinicId, p: c });
  if (r.error) return { ok: false, error: r.error };
  revalidatePath("/central/rede/taxas");
  return { ok: true };
}

// ---- a prévia ---------------------------------------------------------------------

export async function abrirPrevia(clinicId: string, mes: string): Promise<Resultado & { id?: string }> {
  const r = await rpc<string>("franchise_monthly_open", { p_clinic_id: clinicId, p_period: `${mes.slice(0, 7)}-01` });
  if (r.error) return { ok: false, error: r.error };
  revalidatePath(CAMINHO);
  return { ok: true, id: r.data ?? undefined };
}

export async function refazerPrevia(batchId: string, motivo: string): Promise<Resultado & { id?: string }> {
  const r = await rpc<string>("franchise_monthly_rebuild", { p_batch_id: batchId, p_reason: motivo });
  if (r.error) return { ok: false, error: r.error };
  revalidatePath(CAMINHO);
  return { ok: true, id: r.data ?? undefined };
}

export async function conferirPrevia(batchId: string): Promise<Resultado> {
  const r = await rpc("franchise_monthly_ack", { p_batch_id: batchId });
  if (r.error) return { ok: false, error: r.error };
  revalidatePath(CAMINHO);
  return { ok: true };
}

/** A contestação, com o comprovante opcional (PDF ou imagem, até 10 MB). */
export async function contestarLinha(form: FormData): Promise<Resultado> {
  const itemId = String(form.get("itemId") ?? "");
  const motivo = String(form.get("motivo") ?? "");
  const arquivo = form.get("arquivo");
  let caminho: string | null = null;
  if (arquivo instanceof File && arquivo.size > 0) {
    if (arquivo.size > 10 * 1024 * 1024) return { ok: false, error: "O comprovante passa de 10 MB." };
    if (!["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(arquivo.type)) {
      return { ok: false, error: "Envie o comprovante em PDF ou imagem (PNG, JPG)." };
    }
    const ext = arquivo.type === "application/pdf" ? "pdf" : arquivo.type.split("/")[1];
    caminho = `${itemId}/${Date.now()}.${ext}`;
  }
  // O banco confere quem pode ANTES de o arquivo ser gravado.
  const r = await rpc("franchise_monthly_contest", { p_item_id: itemId, p_reason: motivo, p_attachment_path: caminho });
  if (r.error) return { ok: false, error: r.error };
  if (caminho && arquivo instanceof File) {
    const { error } = await createAdminClient()
      .storage.from("cobranca-mensal")
      .upload(caminho, Buffer.from(await arquivo.arrayBuffer()), { contentType: arquivo.type, upsert: false });
    if (error) {
      console.error("contest attachment upload failed:", error.message);
      return { ok: true, aviso: "A contestação foi registrada, mas o comprovante não subiu. Mande-o ao Financeiro." };
    }
  }
  revalidatePath(CAMINHO);
  return { ok: true };
}

export async function linkDoComprovante(batchId: string, itemId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  // Só quem lê a cobrança (o banco confere) recebe o link, por 10 minutos.
  const r = await rpc<{ items: { id: string; contest_attachment_path: string | null }[] }>("franchise_monthly_read", { p_batch_id: batchId });
  if (r.error) return { ok: false, error: r.error };
  const path = r.data?.items.find((i) => i.id === itemId)?.contest_attachment_path;
  if (!path) return { ok: false, error: "Esta linha não tem comprovante." };
  const { data, error } = await createAdminClient().storage.from("cobranca-mensal").createSignedUrl(path, 600);
  if (error || !data?.signedUrl) return { ok: false, error: "Não foi possível abrir o comprovante." };
  return { ok: true, url: data.signedUrl };
}

export async function decidirContestacao(itemId: string, aceitar: boolean, motivo: string): Promise<Resultado> {
  const r = await rpc("franchise_monthly_decide", { p_item_id: itemId, p_accept: aceitar, p_reason: motivo });
  if (r.error) return { ok: false, error: r.error };
  revalidatePath(CAMINHO);
  return { ok: true };
}

// ---- aprovar e emitir, tentar de novo, cancelar ------------------------------------

export async function aprovarEEmitir(batchId: string): Promise<Resultado> {
  const session = await getSessionContext();
  const r = await rpc<{ status: string; charge_id?: string; total_cents?: number }>("franchise_monthly_approve", { p_batch_id: batchId });
  if (r.error) return { ok: false, error: r.error };
  revalidatePath(CAMINHO);
  if (r.data?.status === "sem_cobranca") return { ok: true, aviso: "Nada a cobrar neste mês: nenhuma cobrança foi emitida." };
  if (r.data?.status === "acumulada") return { ok: true, aviso: "Abaixo do mínimo do Asaas (R$ 5,00): o valor acumula para o mês seguinte." };
  if (!r.data?.charge_id) return { ok: false, error: "A cobrança não foi criada." };
  const e = await emitirCobrancaMensal(r.data.charge_id, session.userId);
  revalidatePath(CAMINHO);
  if (!e.ok) return { ok: false, error: `A prévia foi aprovada, mas a emissão no Asaas falhou: ${e.error} Use "Tentar de novo".` };
  return { ok: true };
}

export async function tentarDeNovo(batchId: string): Promise<Resultado> {
  const session = await getSessionContext();
  const r = await rpc<string>("franchise_monthly_retry", { p_batch_id: batchId });
  if (r.error || !r.data) return { ok: false, error: r.error ?? "Não foi possível." };
  const e = await emitirCobrancaMensal(r.data, session.userId);
  revalidatePath(CAMINHO);
  return e.ok ? { ok: true } : { ok: false, error: e.error };
}

/** Cancela no Asaas (para reemitir) e remonta a prévia do mesmo mês. */
export async function cancelarCobranca(batchId: string, motivo: string): Promise<Resultado> {
  const session = await getSessionContext();
  if (motivo.trim().length < 5) return { ok: false, error: mensagem("REASON_REQUIRED") };
  const r = await rpc<{ charge_id: string; account_id: string | null; asaas_payment_id: string | null }>("franchise_monthly_cancel_check", {
    p_batch_id: batchId,
  });
  if (r.error || !r.data) return { ok: false, error: r.error ?? "Não foi possível." };
  const c = await cancelarNoAsaas({
    chargeId: r.data.charge_id,
    accountId: r.data.account_id,
    asaasPaymentId: r.data.asaas_payment_id,
    actorId: session.userId,
    reason: motivo,
  });
  if (!c.ok) return { ok: false, error: c.error };
  revalidatePath(CAMINHO);
  return { ok: true, aviso: "Cancelada no Asaas. A prévia do mês volta a ser montada (abra de novo pela tela ou espere a rotina do dia)." };
}

// ---- o saldo anterior (20.15.1) ---------------------------------------------------

export async function decidirSaldoAnterior(
  clinicId: string,
  decisao: "incluir" | "parcelar" | "dispensar",
  parcelas: number,
  motivo: string
): Promise<Resultado> {
  const r = await rpc<number>("franchise_prior_balance_decide", {
    p_clinic_id: clinicId,
    p_decision: decisao,
    p_installments: parcelas,
    p_reason: motivo,
  });
  if (r.error) return { ok: false, error: r.error };
  revalidatePath(CAMINHO);
  return { ok: true };
}

// ---- a conferência das taxas (4021a) ----------------------------------------------

export async function conferirAgora(): Promise<Resultado> {
  const r = await rpc<{ novas: number; abertas: number; fechadas: number }>("franchise_reconciliation_run_now", {});
  if (r.error) return { ok: false, error: r.error };
  revalidatePath(CAMINHO);
  return { ok: true, aviso: `Conferido: ${r.data?.novas ?? 0} nova(s), ${r.data?.abertas ?? 0} aberta(s), ${r.data?.fechadas ?? 0} fechada(s).` };
}

export async function ignorarDivergencia(issueId: string, motivo: string): Promise<Resultado> {
  const r = await rpc("franchise_reconciliation_ignore", { p_issue_id: issueId, p_reason: motivo });
  if (r.error) return { ok: false, error: r.error };
  revalidatePath(CAMINHO);
  return { ok: true };
}
