import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { credencialDaConta, opcoesDaConta } from "@/lib/asaas/account";
import { getPaymentLimits } from "@/lib/asaas/api";
import { emitirNoAsaas } from "@/lib/asaas/cobranca";
import { emitirParcelamentoNoAsaas } from "@/lib/asaas/parcelamento";
import { comecarRodada, terminarRodada, type OrigemDaRodada } from "@/lib/asaas/rodadas";
import { folgaDoLimite, origemDaCobranca, type ResumoDaCriacao } from "@/lib/asaas/cobrancas-automaticas-regras";

/**
 * 4012 (ASA4, entrega 1; spec 19.4, 19.5, 19.6, 19.10): CRIA AS COBRANÇAS QUE
 * JÁ DEVEM EXISTIR NO ASAAS — a proposta A.
 *
 * O banco entrega a lista (`_auto_charge_due`: parcela pelo Asaas, da venda
 * marcada, dentro do prazo, sem cobrança ativa, sem cancelamento à mão, unidade
 * pronta) e a porta sem usuário (`_charge_prepare_system`, que confere tudo o
 * que a emissão manual confere). Aqui:
 *   - lê o LIMITE DIÁRIO de cada conta antes (GET /payments/limits) e para
 *     perto dele — o que sobra sai na rodada seguinte, com o motivo na lista;
 *   - emite pela mesma função da emissão manual (`emitirNoAsaas`), sem usuário;
 *   - marca "Enviada pelo Asaas" quando a régua mandou o aviso de criação;
 *   - para depois de 3 erros seguidos na mesma conta (não martela o Asaas).
 * Idempotente: duas rodadas ao mesmo tempo não duplicam (a porta trava a
 * parcela e confere de novo; o índice único segura o resto).
 */
