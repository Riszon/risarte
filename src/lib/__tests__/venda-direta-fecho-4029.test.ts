// 4029 — o fecho da venda direta sem informação errada (relato do dono,
// 27/11/2026: VD-00001 concluída e "paga" sem cobrança e sem dinheiro).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  comprovanteDaVenda,
  confirmacaoAMaoRecusada,
  ehEscolhaDoCartao,
  fechoDaVenda,
  meioDaCobrancaNoAsaas,
  podeConfirmarAMao,
  rotuloDoMeioComEscolha,
  semCobrancaOQueFazer,
  type PagamentoDaVenda,
} from "@/lib/venda-direta-caixa";

const pago = (x: Partial<PagamentoDaVenda>): PagamentoDaVenda => ({
  escolhaDoCartao: null,
  recebidoCents: 0,
  abertoCents: 0,
  parcelasAbertas: 0,
  meioPagoNoAsaas: null,
  ...x,
});

describe("a parcela do Asaas sem cobrança (ponto 1)", () => {
  const base = { voltas: 0, maxVoltas: 24 };
  it("automática DESLIGADA na unidade pronta: o botão de gerar aparece na hora, sem espera", () => {
    // O caso do relato: Cambé pronta, criação automática desligada.
    expect(semCobrancaOQueFazer({ ...base, pronta: true, automatica: false })).toBe("gerar");
  });
  it("automática ligada: espera a cobrança nascer; passou do limite, oferece gerar", () => {
    expect(semCobrancaOQueFazer({ ...base, pronta: true, automatica: true })).toBe("esperar");
    expect(semCobrancaOQueFazer({ pronta: true, automatica: true, voltas: 24, maxVoltas: 24 })).toBe("gerar");
  });
  it("unidade que não cobra pelo Asaas: não espera nem oferece gerar", () => {
    expect(semCobrancaOQueFazer({ ...base, pronta: false, automatica: false })).toBe("fora_do_asaas");
    expect(semCobrancaOQueFazer({ ...base, pronta: false, automatica: true })).toBe("fora_do_asaas");
  });
  it("o meio da parcela vira o meio da cobrança; balcão e parcelado não geram cobrança avulsa", () => {
    expect(meioDaCobrancaNoAsaas("pix")).toBe("PIX");
    expect(meioDaCobrancaNoAsaas("boleto")).toBe("BOLETO");
    expect(meioDaCobrancaNoAsaas("cartao")).toBe("CREDIT_CARD");
    for (const m of ["dinheiro", "permuta", "cartao_parcelado", "cartao_parcelado_asaas", null]) {
      expect(meioDaCobrancaNoAsaas(m)).toBeNull();
    }
  });
});

describe("confirmar que recebeu, à mão (ponto 2)", () => {
  it("na unidade pronta, o meio do Asaas NÃO se confirma à mão (o caso do relato)", () => {
    for (const meio of ["cartao", "pix", "boleto", "cartao_parcelado_asaas"]) {
      expect(podeConfirmarAMao({ finalCents: 1000, meio, pronta: true })).toBe(false);
      expect(confirmacaoAMaoRecusada({ finalCents: 1000, meio, pronta: true, recebidoCents: 0, pagaPorFora: false })).toMatch(
        /quem confirma este pagamento é o Asaas/
      );
    }
  });
  it("na unidade sem Asaas, a pessoa confirma", () => {
    expect(podeConfirmarAMao({ finalCents: 1000, meio: "pix", pronta: false })).toBe(true);
    expect(confirmacaoAMaoRecusada({ finalCents: 1000, meio: "pix", pronta: false, recebidoCents: 0, pagaPorFora: false })).toBeNull();
  });
  it("venda sem valor confirma à mão em qualquer unidade", () => {
    expect(podeConfirmarAMao({ finalCents: 0, meio: "cartao", pronta: true })).toBe(true);
    expect(confirmacaoAMaoRecusada({ finalCents: 0, meio: "cartao", pronta: true, recebidoCents: 0, pagaPorFora: false })).toBeNull();
  });
  it("meio do balcão tem o botão próprio; o servidor não recusa a marca", () => {
    for (const meio of ["dinheiro", "permuta", "cartao_parcelado"]) {
      expect(podeConfirmarAMao({ finalCents: 1000, meio, pronta: true })).toBe(false);
      expect(confirmacaoAMaoRecusada({ finalCents: 1000, meio, pronta: true, recebidoCents: 0, pagaPorFora: false })).toBeNull();
    }
  });
  it("com dinheiro já recebido, ou cobrança paga por fora, a marca passa", () => {
    expect(confirmacaoAMaoRecusada({ finalCents: 1000, meio: "cartao", pronta: true, recebidoCents: 1000, pagaPorFora: false })).toBeNull();
    expect(confirmacaoAMaoRecusada({ finalCents: 1000, meio: "cartao", pronta: true, recebidoCents: 0, pagaPorFora: true })).toBeNull();
  });
  it("a recusa mora na ação de sempre (vale para o caixa e para a tela antiga)", () => {
    const acoes = readFileSync("src/app/(app)/comercial/venda-direta/actions.ts", "utf8");
    expect(acoes).toMatch(/step === "payment_confirmed" && value[\s\S]{0,300}recusaDaConfirmacaoAMao\(saleId\)/);
    // e vem ANTES de o banco marcar o passo
    expect(acoes.indexOf("recusaDaConfirmacaoAMao(saleId)")).toBeLessThan(acoes.indexOf('rpc("direct_sale_close_step"'));
  });
  it("o caixa não chama mais a confirmação sem pedir a confirmação da pessoa", () => {
    const caixa = readFileSync("src/components/venda-direta/caixa.tsx", "utf8");
    expect(caixa).toContain("Sim, recebi");
    expect(caixa).toContain("Quem confirma este pagamento é o Asaas");
    expect(caixa).not.toContain("Se a unidade\n                ainda não usa o Asaas, confirme aqui quando receber.");
  });
});

