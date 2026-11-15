// ASA4, entrega 3 (4017) — a renegociação assinada pela ZapSign: o que não
// depende do banco. O banco é provado no ensaio (scripts/asaas-ensaio-asa4-renegociacao.mjs).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { descontoPorComponente, dispensaDoRecebimento } from "@/lib/renegociacao/desconto";
import { corpoDoTermo, FRASE_DA_ESPERA } from "@/lib/renegociacao/termo-texto";
import { mensagemDaRenegociacao } from "@/lib/renegociacao/mensagens";
import { origemDaCobranca } from "@/lib/asaas/cobrancas-automaticas-regras";
import { montarSignatarios } from "@/lib/signatures/signers";

const SQL = readFileSync("supabase/migrations/4017_asa4_renegociacao_assinada.sql", "utf8");
const ACOES = readFileSync("src/app/(app)/prontuarios/[id]/receivables-actions.ts", "utf8");
const SERVIDOR = readFileSync("src/lib/asaas/renegociacao.ts", "utf8");
const WEBHOOK = readFileSync("src/lib/signatures/webhook-apply.ts", "utf8");
const ROTA = readFileSync("src/app/api/cron/gateway-regua/route.ts", "utf8");
const DIALOGO = readFileSync("src/app/(app)/prontuarios/[id]/renegotiation-dialog.tsx", "utf8");

describe("salvar não aplica; a assinatura aplica (19.28.2)", () => {
  it("salvar fica aguardando assinatura e não cancela boleto nenhum", () => {
    expect(SQL).toContain("case when v_needs_auth then 'aguardando_autorizacao' else 'aguardando_assinatura' end");
    expect(ACOES).not.toMatch(/save_renegotiation[\s\S]{0,400}comBoletosCancelados/);
    expect(ACOES).toContain("4017: salvar NÃO aplica mais nem cancela boleto nenhum.");
  });
  it("na assinatura, primeiro o Asaas (os boletos vivos), depois o banco, depois as cobranças novas", () => {
    expect(SERVIDOR).toContain('operacao: "renegociação"');
    expect(SERVIDOR).toContain('admin.rpc("renegotiation_apply_signed"');
    expect(SERVIDOR).toContain('criarCobrancasAutomaticas({ origem: "gatilho", renegotiationId');
    expect(SQL).toContain("raise exception 'SOURCE_CHANGED'");
    expect(SQL).toContain("if r.applied_at is not null then return; end if;  -- aviso repetido da ZapSign");
  });
  it("o webhook da ZapSign reage ao termo; a rotina diária expira, cancela e refaz o que ficou", () => {
    expect(WEBHOOK).toContain("reagirAoTermo(r.package_id, r.status, !!r.newly_signed)");
    expect(ROTA).toContain("rotinaDasRenegociacoes()");
    expect(SQL).toContain("where status = 'aguardando_assinatura' and sign_deadline < public.today_br()");
  });
  it("o termo assinado e não aplicado é avisado com essas palavras", () => {
    expect(SERVIDOR).toContain('"Termo de renegociação assinado e NÃO aplicado"');
  });
});

describe("o prazo, o pagamento antes e a cobrança externa (19.28.9 e 19.28.10)", () => {
  it("prazo: até 5 dias corridos, nunca depois do 1º vencimento novo", () => {
    expect(SQL).toContain("select least(public.today_br() + 5,");
    expect(SQL).toContain("raise exception 'FIRST_DUE_TOO_SOON'");
  });
  it("pagamento numa antiga antes de assinar cancela o acordo, com aviso para refazer", () => {
    expect(SQL).toContain("perform public._renegotiation_end(r.id, 'cancelada_pagamento',");
    expect(SQL).toContain("'O cliente pagou uma parcela da renegociação antes de assinar: refaça o acordo'");
  });
  it("cobrança externa: só o Gerente ou o Admin confirma; sem isso, o envio é recusado", () => {
    expect(SQL).toContain("raise exception 'EXTERNAL_NOT_CONFIRMED'");
    expect(SQL).toMatch(/renegotiation_confirm_external[\s\S]*?_is_manager_or_admin\(r\.clinic_id\)/);
  });
  it("a frase do termo sobre os boletos atuais (aprovada)", () => {
    expect(FRASE_DA_ESPERA).toBe("Até você assinar, os boletos atuais continuam valendo. Se pagar algum deles antes de assinar, o acordo é cancelado e refeito.");
    expect(DIALOGO).toContain("{FRASE_DA_ESPERA}");
  });
});