export async function criarCobrancasAutomaticas(opts: {
  origem: OrigemDaRodada;
  ator?: string | null;
  clinicId?: string | null;
  negotiationId?: string | null;
  directSaleId?: string | null;
  /** Origem gravada na cobrança quando a chamada é de uma parcela específica (o restante do dinheiro). */
  origemDaCobranca?: "restante";
  limite?: number;
}): Promise<ResumoDaCriacao> {
  const admin = createAdminClient();
  const rodada = await comecarRodada("cobrancas", opts.origem, opts.ator ?? null);
  const resumo: ResumoDaCriacao = { criadas: 0, falhas: 0, puladas: 0, motivo: null, erros: [] };

  const { data: lista, error } = await admin.rpc("_auto_charge_due", {
    p_clinic_id: opts.clinicId ?? null,
    p_negotiation_id: opts.negotiationId ?? null,
    p_direct_sale_id: opts.directSaleId ?? null,
    p_limit: opts.limite ?? 300,
  });
  if (error) {
    const semMigracao = /does not exist|schema cache/i.test(error.message);
    if (!semMigracao) console.error("auto charge list failed:", error.message);
    await terminarRodada(rodada, { ok: semMigracao, motivo: semMigracao ? "sem_migracao" : "erro_lista" });
    return { ...resumo, motivo: semMigracao ? "sem_migracao" : "erro_lista" };
  }
  const itens = (lista ?? []) as { installment_id: string; clinic_id: string; billing_type: string; origem: string }[];

  // Por unidade (= por conta Asaas): o limite é da conta.
  const porUnidade = new Map<string, typeof itens>();
  for (const it of itens) porUnidade.set(it.clinic_id, [...(porUnidade.get(it.clinic_id) ?? []), it]);

  // A folga do limite diário de cada conta (lida uma vez por rodada).
  const folgas = new Map<string, number>();
  const folgaDa = async (clinicId: string) => {
    if (folgas.has(clinicId)) return folgas.get(clinicId)!;
    const { data: conta } = await admin.rpc("_gateway_account_of", { p_clinic_id: clinicId });
    let f = Number.POSITIVE_INFINITY;
    if (typeof conta === "string") {
      try {
        const purpose = "limite_de_cobrancas";
        const cred = await credencialDaConta(conta, purpose, opts.ator ?? null);
        const lim = await getPaymentLimits(cred, opcoesDaConta(conta, purpose));
        if (lim) f = folgaDoLimite(lim);
      } catch (e) {
        console.error("payment limits read failed:", e instanceof Error ? e.message : e);
      }
    }
    folgas.set(clinicId, f);
    return f;
  };

  for (const [clinicId, daUnidade] of porUnidade) {
    let folga = await folgaDa(clinicId);
    let seguidas = 0;
    for (const it of daUnidade) {
      if (folga <= 0) {
        resumo.puladas += 1;
        resumo.motivo = "limite_diario";
        continue;
      }
      if (seguidas >= 3) {
        resumo.puladas += 1;
        resumo.motivo = resumo.motivo ?? "erros_seguidos";
        continue;
      }
      const prep = await admin.rpc("_charge_prepare_system", {
        p_installment_id: it.installment_id,
        p_billing_type: it.billing_type,
        p_origin: origemDaCobranca(opts.origem, it.origem, opts.origemDaCobranca),
      });
      if (prep.error || typeof prep.data !== "string") {
        const m = prep.error?.message ?? "";
        // Outra rodada pegou primeiro (ou a parcela saiu da lista): não é erro.
        if (/NOT_DUE|duplicate key|charges_one_active/i.test(m)) resumo.puladas += 1;
        else {
          resumo.falhas += 1;
          resumo.erros.push(m.slice(0, 80));
        }
        continue;
      }
      const r = await emitirNoAsaas(prep.data, opts.ator ?? null);
      if (r.ok) {
        resumo.criadas += 1;
        folga -= 1;
        seguidas = 0;
        await admin.rpc("_charge_mark_asaas_sent", { p_charge_id: prep.data });
      } else {
        resumo.falhas += 1;
        seguidas += 1;
        resumo.erros.push(r.error.slice(0, 80));
      }
    }
    folgas.set(clinicId, folga);
  }

  // ASA4 (4013): o CARTÃO PARCELADO PELO ASAAS nasce INTEIRO (o cartão é cobrado
  // uma vez): o bloco da venda marcada, sem prazo. Cada parcela conta no limite.
  if (!opts.origemDaCobranca) {
    const { data: blocos, error: eb } = await admin.rpc("_card_blocks_due", {
      p_clinic_id: opts.clinicId ?? null,
      p_negotiation_id: opts.negotiationId ?? null,
      p_direct_sale_id: opts.directSaleId ?? null,
      p_limit: 100,
    });
    if (eb && !/does not exist|schema cache/i.test(eb.message)) console.error("card blocks list failed:", eb.message);
    for (const b of (blocos ?? []) as { clinic_id: string; negotiation_id: string | null; direct_sale_id: string | null; parcelas: number; origem: string }[]) {
      const folga = await folgaDa(b.clinic_id);
      if (folga < b.parcelas) {
        resumo.puladas += b.parcelas;
        resumo.motivo = "limite_diario";
        continue;
      }
      const prep = await admin.rpc("_card_block_prepare_system", {
        p_negotiation_id: b.negotiation_id,
        p_direct_sale_id: b.direct_sale_id,
        p_origin: origemDaCobranca(opts.origem, b.origem),
      });
      if (prep.error || typeof prep.data !== "string") {
        const m = prep.error?.message ?? "";
        if (/NOT_DUE|CHARGE_ALREADY_ACTIVE|duplicate key|charges_one_active/i.test(m)) resumo.puladas += b.parcelas;
        else {
          resumo.falhas += 1;
          resumo.erros.push(m.slice(0, 80));
        }
        continue;
      }
      const r = await emitirParcelamentoNoAsaas(prep.data, opts.ator ?? null);
      if (r.ok) {
        resumo.criadas += b.parcelas;
        folgas.set(b.clinic_id, folga - b.parcelas);
      } else {
        resumo.falhas += 1;
        resumo.erros.push(r.error.slice(0, 80));
      }
    }
  }

  await terminarRodada(rodada, {
    ok: resumo.falhas === 0,
    criadas: resumo.criadas,
    falhas: resumo.falhas,
    puladas: resumo.puladas,
    motivo: resumo.motivo,
    detalhes: { erros: resumo.erros.slice(0, 10), negociacao: opts.negotiationId ?? null, venda_direta: opts.directSaleId ?? null },
  });
  return resumo;
}