describe("débito ou crédito: o combinado (ponto 3)", () => {
  it("só débito e crédito são escolhas válidas", () => {
    expect(ehEscolhaDoCartao("debito")).toBe(true);
    expect(ehEscolhaDoCartao("credito")).toBe(true);
    for (const x of ["", null, undefined, "DEBIT_CARD", "pix"]) expect(ehEscolhaDoCartao(x)).toBe(false);
  });
  it("o resumo mostra o combinado; sem escolha, o rótulo do botão", () => {
    expect(rotuloDoMeioComEscolha("cartao", "debito")).toBe("Cartão de débito");
    expect(rotuloDoMeioComEscolha("cartao", "credito")).toBe("Cartão de crédito à vista");
    expect(rotuloDoMeioComEscolha("cartao", null)).toBe("Cartão à vista");
    expect(rotuloDoMeioComEscolha("pix", "debito")).toBe("Pix");
    expect(rotuloDoMeioComEscolha(null, null)).toBeNull();
  });
  it("o comprovante diz débito quando o Asaas informou débito", () => {
    const v = { nome: "Ana Lima", unidade: "Risarte", procedimentos: ["Consulta"], totalCents: 1000, parcelas: 1, data: "2026-11-27", codigo: "VD-00002" };
    expect(comprovanteDaVenda({ ...v, meio: "cartao", pagoNoDebito: true })).toContain("pago em cartão de débito");
    expect(comprovanteDaVenda({ ...v, meio: "cartao" })).toContain("pago em cartão de crédito");
    expect(comprovanteDaVenda({ ...v, meio: "pix", pagoNoDebito: true })).toContain("pago em Pix");
  });
  it("o caixa tem os dois botões e manda a escolha ao servidor", () => {
    const caixa = readFileSync("src/components/venda-direta/caixa.tsx", "utf8");
    expect(caixa).toMatch(/\["debito", "credito"\] as const/);
    expect(caixa).toContain('cardChoice: estado.meio === "cartao" ? estado.cartao : null');
    const acoes = readFileSync("src/app/(app)/comercial/venda-direta/caixa-actions.ts", "utf8");
    expect(acoes).toContain('rpc("direct_sale_set_card_choice", { p_sale_id: saleId, p_choice: escolha })');
  });
});

describe("o quadro final diz o estado real do dinheiro (ponto 4)", () => {
  it("o caso do relato: concluída sem recebimento — avisa, não comemora", () => {
    const f = fechoDaVenda({ finalCents: 1000, meio: "cartao", pagamento: pago({ abertoCents: 1000, parcelasAbertas: 1 }) });
    expect(f.tom).toBe("atencao");
    expect(f.texto).toContain("SEM recebimento registrado");
    expect(f.texto).toContain("R$ 10,00");
  });
  it("paga no débito pelo Asaas", () => {
    const f = fechoDaVenda({ finalCents: 1000, meio: "cartao", pagamento: pago({ recebidoCents: 1000, meioPagoNoAsaas: "DEBIT_CARD", escolhaDoCartao: "debito" }) });
    expect(f).toEqual({ tom: "ok", texto: "Venda concluída — R$ 10,00 recebidos no cartão de débito, pelo Asaas." });
  });
  it("combinado débito, pago no crédito: o quadro diz os dois", () => {
    const f = fechoDaVenda({ finalCents: 1000, meio: "cartao", pagamento: pago({ recebidoCents: 1000, meioPagoNoAsaas: "CREDIT_CARD", escolhaDoCartao: "debito" }) });
    expect(f.texto).toContain("no cartão de crédito, pelo Asaas (o combinado era débito)");
  });
  it("no balcão, pelo meio da venda", () => {
    expect(fechoDaVenda({ finalCents: 5000, meio: "dinheiro", pagamento: pago({ recebidoCents: 5000 }) }).texto).toBe(
      "Venda concluída — R$ 50,00 recebidos em dinheiro."
    );
  });
  it("parcelada: o recebido e o que falta", () => {
    const f = fechoDaVenda({ finalCents: 30000, meio: "boleto", pagamento: pago({ recebidoCents: 10000, abertoCents: 20000, parcelasAbertas: 2, meioPagoNoAsaas: "BOLETO" }) });
    expect(f.tom).toBe("ok");
    expect(f.texto).toBe("Venda concluída — R$ 100,00 recebidos por boleto, pelo Asaas. Faltam R$ 200,00 em 2 parcelas, em Recebíveis.");
  });
  it("sem valor: coberto pelo programa; sem a leitura das parcelas, não afirma valores", () => {
    expect(fechoDaVenda({ finalCents: 0, meio: null, pagamento: null }).texto).toContain("coberto pelo programa");
    expect(fechoDaVenda({ finalCents: 1000, meio: "pix", pagamento: null })).toEqual({
      tom: "ok",
      texto: "Venda concluída — termo assinado e pagamento confirmado.",
    });
  });
});
