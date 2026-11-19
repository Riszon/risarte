import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { credencialDaConta, opcoesDaConta } from "./account";
import {
  createCompanyCustomer,
  findCustomerByCpfCnpj,
  getBalance,
  getPayment,
  refundPayment,
  updateCustomer,
  type AsaasCredential,
} from "./api";
import { AsaasError, mensagemDoAsaas, type AsaasRequestOptions } from "./client";
import { bancoDe, cancelarNoAsaas, emitirComOAsaas, lerCobranca, type BancoDaEmissao, type CobrancaDoBanco } from "./cobranca";

/**
 * ASA5 (4023) — O RISARTE EMPRESARIAL PELO ASAAS. Só no servidor.
 *
 * O banco (`corporate_charge_prepare`) confere a regra e deixa a cobrança
 * "emitindo" na conta certa:
 *   - a MENSALIDADE na conta raiz da franqueadora, com split percentual para a
 *     carteira da RisLife (o Asaas aplica sobre o líquido — decisão 2b);
 *   - a IMPLANTAÇÃO na conta da RisLife, sem split (decisão 1).
 * Aqui se usa o mesmo miolo da emissão (consulta pela referência, nunca POST às
 * cegas), com o pagador do Empresarial (contato e avisos do Asaas ligados) e,
 * na mensalidade, a foto do "Relatório detalhado" com o link na descrição.
 *
 * A geração da cobrança no Empresarial NUNCA falha por causa do Asaas: o que não
 * sai fica com o motivo, e a tela mostra "Emitir no Asaas" ou "Tentar de novo".
 */

export const REFERENCIA_DO_CADASTRO_DA_EMPRESA = "riszon-empresarial:";

type PagadorDoEmpresarial = {
  billing_id: string;
  company_id: string;
  name: string;
  doc: string;
  email: string | null;
  phone: string | null;
  asaas_customer_id: string | null;
};

/** Os motivos de `corporate_charge_prepare`, em português. */
export const MOTIVO_DO_EMPRESARIAL: Record<string, string> = {
  desligado: "O Empresarial ainda não cobra pelo Asaas (Central › Empresarial).",
  nao_encontrada: "Cobrança não encontrada.",
  nao_esta_em_aberto: "A cobrança não está em aberto.",
  gerada_antes_da_data: "A cobrança foi gerada antes da data de início do Asaas. Use “Emitir no Asaas”.",
  ja_tem_cobranca: "Esta cobrança já está no Asaas.",
  abaixo_do_minimo: "O Asaas não emite cobrança abaixo de R$ 5,00.",
  sem_documento_aceito:
    "O pagador não tem documento aceito pelo Asaas (CAEPF, CNO ou NIF sem o CNPJ da matriz e sem o CPF do responsável). Complete o cadastro da empresa.",
  sem_contato: "O pagador está sem e-mail e sem celular: o Asaas não teria para onde mandar a cobrança. Complete o cadastro.",
  sem_conta_da_rislife: "A conta Asaas da RisLife não está pronta (Central › Empresarial).",
  sem_conta_raiz: "A conta Asaas da franqueadora não está ativa.",
  contas_em_ambientes_diferentes: "A conta da franqueadora e a da RisLife estão em ambientes diferentes (sandbox e produção).",
  split_invalido: "O percentual da RisLife na mensalidade não é válido (precisa ser menor que 100%).",
};

const so = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");

