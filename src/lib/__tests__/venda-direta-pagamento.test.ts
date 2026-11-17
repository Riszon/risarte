import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  cobrancaDaVez,
  cobrancaParaNascer,
  comprovanteDaVenda,
  esperandoOAsaas,
  type ParcelaParaJanela,
} from "@/lib/venda-direta-caixa";

const c = (status: string, extra: Partial<NonNullable<ParcelaParaJanela["cobranca"]>> = {}) => ({
  status,
  pix: "00020126PIX",
  link: "https://sandbox.asaas.com/i/x",
  linha: null,
  meio: "pix",
  valor: 16200,
  ...extra,
});
const p = (seq: number, situacao: string, cobranca: ParcelaParaJanela["cobranca"], parcelado = false): ParcelaParaJanela => ({
  seq,
  situacao_parcela: situacao,
  parcelado,
  cobranca,
});

describe("a cobrança da vez (o que aparece em destaque)", () => {
  it("a 1ª parcela aberta com cobrança viva", () => {
    const r = cobrancaDaVez([p(2, "em_aberto", c("emitida")), p(1, "em_aberto", c("emitida"))]);
    expect(r?.seq).toBe(1);
  });
  it("pula a paga e a cancelada; a vencida ainda vale", () => {
    const r = cobrancaDaVez([
      p(1, "paga", c("paga")),
      p(2, "cancelada", c("cancelada")),
      p(3, "em_aberto", c("vencida")),
    ]);
    expect(r?.seq).toBe(3);
  });
  it("cobrança sendo criada, sem cobrança ou do cartão parcelado: nada em destaque", () => {
    expect(cobrancaDaVez([p(1, "em_aberto", c("emitindo"))])).toBeNull();
    expect(cobrancaDaVez([p(1, "em_aberto", null)])).toBeNull();
    expect(cobrancaDaVez([p(1, "em_aberto", c("emitida"), true)])).toBeNull();
  });
});

describe("a janela continua conferindo o pagamento?", () => {
  it("sim, enquanto há cobrança sendo criada ou esperando", () => {
    expect(esperandoOAsaas([p(1, "em_aberto", c("emitindo"))])).toBe(true);
    expect(esperandoOAsaas([p(1, "em_aberto", c("emitida"))])).toBe(true);
    expect(esperandoOAsaas([p(1, "em_aberto", c("vencida"))])).toBe(true);
  });
  it("não, quando pagou, não tem cobrança ou é fora do Asaas", () => {
    expect(esperandoOAsaas([p(1, "paga", c("paga"))])).toBe(false);
    expect(esperandoOAsaas([p(1, "em_aberto", null)])).toBe(false);
    expect(esperandoOAsaas([])).toBe(false);
  });
});

describe("logo depois da assinatura, a cobrança ainda nasce", () => {
  const sem = (extra: Partial<ParcelaParaJanela> = {}): ParcelaParaJanela => ({
    seq: 1,
    situacao_parcela: "em_aberto",
    pelo_asaas: true,
    agendada_para: null,
    cobranca: null,
    ...extra,
  });
  it("parcela do Asaas, aberta, sem cobrança e sem agendamento: espera", () => {
    expect(cobrancaParaNascer([sem()], "2026-11-17")).toBe(true);
  });
  it("não espera: fora do Asaas, agendada para depois, já com cobrança, paga ou do parcelado", () => {
    const H = "2026-11-17";
    expect(cobrancaParaNascer([sem({ pelo_asaas: false })], H)).toBe(false);
    expect(cobrancaParaNascer([sem({ agendada_para: "2026-12-10" })], H)).toBe(false);
    expect(cobrancaParaNascer([sem({ cobranca: c("emitida") })], H)).toBe(false);
    expect(cobrancaParaNascer([sem({ situacao_parcela: "paga" })], H)).toBe(false);
    expect(cobrancaParaNascer([sem({ parcelado: true })], H)).toBe(false);
  });
  it("'agendada para hoje' (o banco diz isso enquanto ela não nasceu) espera", () => {
    // Visto no teste de 17/11/2026: logo após a assinatura a parcela vinha
    // "Agendada para 17/11" e a janela parava de conferir.
    expect(cobrancaParaNascer([sem({ agendada_para: "2026-11-17" })], "2026-11-17")).toBe(true);
    expect(cobrancaParaNascer([sem({ agendada_para: "2026-11-16" })], "2026-11-17")).toBe(true);
  });
});

