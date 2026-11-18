import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayInBrazil } from "@/lib/dates";
import { credencialDaConta, opcoesDaConta } from "./account";
import { AsaasError, mensagemDoAsaas } from "./client";
import {
  getPayment,
  listActiveSubscriptionsAll,
  listInstallmentsAll,
  listPaymentsAll,
  sondarLeituraProibida,
  type AsaasPayment,
} from "./api";
import { conciliar, janelaDe3Dias, type CobrancaDoAsaas, type CobrancaDoRiszon } from "./conciliacao-regras";

/**
 * ASA7 (4022, spec 21.2 e 21.7) — as três peças do servidor que falam com o
 * Asaas, só com LEITURAS: o levantamento da conta, a sonda da chave e a
 * conciliação das cobranças (diária e semanal). Toda chamada sai do servidor,
 * com a chave da conta lida do Vault.
 */

const MAX_PAGINAS_LEVANTAMENTO = 50; // até 5.000 por lista
const MAX_PAGINAS_CONCILIACAO = 60;
const MAX_LEITURAS_UMA_A_UMA = 200;

const paraAsaas = (p: AsaasPayment & { dateCreated?: string | null }): CobrancaDoAsaas => ({
  id: String(p.id),
  status: p.status ?? null,
  value: p.value ?? null,
  deleted: p.deleted ?? null,
  externalReference: p.externalReference ?? null,
  dateCreated: p.dateCreated ?? null,
});

async function idsConhecidos(accountId: string): Promise<{ pagamentos: Set<string>; parcelamentos: Set<string> }> {
  const admin = createAdminClient();
  const pagamentos = new Set<string>();
  const parcelamentos = new Set<string>();
  for (let de = 0; ; de += 1000) {
    const { data, error } = await admin
      .from("charges")
      .select("asaas_payment_id, asaas_installment_id")
      .eq("gateway_account_id", accountId)
      .range(de, de + 999);
    if (error) throw new Error(`charges read failed: ${error.message}`);
    for (const r of data ?? []) {
      if (r.asaas_payment_id) pagamentos.add(r.asaas_payment_id);
      if (r.asaas_installment_id) parcelamentos.add(r.asaas_installment_id);
    }
    if (!data || data.length < 1000) break;
  }
  return { pagamentos, parcelamentos };
}

// ---- 1) O LEVANTAMENTO (2a: obrigatório antes de ligar a unidade) ---------------------

export async function levantarConta(accountId: string, actorId: string | null): Promise<{ ok: boolean; erro?: string; resumo?: Record<string, number> }> {
  const admin = createAdminClient();
  const opts = opcoesDaConta(accountId, "survey");
  try {
    const cred = await credencialDaConta(accountId, "survey", actorId);
    const conhecidos = await idsConhecidos(accountId);
    const abertas = await listPaymentsAll(cred, { status: "PENDING" }, MAX_PAGINAS_LEVANTAMENTO, opts);
    const vencidas = await listPaymentsAll(cred, { status: "OVERDUE" }, MAX_PAGINAS_LEVANTAMENTO, opts);
    const fora = [...abertas.itens, ...vencidas.itens].filter((p) => p.id && !p.deleted && !conhecidos.pagamentos.has(String(p.id)));
    const parcelamentos = await listInstallmentsAll(cred, MAX_PAGINAS_LEVANTAMENTO, opts);
    const parcFora = parcelamentos.itens.filter((x) => x.id && !conhecidos.parcelamentos.has(String(x.id)));
    const assinaturas = await listActiveSubscriptionsAll(cred, MAX_PAGINAS_LEVANTAMENTO, opts);
    const truncado = abertas.truncado || vencidas.truncado || parcelamentos.truncado || assinaturas.truncado;
    const amostra = [...fora]
      .sort((a, b) => String(a.dueDate ?? "").localeCompare(String(b.dueDate ?? "")))
      .slice(0, 20)
      .map((p) => ({ id: p.id, vencimento: p.dueDate ?? null, valor: p.value ?? null, situacao: p.status ?? null, forma: p.billingType ?? null }));
    const resumo = {
      open_payments: fora.length,
      open_payments_cents: fora.reduce((s, p) => s + Math.round(Number(p.value ?? 0) * 100), 0),
      installments: parcFora.length,
      subscriptions: assinaturas.itens.length,
      chamadas: abertas.chamadas + vencidas.chamadas + parcelamentos.chamadas + assinaturas.chamadas,
    };
    const { error } = await admin.rpc("_gateway_survey_save", {
      p_account_id: accountId,
      p_actor: actorId,
      p: { ok: true, ...resumo, sample: amostra, error: truncado ? "Lista longa: o levantamento leu até 5.000 de cada tipo." : null },
    });
    if (error) throw new Error(`survey save failed: ${error.message}`);
    return { ok: true, resumo };
  } catch (e) {
    const erro = e instanceof AsaasError ? mensagemDoAsaas(e) : "Não foi possível fazer o levantamento agora.";
    if (!(e instanceof AsaasError)) console.error("gateway survey failed:", e instanceof Error ? e.message : e);
    await admin.rpc("_gateway_survey_save", { p_account_id: accountId, p_actor: actorId, p: { ok: false, error: erro } });
    return { ok: false, erro };
  }
}