async function origem(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function bancoDaCobrancaEmpresarial(chargeId: string, cred: AsaasCredential, opts: AsaasRequestOptions): BancoDaEmissao {
  const admin = createAdminClient();
  const base = bancoDe(chargeId, cred, opts);
  const salvar = async (asaasId: string): Promise<string> => {
    const { data, error } = await admin.rpc("_corporate_payer_save", { p_charge_id: chargeId, p_asaas_customer_id: asaasId });
    if (error) throw new Error(`corporate payer save failed: ${error.message}`);
    return data as string;
  };
  return {
    ...base,
    aplicarRegua: undefined,
    planoDoSplit: undefined,
    semSplit: undefined,
    avisarTeto: undefined,
    salvarPagador: (_c, asaasId) => salvar(asaasId),
    pagador: async () => {
      const { data, error } = await admin.rpc("_corporate_payer", { p_charge_id: chargeId });
      if (error) throw new Error(`corporate payer read failed: ${error.message}`);
      const p = data as PagadorDoEmpresarial | null;
      if (!p?.doc || (p.doc.length !== 11 && p.doc.length !== 14)) {
        throw new AsaasError({ code: "bad_request", messagePt: "O pagador está sem CPF ou CNPJ. Confira o cadastro da empresa.", logMessage: "corporate payer without doc" });
      }
      const email = p.email?.trim() || undefined;
      const mobilePhone = so(p.phone) || undefined;
      let asaasId = p.asaas_customer_id ?? (await findCustomerByCpfCnpj(cred, p.doc, opts))?.id ?? null;
      if (asaasId) {
        await updateCustomer(cred, asaasId, { ...(email ? { email } : {}), ...(mobilePhone ? { mobilePhone } : {}), notificationDisabled: false }, opts);
      } else {
        const novo = await createCompanyCustomer(
          cred,
          { name: p.name, cpfCnpj: p.doc, email, mobilePhone, externalReference: REFERENCIA_DO_CADASTRO_DA_EMPRESA + p.company_id },
          opts
        );
        asaasId = novo?.id ?? null;
      }
      if (!asaasId) throw new AsaasError({ code: "invalid_response", messagePt: "O Asaas não devolveu o pagador.", logMessage: "corporate customer without id" });
      return { asaasId, localId: await salvar(asaasId) };
    },
    splitsFixos: async () => {
      const { data, error } = await admin.rpc("_corporate_split_plan", { p_charge_id: chargeId });
      if (error) throw new Error(`corporate split plan failed: ${error.message}`);
      return ((data ?? []) as { walletId: string; percentualValue: number }[])
        .filter((s) => s.walletId && Number(s.percentualValue) > 0 && Number(s.percentualValue) < 100)
        .map((s) => ({ walletId: s.walletId, percentualValue: Number(s.percentualValue) }));
    },
  };
}

/** Emite no Asaas a cobrança do Empresarial que o banco deixou "emitindo". */
export async function emitirCobrancaEmpresarial(chargeId: string, actorId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await lerCobranca(chargeId);
  if (!c) return { ok: false, error: "Cobrança não encontrada." };
  if (c.status !== "emitindo") return { ok: false, error: "Esta cobrança não está esperando emissão." };
  if (!c.gateway_account_id) return { ok: false, error: "A conta Asaas não está ativa." };
  const purpose = "emitir_cobranca_empresarial";
  let cred: AsaasCredential;
  try {
    cred = await credencialDaConta(c.gateway_account_id, purpose, actorId);
  } catch (e) {
    console.error("corporate charge credential failed:", e instanceof Error ? e.message : e);
    await createAdminClient().rpc("_charge_mark_error", { p_charge_id: chargeId, p_code: "credential" });
    return { ok: false, error: "Não foi possível ler a chave da conta Asaas. Avise o Admin Master." };
  }
  const opts = opcoesDaConta(c.gateway_account_id, purpose);
  return emitirComOAsaas({ ...(c as CobrancaDoBanco), via_carne: false }, cred, opts, bancoDaCobrancaEmpresarial(chargeId, cred, opts));
}

/**
 * A foto do "Relatório detalhado" do mês (decisão 6), com o link na descrição da
 * cobrança. Falha aqui não impede a cobrança: ela sai sem o link.
 */
async function guardarRelatorioDoMes(chargeId: string, billingId: string, companyId: string, actorId: string | null) {
  try {
    const { loadCompanyReport } = await import("@/app/(app)/empresarial/[companyId]/relatorio/data");
    const report = await loadCompanyReport(companyId, "ACTIVE");
    if (!report) return;
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("_corporate_report_save", { p_billing_id: billingId, p_data: report, p_actor: actorId });
    if (error) throw new Error(error.message);
    const r = data as { id: string; code: string };
    const link = `${await origem()}/relatorio-do-mes/${r.code}`;
    const { error: e2 } = await admin.rpc("_corporate_charge_report", {
      p_charge_id: chargeId,
      p_report_id: r.id,
      p_suffix: ` — Titulares e dependentes do mês: ${link}`,
    });
    if (e2) throw new Error(e2.message);
  } catch (e) {
    console.error("corporate monthly report failed:", e instanceof Error ? e.message : e);
  }
}

export type ResultadoDoEmpresarial = {
  emitidas: number;
  /** As que não saíram, com o motivo (a geração no Empresarial já foi feita). */
  avisos: string[];
};

/**
 * Depois de gerar (ou no botão "Emitir no Asaas"): prepara no banco, com a
 * sessão da pessoa, e emite. `manual` = o botão (a linha gerada antes da data
 * de início). Desligado, não faz nada e não avisa.
 */
export async function emitirEmpresarialSeLigado(
  billingIds: string[],
  args: { actorId: string | null; manual?: boolean }
): Promise<ResultadoDoEmpresarial> {
  const r: ResultadoDoEmpresarial = { emitidas: 0, avisos: [] };
  if (billingIds.length === 0) return r;
  const supabase = await createClient();
  for (const billingId of billingIds) {
    const { data, error } = await supabase.rpc("corporate_charge_prepare", { p_billing_id: billingId, p_manual: Boolean(args.manual) });
    if (error) {
      // Banco sem a 4023: o Empresarial segue como antes.
      if (/does not exist|schema cache/i.test(error.message)) return r;
      console.error("corporate prepare failed:", error.message);
      r.avisos.push("Não foi possível preparar a cobrança no Asaas.");
      continue;
    }
    const p = data as { charge_id?: string; kind?: string; motivo?: string } | null;
    if (!p?.charge_id) {
      if (p?.motivo && p.motivo !== "desligado" && !(p.motivo === "gerada_antes_da_data" && !args.manual)) {
        r.avisos.push(MOTIVO_DO_EMPRESARIAL[p.motivo] ?? p.motivo);
      }
      continue;
    }
    if (p.motivo === "ja_tem_cobranca") continue;
    if (p.kind === "mensalidade") {
      const { data: b } = await createAdminClient().schema("empresarial").from("adhesion_billing").select("company_id").eq("id", billingId).maybeSingle();
      if (b?.company_id) await guardarRelatorioDoMes(p.charge_id, billingId, b.company_id as string, args.actorId);
    }
    const e = await emitirCobrancaEmpresarial(p.charge_id, args.actorId);
    if (e.ok) r.emitidas += 1;
    else r.avisos.push(`A cobrança foi gerada, mas não saiu no Asaas: ${e.error} Use “Tentar de novo”.`);
  }
  return r;
}

/** "Tentar de novo" a emissão que deu erro. */
export async function tentarDeNovoEmpresarial(chargeId: string, actorId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("corporate_charge_retry", { p_charge_id: chargeId });
  if (error) return { ok: false, error: "Esta cobrança não pode ser tentada de novo." };
  return emitirCobrancaEmpresarial(chargeId, actorId);
}

type CobrancaViva = { charge_id: string; account_id: string | null; asaas_payment_id: string | null; status: string } | null;

/**
 * Antes de editar, cancelar, excluir ou dar a baixa à mão: com cobrança viva no
 * Asaas, cancela lá primeiro (a trava do banco recusa o resto). Paga no Asaas,
 * recusa: a baixa vem do aviso, e desfazer é pelo estorno.
 */
export async function liberarDoAsaas(billingId: string, actorId: string, reason: string): Promise<{ ok: true; cancelou: boolean } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("corporate_live_charge", { p_billing_id: billingId });
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return { ok: true, cancelou: false };
    return { ok: false, error: "Não foi possível conferir a cobrança no Asaas." };
  }
  const viva = data as CobrancaViva;
  if (!viva) return { ok: true, cancelou: false };
  if (["paga", "liquidada", "em_contestacao"].includes(viva.status)) {
    return { ok: false, error: "Esta cobrança foi paga pelo Asaas. A baixa vem do Asaas; para desfazer, use o estorno." };
  }
  const r = await cancelarNoAsaas({ chargeId: viva.charge_id, accountId: viva.account_id, asaasPaymentId: viva.asaas_payment_id, actorId, reason });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, cancelou: true };
}