describe("o comprovante pelo WhatsApp (texto aprovado, P2)", () => {
  const base = {
    nome: "Maria da Silva",
    unidade: "Risarte Londrina",
    procedimentos: ["Limpeza"],
    totalCents: 16200,
    meio: "pix",
    parcelas: 1,
    data: "2026-11-17",
    codigo: "VD-00031",
  };
  it("o texto aprovado, com o primeiro nome", () => {
    expect(comprovanteDaVenda(base)).toBe(
      "Olá, Maria! Sua compra na Risarte Londrina está confirmada. Limpeza — total R$ 162,00, pago em Pix em 17/11/2026. Código VD-00031. Obrigado!"
    );
  });
  it("vários procedimentos viram uma lista com 'e'", () => {
    expect(comprovanteDaVenda({ ...base, procedimentos: ["Limpeza", "Clareamento", "Raio-X"] })).toContain(
      "Limpeza, Clareamento e Raio-X — total"
    );
  });
  it("parcelado diz em quantas vezes", () => {
    expect(comprovanteDaVenda({ ...base, meio: "boleto", parcelas: 3 })).toContain("pago em boleto, em 3× em");
  });
  it("R$ 0,00 pelo programa não diz 'pago em'", () => {
    const t = comprovanteDaVenda({ ...base, totalCents: 0 });
    expect(t).toContain("sem custo (coberto pelo programa)");
    expect(t).not.toContain("pago em");
  });
  it("sem código, sem a frase do código", () => {
    expect(comprovanteDaVenda({ ...base, codigo: null })).not.toContain("Código");
  });
});

describe("réguas da VD3-3 na tela", () => {
  const pagamento = readFileSync("src/components/venda-direta/pagamento.tsx", "utf8");
  const caixa = readFileSync("src/components/venda-direta/caixa.tsx", "utf8");
  it("o QR é desenhado na tela a partir do copia e cola (P1, sem chamada ao Asaas)", () => {
    expect(pagamento).toContain('import QRCode from "qrcode"');
    expect(pagamento).toContain("QRCode.toDataURL(payload");
    expect(pagamento).not.toMatch(/pixQrCode|getPixPayload/);
  });
  it("a janela espera a cobrança nascer por um tempo limitado", () => {
    expect(pagamento).toMatch(/cobrancaParaNascer\(parcelas, todayInBrazil\(\)\) && voltas < MAX_ESPERA_DO_NASCIMENTO/);
  });
  it("a janela confere sozinha e relê a venda quando a baixa entra", () => {
    expect(pagamento).toMatch(/setInterval\(\(\) => \{[\s\S]*?void carregar\(\);[\s\S]*?\}, ESPERA_MS\)/);
    expect(pagamento).toMatch(/pagas > pagosAntes\.current\) await atualizar\(\)/);
  });
  it("o caixa usa o pagamento ao vivo e oferece o comprovante na venda concluída", () => {
    expect(caixa).toContain("<PagamentoPeloAsaas");
    expect(caixa).toContain("<BotaoComprovante venda={venda} dados={dados} />");
  });
});

describe("o QR aparece para o Pix gravado pelo Asaas", () => {
  it("o meio da cobrança vem em maiúsculas (PIX) e a tela aceita os dois", () => {
    // Visto no teste de 17/11/2026: a cobrança vinha "PIX" e o QR não aparecia.
    const pagamento = readFileSync("src/components/venda-direta/pagamento.tsx", "utf8");
    expect(pagamento).toContain('(meio ?? "").toLowerCase() === "pix"');
    expect(pagamento).not.toMatch(/c\.meio === "pix"/);
  });
});

describe("uma leitura que falha não apaga a cobrança da tela", () => {
  it("sem dados, a janela mantém o que tinha e segue conferindo", () => {
    // Visto no teste de 17/11/2026: a leitura estourou o tempo na hora da baixa.
    const pagamento = readFileSync("src/components/venda-direta/pagamento.tsx", "utf8");
    const corpo = pagamento.slice(pagamento.indexOf("const aplicar = useCallback"), pagamento.indexOf("const carregar = useCallback"));
    expect(corpo).toMatch(/if \(!d\) return;\s*setDados\(d\);/);
  });
});
