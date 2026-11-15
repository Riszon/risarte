// ASA4, entrega 1, parte 1 (4011) — meio por parcela, dinheiro, permuta,
// painel do dinheiro: o que não depende do banco. O banco é provado no ensaio
// (scripts/asaas-ensaio-asa4-entrega1-meios.mjs).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ehPeloAsaas,
  ehVendaNova,
  erroDoMeioDaVendaNova,
  meioParaARegra,
  meiosDaBaixaVendaNova,
  meiosDaVendaNova,
  mensagemDoErroDeMeio,
  rotuloDoMeio,
  temDescontoAVista,
  trocasPossiveis,
} from "@/lib/venda-direta-meios";
import { avisoDoDeposito, somaDosEscolhidos } from "@/lib/finance/dinheiro";
import { CATEGORIAS } from "@/lib/finance/repasses-franquia";

const SQL = readFileSync("supabase/migrations/4011_asa4_meio_por_parcela_dinheiro_e_permuta.sql", "utf8");
const BAIXA = readFileSync("src/app/(app)/prontuarios/[id]/receivables-actions.ts", "utf8");
const TROCA = readFileSync("src/app/(app)/prontuarios/[id]/cobranca-actions.ts", "utf8");
const VENDA = readFileSync("src/app/(app)/comercial/venda-direta/actions.ts", "utf8");
const NAV = readFileSync("src/app/(app)/financeiro/finance-nav.tsx", "utf8");

describe("venda direta nova: os meios oferecidos (19.11)", () => {
  const base = { isManager: false, cardMachine: true, allowed: null };
  it("à vista (1×): Pix e dinheiro; permuta só para o Gerente", () => {
    expect(meiosDaVendaNova({ ...base, installments: 1 })).toEqual(["pix", "dinheiro"]);
    expect(meiosDaVendaNova({ ...base, installments: 1, isManager: true })).toEqual(["pix", "dinheiro", "permuta"]);
  });
  it("parcelado: Asaas (boleto, Pix, cartão, cartão parcelado — 4013), dinheiro e, provisório, a maquininha", () => {
    expect(meiosDaVendaNova({ ...base, installments: 3 })).toEqual(["boleto", "pix", "cartao", "cartao_parcelado_asaas", "dinheiro", "cartao_parcelado"]);
  });
  it("com a chave da rede desligada, sai a maquininha (entrega 2)", () => {
    expect(meiosDaVendaNova({ ...base, installments: 3, cardMachine: false })).not.toContain("cartao_parcelado");
  });
  it("nunca oferece depósito à vista nem crédito recorrente", () => {
    const todos = meiosDaVendaNova({ installments: 6, isManager: true, cardMachine: true, allowed: null });
    expect(todos).not.toContain("deposito_avista");
    expect(todos).not.toContain("credito_recorrente");
  });
  it("o dinheiro segue o 'depósito à vista' da regra comercial", () => {
    expect(meiosDaVendaNova({ ...base, installments: 1, allowed: ["deposito_avista"] })).toEqual(["dinheiro"]);
    expect(meioParaARegra("dinheiro")).toBe("deposito_avista");
    expect(meioParaARegra("permuta")).toBeNull();
    expect(meioParaARegra("boleto")).toBe("boleto");
  });
});

describe("ajuste B: o desconto à vista", () => {
  it("dinheiro à vista tem o desconto do depósito à vista de hoje (= Pix)", () => {
    expect(temDescontoAVista("dinheiro", 1)).toBe(temDescontoAVista("deposito_avista", 1));
    expect(temDescontoAVista("pix", 1)).toBe(true);
  });
  it("permuta e parcelado não têm desconto à vista automático", () => {
    expect(temDescontoAVista("permuta", 1)).toBe(false);
    expect(temDescontoAVista("dinheiro", 2)).toBe(false);
  });
  it("a tela da venda não dá desconto automático à permuta", () => {
    expect(VENDA).toContain('input.paymentMethod !== "permuta"');
  });
});

describe("as regras da venda nova (erros em português)", () => {
  it("recusa depósito à vista, crédito recorrente e boleto à vista; permuta só para o Gerente", () => {
    expect(erroDoMeioDaVendaNova("deposito_avista", 3, true)).toMatch(/Asaas/);
    expect(erroDoMeioDaVendaNova("credito_recorrente", 3, true)).toMatch(/Asaas/);
    expect(erroDoMeioDaVendaNova("boleto", 1, true)).toMatch(/À vista/);
    expect(erroDoMeioDaVendaNova("permuta", 1, false)).toMatch(/Gerente/);
    expect(erroDoMeioDaVendaNova("permuta", 1, true)).toBeNull();
    expect(erroDoMeioDaVendaNova("boleto", 3, false)).toBeNull();
  });
  it("traduz cada erro do banco da 4011", () => {
    for (const k of ["CASH_METHOD_ONLY", "PERMUTA_NOT_ALLOWED", "PERMUTA_DESCRIPTION_REQUIRED", "PERMUTA_NEEDS_METHOD_CHANGE", "RECEIPT_METHOD_NOT_ALLOWED", "CONTRACT_NOT_SIGNED", "METHOD_NOT_ALLOWED", "METHOD_NOT_SUPPORTED"]) {
      expect(mensagemDoErroDeMeio(`erro ${k}`), k).toBeTruthy();
      expect(SQL, k).toContain(k);
    }
    expect(mensagemDoErroDeMeio("RECEIPT_METHOD_NOT_ALLOWED")).toMatch(/dinheiro ou permuta/);
    expect(mensagemDoErroDeMeio("NOT_ALLOWED")).toBeNull();
  });
  it("venda nova é só a marcada 'asa4'", () => {
    expect(ehVendaNova("asa4")).toBe(true);
    expect(ehVendaNova(null)).toBe(false);
  });
});