describe("as regras da renegociação (19.28.6 e 19.28.12)", () => {
  it("só venda fechada (contrato assinado) ou acordo aplicado", () => {
    expect(SQL).toContain("raise exception 'SALE_NOT_CLOSED'");
    expect(mensagemDaRenegociacao("SALE_NOT_CLOSED")).toContain("Feche a venda (contrato assinado) antes de renegociar.");
  });
  it("os meios da venda direta nova; permuta só Gerente/Admin, com descrição; a maquininha pela chave", () => {
    expect(SQL).toContain("public._direct_sale_method_ok(nullif(v_e->>'payment_method', ''))");
    expect(SQL).toContain("raise exception 'PERMUTA_DESCRIPTION_REQUIRED'");
    expect(DIALOGO).toContain('{isManager && <option value="permuta">Permuta</option>}');
    expect(DIALOGO).toContain("{maquininhaLigada && <option value=\"cartao_parcelado\">");
    expect(DIALOGO).not.toContain('value="credito_recorrente"');
    expect(DIALOGO).not.toContain('value="deposito_avista"');
  });
  it("a cobrança automática conhece a origem do acordo", () => {
    expect(origemDaCobranca("gatilho", "renegociacao")).toBe("renegociacao");
    expect(origemDaCobranca("gatilho", "venda_direta")).toBe("venda_direta");
    expect(origemDaCobranca("vercel", "renegociacao")).toBe("rotina");
  });
});

describe("o desconto por componente: a mesma ordem da dispensa (19.28.14, 2a)", () => {
  const base = { principal: 50000, beneficio: 1000, multa: 1000, juros: 500 };
  it("juros → multa → benefício → principal", () => {
    expect(descontoPorComponente(base, 1800)).toEqual({ juros: 500, multa: 1000, beneficio: 300, principal: 0 });
    expect(descontoPorComponente(base, 400)).toEqual({ juros: 400, multa: 0, beneficio: 0, principal: 0 });
    expect(descontoPorComponente(base, 0)).toEqual({ juros: 0, multa: 0, beneficio: 0, principal: 0 });
  });
  it("dá o mesmo que a dispensa do recebimento manual, para o mesmo valor", () => {
    for (const d of [0, 300, 500, 1200, 1800, 2500, 10000]) {
      const total = 52500;
      expect(descontoPorComponente(base, d)).toEqual(dispensaDoRecebimento(base, total - d));
    }
  });
  it("o banco usa a mesma ordem", () => {
    expect(SQL).toMatch(/interest_cents := least[\s\S]*fee_cents\s+:= least[\s\S]*benefit_cents\s+:= least[\s\S]*principal_cents := least/);
  });
});

describe("o termo (19.28.4 e 19.28.10)", () => {
  const corpo = corpoDoTermo({
    codigo: "RN-00099",
    cliente: "Ana Souza",
    pagador: "Maria Souza",
    unidade: "Risarte Londrina Ltda",
    calculadoEm: "2026-11-15",
    prazo: "2026-11-20",
    antigas: [{ seq: 3, vencimento: "2026-10-15", valor: 51517, venda: "VD-00012" }],
    principal: 50000,
    beneficio: 0,
    multa: 1000,
    juros: 517,
    desconto: 0,
    novoTotal: 51517,
    jurosAoMes: 0,
    novas: [{ vencimento: "2026-12-10", valor: 51517, meio: "boleto" }],
  });
  const texto = [corpo.preamble, ...corpo.sections.map((s) => `${s.title}\n${s.body}`), corpo.closing].join("\n");
  it("mostra cada valor separado, congelado no dia, e quem paga", () => {
    expect(texto).toContain("calculados em 15/11/2026 e não mudam até a assinatura");
    expect(texto).toContain("Maria Souza, responsável financeiro de Ana Souza");
    expect(texto).toContain("Multa por atraso: R$");
    expect(texto).toContain("Juros por atraso: R$");
    expect(texto).toContain("até 20/11/2026");
    expect(texto).toContain("(VD-00012)");
  });
  it("assina o responsável financeiro, mesmo com o paciente adulto", () => {
    const m = montarSignatarios({
      client: { name: "Ana", cpf: "52998224725", email: null, phone: null, birthDate: "1990-01-01" },
      guardians: [],
      todayIso: "2026-11-15",
      templates: [{ name: "Termo", witness_count: 0, risarte_signer_mode: "none", risarte_signer_role: null, risarte_signer_user_id: null }],
      witnesses: [],
      representatives: [null],
      pagador: { name: "Maria", cpf: "11144477735", email: null, phone: null, relationship: "mãe" },
    });
    expect(m.signers[0].name).toBe("Maria");
    expect(m.signers[0].qualification).toBe("Responsável financeiro");
  });
});

describe("a lista da venda: um link só, do mesmo pagador (19.28.5 e 19.28.11)", () => {
  it("os boletos do acordo entram na lista da venda de origem só do mesmo pagador", () => {
    expect(SQL).toContain("or (ch.id is not null and ch.payer_guardian_id is not distinct from l.payer_guardian_id))");
    expect(SQL).toContain("l.direct_sale_id = any(r.origin_direct_sale_ids)");
  });
  it("as vendas de origem seguem a cadeia (acordo de acordo)", () => {
    expect(SQL).toContain("union select unnest(f.origin_negotiation_ids) from fontes f");
  });
  it("a trava da 4015a conta o acordo aguardando assinatura", () => {
    expect(SQL).toContain("where r.status in ('aguardando_autorizacao', 'aguardando_assinatura')");
  });
});
