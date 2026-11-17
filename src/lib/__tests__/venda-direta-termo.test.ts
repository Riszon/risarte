import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  corpoDoTermoDaVenda,
  fimDoTermo,
  meioPorExtenso,
  situacaoDoTermo,
  type DadosDoTermoDaVenda,
} from "@/lib/venda-direta-termo-texto";

const base: DadosDoTermoDaVenda = {
  codigo: "VD-00001",
  cliente: "Cliente de Teste",
  responsavel: null,
  unidade: "Clínica Teste Ltda",
  data: "2026-11-16",
  itens: [{ descricao: "Limpeza", quantidade: 1, valor: 18000 }],
  subtotal: 18000,
  descontoDoPrograma: 0,
  programa: null,
  desconto: 1800,
  acrescimo: 0,
  total: 16200,
  meio: "pix",
  parcelas: [{ vencimento: "2026-11-16", valor: 16200, meio: "pix" }],
  cidade: "Londrina",
};

const texto = (d: DadosDoTermoDaVenda) => {
  const b = corpoDoTermoDaVenda(d);
  return [b.preamble, ...b.sections.map((s) => `${s.title}\n${s.body}`), b.closing].join("\n");
};

describe("o texto do termo da venda direta", () => {
  it("diz quem, o que, quanto e como paga", () => {
    const t = texto(base);
    expect(t).toContain("VD-00001");
    expect(t).toContain("Clínica Teste Ltda");
    expect(t).toContain("Cliente de Teste");
    expect(t).toContain("Limpeza");
    expect(t).toMatch(/Total: R\$\s?162,00/);
    expect(t).toMatch(/Desconto: − R\$\s?18,00/);
    expect(t).toContain("À vista, em Pix");
    expect(t).toContain("16/11/2026");
    expect(t).toContain("comarca de Londrina");
  });

  it("menor de idade: quem assina é o responsável", () => {
    expect(texto({ ...base, responsavel: "Mãe de Teste" })).toContain(
      "Mãe de Teste, responsável por Cliente de Teste"
    );
  });

  it("parcelado: uma linha por parcela, com o meio de cada uma", () => {
    const t = texto({
      ...base,
      desconto: 0,
      total: 18000,
      parcelas: [
        { vencimento: "2026-11-16", valor: 9000, meio: "pix" },
        { vencimento: "2026-12-16", valor: 9000, meio: "boleto" },
      ],
    });
    expect(t).toMatch(/1ª parcela, vencimento 16\/11\/2026: R\$\s?90,00 — Pix/);
    expect(t).toMatch(/2ª parcela, vencimento 16\/12\/2026: R\$\s?90,00 — Boleto/);
  });

  it("R$ 0,00 pelo programa: diz que não há valor a pagar", () => {
    const t = texto({
      ...base,
      descontoDoPrograma: 18000,
      programa: "Empresarial",
      desconto: 0,
      total: 0,
      parcelas: [],
    });
    expect(t).toContain("Sem valor a pagar");
    expect(t).toContain("Benefício do programa Empresarial");
  });

  it("os meios em palavras", () => {
    expect(meioPorExtenso("dinheiro")).toBe("Dinheiro");
    expect(meioPorExtenso("cartao_parcelado_asaas")).toBe("Cartão de crédito parcelado");
    expect(meioPorExtenso(null)).toBe("—");
  });
});

describe("em que ponto o termo está", () => {
  it("assinado: diz de onde veio", () => {
    expect(situacaoDoTermo({ contractSigned: true, contractSignedSource: "assinatura_digital", packageStatus: "signed" })).toBe("assinado_digital");
    expect(situacaoDoTermo({ contractSigned: true, contractSignedSource: "papel", packageStatus: null })).toBe("assinado_papel");
    expect(situacaoDoTermo({ contractSigned: true, contractSignedSource: null, packageStatus: null })).toBe("assinado");
  });
  it("enviado e não assinado: aguardando", () => {
    for (const st of ["draft", "sent", "partially_signed"])
      expect(situacaoDoTermo({ contractSigned: false, contractSignedSource: null, packageStatus: st })).toBe("aguardando");
  });
  it("recusado, vencido ou cancelado: dá para mandar outro, e a tela diz por quê", () => {
    for (const st of ["refused", "expired", "cancelled"]) {
      expect(situacaoDoTermo({ contractSigned: false, contractSignedSource: null, packageStatus: st })).toBe("sem_termo");
      expect(fimDoTermo(st)).toBeTruthy();
    }
    expect(situacaoDoTermo({ contractSigned: false, contractSignedSource: null, packageStatus: null })).toBe("sem_termo");
    expect(fimDoTermo(null)).toBeNull();
  });
});

describe("réguas da 0415", () => {
  const sql = readFileSync("supabase/migrations/0415_venda_direta_termo_assinado.sql", "utf8");

  it("a trava do termo existe no banco e só deixa passar ZapSign ou papel", () => {
    expect(sql).toContain("raise exception 'PAPER_REQUIRED'");
    expect(sql).toMatch(/contract_signed_source, ''\) = 'assinatura_digital'/);
    expect(sql).toMatch(/contract_signed_source, ''\) = 'papel'[\s\S]*contract_paper_path/);
  });

  it("assinou na ZapSign → o gatilho marca a venda (sem o app)", () => {
    expect(sql).toMatch(/create trigger signature_packages_direct_sale_signed[\s\S]*after update of status on public\.signature_packages/);
    expect(sql).toContain("perform public._direct_sale_mark_signed(new.id);");
  });

  it("quem envia o termo é quem fecha a venda (V1), sem a permissão geral", () => {
    expect(sql).toMatch(/function public\.direct_sale_term_package[\s\S]*direct_sale_can_close\(v_sale\.clinic_id\)/);
    const envio = readFileSync("src/lib/signatures/send.ts", "utf8");
    expect(envio).toContain('pkg.origin_type === "direct_sale"');
    expect(envio).toContain("direct_sale_can_handle_term");
  });

  it("o caixa não marca o termo à mão quando a 0415 está no banco", () => {
    const caixa = readFileSync("src/components/venda-direta/caixa.tsx", "utf8");
    // O botão antigo só existe no ramo "sem a 0415" (termo ausente).
    const ramoAntigo = caixa.indexOf("Banco sem a 0415");
    const marcaAMao = caixa.indexOf('closeDirectSaleStep(venda.id, "contract", true)');
    expect(ramoAntigo).toBeGreaterThan(0);
    expect(marcaAMao).toBeGreaterThan(ramoAntigo);
  });

  it("cancelar a venda leva o termo da ZapSign junto", () => {
    const actions = readFileSync("src/app/(app)/comercial/venda-direta/actions.ts", "utf8");
    expect(actions).toContain("cancelarTermoDaVenda(saleId)");
  });
});