describe("a baixa à mão e a troca de meio (ajuste C)", () => {
  it("baixa: dinheiro sempre; permuta só na parcela de permuta e para o Gerente; cartão parcelado só na de maquininha", () => {
    expect(meiosDaBaixaVendaNova("boleto", true)).toEqual(["dinheiro"]);
    expect(meiosDaBaixaVendaNova("permuta", true)).toEqual(["dinheiro", "permuta"]);
    expect(meiosDaBaixaVendaNova("permuta", false)).toEqual(["dinheiro"]);
    expect(meiosDaBaixaVendaNova("cartao_parcelado", false)).toEqual(["dinheiro", "cartao_parcelado"]);
  });
  it("troca: para permuta só o Gerente; nunca para o mesmo meio", () => {
    expect(trocasPossiveis("dinheiro", false)).toEqual(["pix", "boleto", "cartao"]);
    expect(trocasPossiveis("boleto", true)).toEqual(["pix", "cartao", "dinheiro", "permuta"]);
    expect(ehPeloAsaas("pix") && ehPeloAsaas("boleto") && ehPeloAsaas("cartao")).toBe(true);
    expect(ehPeloAsaas("dinheiro") || ehPeloAsaas("permuta")).toBe(false);
  });
  it("a baixa em dinheiro cancela antes a cobrança do Asaas (e recusa se já foi paga lá)", () => {
    // 4015 (19.26.1): o mesmo, agora pelo cancelamento na operação, com a confirmação da tela.
    const OP = readFileSync("src/lib/asaas/boletos-da-operacao.ts", "utf8");
    expect(BAIXA).toContain('input.paymentMethod === "dinheiro"');
    expect(BAIXA).toContain("comBoletosCancelados");
    expect(OP).toContain("PAGA_NO_ASAAS.has(p.status)");
  });
  it("a troca para meio do Asaas gera a cobrança na hora", () => {
    expect(TROCA).toContain("installment_set_method");
    expect(TROCA).toMatch(/emitirCobranca\(\{ clientId: input\.clientId/);
  });
  it("rótulos de todos os meios", () => {
    expect(rotuloDoMeio("permuta")).toBe("Permuta");
    expect(rotuloDoMeio("dinheiro")).toBe("Dinheiro");
    expect(rotuloDoMeio(null)).toBe("—");
  });
});

describe("o dinheiro: depósito e limites (19.12, ajuste D e F5)", () => {
  it("soma só os escolhidos", () => {
    const p = [{ receipt_id: "a", valor: 70000 }, { receipt_id: "b", valor: 30000 }, { receipt_id: "c", valor: 5 }];
    expect(somaDosEscolhidos(p, new Set(["a", "b"]))).toBe(100000);
  });
  it("R$ 10.000 ou mais: agência, na conta da unidade (Resolução CMN 4.648/2018); acima de R$ 5.000: prefira a agência", () => {
    expect(avisoDoDeposito(1_000_000)).toMatch(/R\$ 10\.000 ou mais/);
    expect(avisoDoDeposito(999_999)).toMatch(/Acima de R\$ 5\.000/);
    expect(avisoDoDeposito(500_000)).toBeNull();
    expect(avisoDoDeposito(1_000_000)).toMatch(/Não divida/);
  });
  it("a tela entra no menu do Financeiro", () => {
    expect(NAV).toContain('href: "/financeiro/dinheiro"');
  });
});

describe("a migração 4011", () => {
  it("só acrescenta meios (nada é apagado) e marca só a venda nova", () => {
    expect(SQL).toContain("'dinheiro', 'permuta'));");
    expect(SQL).toContain("alter column method_rule set default 'asa4'");
    expect(SQL).not.toMatch(/^\s*delete\s+from/im);
    expect(SQL).not.toMatch(/update public\.direct_sales set method_rule/i);
  });
  it("a permuta não leva cota de benefício e fica fora do fluxo de caixa", () => {
    expect(SQL).toContain("in ('cartao', 'cartao_parcelado', 'permuta')");
    expect(SQL.match(/b\.kind = 'permuta'\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(SQL).toContain("coalesce(i.payment_method, '') <> 'permuta'");
  });
  it("a baixa em dinheiro/permuta fecha a venda; sem contrato assinado, recusa", () => {
    expect(SQL).toContain("perform public._counter_confirm_sale(");
    expect(SQL).toContain("raise exception 'CONTRACT_NOT_SIGNED'");
  });
  it("o depósito exige comprovante na pasta privada e o desfazer exige motivo", () => {
    expect(SQL).toContain("raise exception 'PROOF_REQUIRED'");
    expect(SQL).toMatch(/values \('depositos', 'depositos', false/);
    expect(SQL).toContain("raise exception 'REASON_REQUIRED'");
  });
  it("o aviso do dinheiro parado roda no banco (pg_cron), sem a Vercel", () => {
    expect(SQL).toContain("cron.schedule('risarte-dinheiro-parado'");
  });
  it("as funções internas são fechadas para quem está logado", () => {
    for (const f of ["_counter_confirm_sale(uuid, text, uuid)", "_cash_pending(uuid)", "_permuta_account_for(uuid)", "cash_stale_alerts_run()", "_is_manager_or_admin(uuid)"]) {
      expect(SQL, f).toContain(`revoke execute on function public.${f} from public, anon, authenticated;`);
    }
  });
  it("repasses: a permuta tem categoria própria", () => {
    expect(SQL).toContain("when r.payment_method = 'permuta' then 'permuta'");
    expect(CATEGORIAS.some((c) => c.valor === "permuta")).toBe(true);
  });
});