// ---- 2) A SONDA DA CHAVE (21.7 item 2) ------------------------------------------------

export async function sondarChave(accountId: string, actorId: string | null): Promise<{ ok: boolean; detalhe: Record<string, string> }> {
  const admin = createAdminClient();
  const opts = opcoesDaConta(accountId, "key_probe");
  const cred = await credencialDaConta(accountId, "key_probe", actorId);
  const detalhe: Record<string, string> = {};
  for (const path of ["/transfers", "/pix/transactions", "/bill"] as const) {
    const r = await sondarLeituraProibida(cred, path, opts);
    detalhe[path] = r.resultado;
  }
  const ok = Object.values(detalhe).every((v) => v === "recusada");
  const { error } = await admin.rpc("_gateway_key_probe_save", { p_account_id: accountId, p_ok: ok, p_detail: detalhe });
  if (error) throw new Error(`key probe save failed: ${error.message}`);
  return { ok, detalhe };
}

// ---- 3) A CONCILIAÇÃO DAS COBRANÇAS (3a) -------------------------------------------------

type ResultadoDaConciliacao = { conta: string; tipo: "diaria" | "semanal"; novas?: number; abertas?: number; chamadas: number; erro?: string };

async function cobrancasDoRiszon(accountId: string, filtro: { ids?: string[]; desde?: string; abertas?: boolean }): Promise<CobrancaDoRiszon[]> {
  const admin = createAdminClient();
  const out: CobrancaDoRiszon[] = [];
  const cols = "id, asaas_payment_id, status, value_cents, is_external";
  if (filtro.ids?.length) {
    for (let i = 0; i < filtro.ids.length; i += 200) {
      const { data, error } = await admin.from("charges").select(cols).eq("gateway_account_id", accountId).in("asaas_payment_id", filtro.ids.slice(i, i + 200));
      if (error) throw new Error(`charges read failed: ${error.message}`);
      out.push(...((data ?? []) as CobrancaDoRiszon[]));
    }
  }
  // A API entrega no máximo 1.000 linhas por leitura: de página em página.
  const todas = async (consulta: (de: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) => {
    for (let de = 0; de < 10_000; de += 1000) {
      const { data, error } = await consulta(de);
      if (error) throw new Error(`charges read failed: ${error.message}`);
      out.push(...((data ?? []) as CobrancaDoRiszon[]));
      if (!data || data.length < 1000) break;
    }
  };
  if (filtro.desde) {
    await todas((de) => admin.from("charges").select(cols).eq("gateway_account_id", accountId).not("asaas_payment_id", "is", null)
      .gte("updated_at", `${filtro.desde}T00:00:00-03:00`).order("id").range(de, de + 999));
  }
  if (filtro.abertas) {
    await todas((de) => admin.from("charges").select(cols).eq("gateway_account_id", accountId).not("asaas_payment_id", "is", null)
      .in("status", ["emitida", "vencida"]).order("id").range(de, de + 999));
  }
  const unicas = new Map(out.map((c) => [c.id, c]));
  return [...unicas.values()];
}

export async function conciliarConta(accountId: string, tipo: "diaria" | "semanal"): Promise<ResultadoDaConciliacao> {
  const admin = createAdminClient();
  const opts = opcoesDaConta(accountId, `recon_${tipo}`);
  let chamadas = 0;
  try {
    const cred = await credencialDaConta(accountId, `recon_${tipo}`, null);
    const hoje = todayInBrazil();
    const desde = janelaDe3Dias(hoje);
    const asaas = new Map<string, CobrancaDoAsaas>();
    const juntar = (itens: AsaasPayment[]) => itens.forEach((p) => asaas.set(String(p.id), paraAsaas(p)));
    let riszon: CobrancaDoRiszon[];
    if (tipo === "diaria") {
      const criadas = await listPaymentsAll(cred, { "dateCreated[ge]": desde }, MAX_PAGINAS_CONCILIACAO, opts);
      const pagas = await listPaymentsAll(cred, { "paymentDate[ge]": desde }, MAX_PAGINAS_CONCILIACAO, opts);
      chamadas += criadas.chamadas + pagas.chamadas;
      juntar(criadas.itens);
      juntar(pagas.itens);
      riszon = await cobrancasDoRiszon(accountId, { ids: [...asaas.keys()], desde });
    } else {
      for (const status of ["PENDING", "OVERDUE", "CONFIRMED", "AWAITING_RISK_ANALYSIS"]) {
        const l = await listPaymentsAll(cred, { status }, MAX_PAGINAS_CONCILIACAO, opts);
        chamadas += l.chamadas;
        juntar(l.itens);
      }
      riszon = await cobrancasDoRiszon(accountId, { ids: [...asaas.keys()], abertas: true });
    }
    // As divergências ainda abertas (ou ignoradas): relidas uma a uma, para que
    // cada uma possa fechar sozinha mesmo fora da janela desta rodada — a
    // cobrança apagada no painel, por exemplo, não volta mais nas listas.
    const conhecidosAntes = await idsConhecidos(accountId);
    const { data: pendentes, error: ePend } = await admin
      .from("gateway_charge_issues")
      .select("asaas_payment_id")
      .eq("account_id", accountId)
      .in("status", ["aberta", "ignorada"])
      .not("asaas_payment_id", "is", null)
      .limit(MAX_LEITURAS_UMA_A_UMA);
    if (ePend) throw new Error(`charge issues read failed: ${ePend.message}`);
    const relidas = new Set<string>();
    for (const id of new Set((pendentes ?? []).map((p) => String(p.asaas_payment_id)))) {
      if (asaas.has(id)) continue;
      relidas.add(id);
      try {
        const p = await getPayment(cred, id, opts);
        chamadas++;
        if (p?.id) asaas.set(String(p.id), paraAsaas(p));
      } catch (e) {
        chamadas++;
        if (!(e instanceof AsaasError && e.code === "not_found")) throw e;
        // Sumiu do Asaas: a de fora deixa de ser divergência; a do riSZon vira "não existe no Asaas" abaixo.
        if (!conhecidosAntes.pagamentos.has(id)) asaas.set(id, { id, status: null, value: null, deleted: true, externalReference: null, dateCreated: null });
      }
    }
    if (relidas.size) {
      const jaTem = new Set(riszon.map((c) => c.id));
      for (const c of await cobrancasDoRiszon(accountId, { ids: [...relidas] })) if (!jaTem.has(c.id)) riszon.push(c);
    }
    // As do riSZon que as listas não trouxeram: uma a uma (até 200 por rodada).
    const naoAchadas = new Set<string>();
    const faltam = riszon.filter((c) => c.asaas_payment_id && !c.is_external && !asaas.has(c.asaas_payment_id)).slice(0, MAX_LEITURAS_UMA_A_UMA);
    for (const c of faltam) {
      try {
        const p = await getPayment(cred, String(c.asaas_payment_id), opts);
        chamadas++;
        if (p?.id) asaas.set(String(p.id), paraAsaas(p));
      } catch (e) {
        chamadas++;
        if (e instanceof AsaasError && e.code === "not_found") naoAchadas.add(String(c.asaas_payment_id));
        else throw e;
      }
    }
    // O "fora do riSZon" só olha as listas desta rodada (não as lidas uma a uma, que já são do riSZon).
    const conhecidos = await idsConhecidos(accountId);
    const r = conciliar({ asaas: [...asaas.values()], riszon, conhecidos: conhecidos.pagamentos, naoAchadas });
    const { data, error } = await admin.rpc("_gateway_charge_recon_save", {
      p_account_id: accountId,
      p_kind: tipo,
      p_found: r.divergencias,
      p_checked: r.conferidas,
      p_calls: chamadas,
    });
    if (error) throw new Error(`recon save failed: ${error.message}`);
    const j = (data ?? {}) as { novas?: number; abertas?: number };
    return { conta: accountId, tipo, novas: j.novas, abertas: j.abertas, chamadas };
  } catch (e) {
    const erro = e instanceof AsaasError ? mensagemDoAsaas(e) : e instanceof Error ? e.message : String(e);
    console.error("gateway charge recon failed:", erro);
    await admin.from("gateway_charge_recon_runs").insert({ account_id: accountId, kind: tipo, calls: chamadas, error: erro.slice(0, 300) });
    return { conta: accountId, tipo, chamadas, erro };
  }
}

/** A rotina: toda noite a diária; aos domingos também a semanal e a sonda das chaves de produção. */
export async function rodarConciliacaoDasCobrancas(hoje: string = todayInBrazil()): Promise<{ contas: number; novas: number; chamadas: number; sondas: number; erros: number }> {
  const admin = createAdminClient();
  const { data: contas, error } = await admin
    .from("gateway_accounts")
    .select("id, environment")
    .eq("status", "active")
    .not("api_key_secret_id", "is", null)
    .limit(500);
  if (error) throw new Error(`gateway accounts read failed: ${error.message}`);
  const domingo = new Date(`${hoje}T12:00:00Z`).getUTCDay() === 0;
  const total = { contas: 0, novas: 0, chamadas: 0, sondas: 0, erros: 0 };
  // Uma conta por vez: longe do limite de 50 leituras simultâneas do Asaas.
  for (const c of contas ?? []) {
    total.contas++;
    for (const tipo of domingo ? (["diaria", "semanal"] as const) : (["diaria"] as const)) {
      const r = await conciliarConta(c.id, tipo);
      total.novas += r.novas ?? 0;
      total.chamadas += r.chamadas;
      if (r.erro) total.erros++;
    }
    if (domingo && c.environment === "production") {
      await sondarChave(c.id, null).then(() => total.sondas++).catch((e) => {
        total.erros++;
        console.error("gateway key probe failed:", e instanceof Error ? e.message : e);
      });
    }
  }
  return total;
}