/**
 * O estorno da cobrança paga pelo Asaas (19.37): confere o saldo da conta que
 * recebeu e, na mensalidade, o da RisLife (a parte dela volta junto); estorna
 * no Asaas e marca. O Empresarial desfaz a baixa em seguida (`reverse_billing`).
 * Devolve `pelo_asaas: false` quando a cobrança não foi paga pelo Asaas.
 */
export async function estornarPeloAsaas(billingId: string, actorId: string, reason: string): Promise<{ ok: true; pelo_asaas: boolean } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("corporate_refund_check", { p_billing_id: billingId });
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return { ok: true, pelo_asaas: false };
    return { ok: false, error: "Não foi possível conferir o pagamento no Asaas." };
  }
  const f = data as {
    charge_id: string;
    account_id: string;
    asaas_payment_id: string | null;
    kind: string;
    paid_cents: number | null;
    net_cents: number | null;
    rislife_account_id: string | null;
    rislife_cents: number | null;
  } | null;
  if (!f) return { ok: true, pelo_asaas: false };
  if (!f.asaas_payment_id) return { ok: false, error: "A cobrança paga não tem o código do Asaas. Trate à mão." };
  const purpose = "estornar_cobranca_empresarial";
  try {
    const cred = await credencialDaConta(f.account_id, purpose, actorId);
    const opts = opcoesDaConta(f.account_id, purpose);
    const pg = await getPayment(cred, f.asaas_payment_id, opts);
    if (pg?.status === "REFUNDED") {
      await createAdminClient().rpc("_corporate_mark_refunded", { p_charge_id: f.charge_id });
      return { ok: true, pelo_asaas: true };
    }
    // O saldo de quem devolve: a conta que recebeu fica com o líquido menos a RisLife.
    const daConta = (Number(f.net_cents ?? f.paid_cents ?? 0) - Number(f.rislife_cents ?? 0)) / 100;
    const saldo = await getBalance(cred, opts);
    if (saldo !== null && saldo < daConta) {
      return { ok: false, error: `Saldo insuficiente na conta Asaas para o estorno (precisa de R$ ${daConta.toFixed(2).replace(".", ",")}).` };
    }
    if (f.rislife_account_id && Number(f.rislife_cents ?? 0) > 0) {
      const credRl = await credencialDaConta(f.rislife_account_id, purpose, actorId);
      const saldoRl = await getBalance(credRl, opcoesDaConta(f.rislife_account_id, purpose));
      const precisa = Number(f.rislife_cents) / 100;
      if (saldoRl !== null && saldoRl < precisa) {
        return { ok: false, error: `Saldo insuficiente na carteira da RisLife para devolver a parte dela (R$ ${precisa.toFixed(2).replace(".", ",")}).` };
      }
    }
    await refundPayment(cred, f.asaas_payment_id, reason.slice(0, 200), opts);
  } catch (e) {
    if (!(e instanceof AsaasError)) console.error("corporate refund failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: mensagemDoAsaas(e) };
  }
  const { error: e2 } = await createAdminClient().rpc("_corporate_mark_refunded", { p_charge_id: f.charge_id });
  if (e2) {
    console.error("corporate mark refunded failed:", e2.message);
    return { ok: false, error: "O estorno saiu no Asaas, mas não foi gravado no riSZon. Avise o Admin Master." };
  }
  return { ok: true, pelo_asaas: true };
}

export type CobrancaDoAsaasNaTela = {
  billing_id: string;
  charge_id: string;
  status: string;
  kind: "implantacao" | "mensalidade";
  invoice_url: string | null;
  bank_slip_url: string | null;
  pix_copy_paste: string | null;
  identification_field: string | null;
  error_code: string | null;
  due_date: string | null;
  emissor: string;
  report_code: string | null;
};

/** As cobranças do Asaas das linhas de uma empresa (a aba Cobranças). */
export async function cobrancasDoAsaasDaEmpresa(companyId: string): Promise<{ porLinha: Record<string, CobrancaDoAsaasNaTela>; ligado: boolean }> {
  const supabase = await createClient();
  const [{ data, error }, { data: cfg }] = await Promise.all([
    supabase.rpc("corporate_billing_charges", { p_company_id: companyId }),
    supabase.rpc("corporate_settings_read"),
  ]);
  if (error) return { porLinha: {}, ligado: false };
  const porLinha: Record<string, CobrancaDoAsaasNaTela> = {};
  for (const r of (data ?? []) as CobrancaDoAsaasNaTela[]) porLinha[r.billing_id] = r;
  return { porLinha, ligado: Boolean((cfg as { ligado?: boolean } | null)?.ligado) };
}
