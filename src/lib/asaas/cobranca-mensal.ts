import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { credencialDaConta, opcoesDaConta } from "./account";
import { createUnitCustomer, findCustomerByCpfCnpj, updateCustomer, type AsaasCredential } from "./api";
import { AsaasError, type AsaasRequestOptions } from "./client";
import { bancoDe, emitirComOAsaas, lerCobranca, type BancoDaEmissao, type CobrancaDoBanco, type ResultadoDaEmissao } from "./cobranca";

/**
 * ASA6 (4021) — A COBRANÇA MENSAL DA REDE NO ASAAS. Só no servidor.
 *
 * O banco aprovou a prévia e deixou a cobrança "emitindo" na conta da
 * FRANQUEADORA (a conta raiz), com a unidade como pagadora. Aqui se usa o mesmo
 * miolo da emissão (consulta pela referência, nunca POST às cegas), com:
 *   - o PAGADOR = a unidade (razão social e CNPJ), com o e-mail financeiro e os
 *     avisos do Asaas ligados (só e-mail: o cadastro não tem celular);
 *   - sem a régua dos pacientes e sem o split das taxas;
 *   - o split por VALOR FIXO só do fundo com conta própria (decisão 5a).
 */

type PagadorDaUnidade = {
  clinic_id: string;
  name: string;
  cnpj: string | null;
  email: string | null;
  asaas_customer_id: string | null;
  gateway_customer_id: string | null;
};

export const REFERENCIA_DO_CADASTRO_DA_UNIDADE = "riszon-unidade:";

export function bancoDaCobrancaMensal(chargeId: string, cred: AsaasCredential, opts: AsaasRequestOptions): BancoDaEmissao {
  const admin = createAdminClient();
  const base = bancoDe(chargeId, cred, opts);
  const salvar = async (asaasId: string): Promise<string> => {
    const { data, error } = await admin.rpc("_franchise_monthly_payer_save", { p_charge_id: chargeId, p_asaas_customer_id: asaasId });
    if (error) throw new Error(`unit payer save failed: ${error.message}`);
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
      const { data, error } = await admin.rpc("_franchise_monthly_payer", { p_charge_id: chargeId });
      if (error) throw new Error(`unit payer read failed: ${error.message}`);
      const p = data as PagadorDaUnidade | null;
      if (!p?.cnpj || p.cnpj.length !== 14) {
        throw new AsaasError({ code: "bad_request", messagePt: "A unidade está sem o CNPJ. Confira o cadastro da unidade.", logMessage: "unit without cnpj" });
      }
      if (!p.email) {
        throw new AsaasError({ code: "bad_request", messagePt: "A unidade está sem o e-mail financeiro (Central › Taxas da franquia).", logMessage: "unit without email" });
      }
      let asaasId = p.asaas_customer_id ?? (await findCustomerByCpfCnpj(cred, p.cnpj, opts))?.id ?? null;
      if (asaasId) {
        await updateCustomer(cred, asaasId, { email: p.email, notificationDisabled: false }, opts);
      } else {
        const novo = await createUnitCustomer(
          cred,
          { name: p.name, cpfCnpj: p.cnpj, email: p.email, externalReference: REFERENCIA_DO_CADASTRO_DA_UNIDADE + p.clinic_id },
          opts
        );
        asaasId = novo?.id ?? null;
      }
      if (!asaasId) throw new AsaasError({ code: "invalid_response", messagePt: "O Asaas não devolveu o pagador.", logMessage: "unit customer without id" });
      return { asaasId, localId: await salvar(asaasId) };
    },
    splitsFixos: async () => {
      const { data, error } = await admin.rpc("_franchise_monthly_split_plan", { p_charge_id: chargeId });
      if (error) throw new Error(`monthly split plan failed: ${error.message}`);
      return ((data ?? []) as { walletId: string; fixedCents: number }[])
        .filter((s) => s.walletId && Number(s.fixedCents) > 0)
        .map((s) => ({ walletId: s.walletId, fixedValue: Math.round(Number(s.fixedCents)) / 100 }));
    },
  };
}

/** Emite no Asaas a cobrança mensal que o banco deixou "emitindo". */
export async function emitirCobrancaMensal(chargeId: string, actorId: string | null): Promise<ResultadoDaEmissao> {
  const c = await lerCobranca(chargeId);
  if (!c) return { ok: false, error: "Cobrança não encontrada." };
  if (c.status !== "emitindo") return { ok: false, error: "Esta cobrança não está esperando emissão." };
  if (!c.gateway_account_id) return { ok: false, error: "A franqueadora não tem a conta Asaas ativa." };
  const purpose = "emitir_cobranca_mensal";
  let cred: AsaasCredential;
  try {
    cred = await credencialDaConta(c.gateway_account_id, purpose, actorId);
  } catch (e) {
    console.error("monthly charge credential failed:", e instanceof Error ? e.message : e);
    await createAdminClient().rpc("_charge_mark_error", { p_charge_id: chargeId, p_code: "credential" });
    return { ok: false, error: "Não foi possível ler a chave da conta Asaas da franqueadora. Avise o Admin Master." };
  }
  const opts = opcoesDaConta(c.gateway_account_id, purpose);
  return emitirComOAsaas({ ...(c as CobrancaDoBanco), via_carne: false }, cred, opts, bancoDaCobrancaMensal(chargeId, cred, opts));
}
