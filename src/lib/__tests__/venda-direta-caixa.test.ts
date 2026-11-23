import { describe, expect, it } from "vitest";
import {
  atalhosDoCaixa,
  atendidoAntesDaVenda,
  atendimentoPadrao,
  etapaDoCaixa,
  meioInicial,
  meiosDoCaixa,
  oQueFalta,
  parcelasAoTrocarDeMeio,
  parcelasDoMeio,
  percentualDoPlano,
  previaDoCaixa,
  recebidoNoBalcao,
  SELO_DA_VENDA,
  type RegraDoCaixa,
} from "@/lib/venda-direta-caixa";
import { isoDateIn, BRAZIL_TIME_ZONE } from "@/lib/dates";
import { readFileSync } from "node:fs";

const diaDe = (d: Date) => isoDateIn(d, BRAZIL_TIME_ZONE);
// 16/11/2026, 14h05 no Brasil.
const agora = new Date("2026-11-16T17:05:00Z");

const regra: RegraDoCaixa = {
  maxInstallments: 6,
  allowedMethods: null,
  minInstallmentByMethod: { boleto: 10000 },
};
const recepcao = { isManager: false, cardMachine: true };

describe("atendimento que já vem escolhido", () => {
  it("escolhe o de hoje mais perto de agora", () => {
    const id = atendimentoPadrao(
      [
        { id: "ontem", startsAt: "2026-11-15T17:00:00Z", status: "completed" },
        { id: "manha", startsAt: "2026-11-16T12:00:00Z", status: "completed" },
        { id: "agora", startsAt: "2026-11-16T17:00:00Z", status: "confirmed" },
      ],
      agora,
      diaDe
    );
    expect(id).toBe("agora");
  });

  it("sem atendimento hoje, não escolhe nenhum", () => {
    expect(
      atendimentoPadrao(
        [{ id: "ontem", startsAt: "2026-11-15T17:00:00Z", status: "completed" }],
        agora,
        diaDe
      )
    ).toBe("");
  });

  it("cancelado e falta não contam", () => {
    expect(
      atendimentoPadrao(
        [
          { id: "c", startsAt: "2026-11-16T17:00:00Z", status: "cancelled" },
          { id: "f", startsAt: "2026-11-16T17:00:00Z", status: "no_show" },
        ],
        agora,
        diaDe
      )
    ).toBe("");
  });

  it("21h30 no Brasil ainda é hoje (em UTC já virou o dia)", () => {
    const noite = new Date("2026-11-17T00:30:00Z");
    expect(
      atendimentoPadrao(
        [{ id: "x", startsAt: "2026-11-16T23:00:00Z", status: "scheduled" }],
        noite,
        diaDe
      )
    ).toBe("x");
  });
});

describe("exceção: atendeu antes de vender", () => {
  it("paciente na clínica, atendimento de hoje em andamento: não é exceção", () => {
    // Era o defeito do pop-up antigo: 14h05 com horário das 14h já marcava.
    expect(
      atendidoAntesDaVenda(
        { id: "a", startsAt: "2026-11-16T17:00:00Z", status: "confirmed" },
        agora,
        diaDe
      )
    ).toBe(false);
  });
  it("atendimento concluído: é exceção", () => {
    expect(
      atendidoAntesDaVenda(
        { id: "a", startsAt: "2026-11-16T17:00:00Z", status: "completed" },
        agora,
        diaDe
      )
    ).toBe(true);
  });
  it("atendimento de dia anterior: é exceção", () => {
    expect(
      atendidoAntesDaVenda(
        { id: "a", startsAt: "2026-11-15T17:00:00Z", status: "scheduled" },
        agora,
        diaDe
      )
    ).toBe(true);
  });
  it("atendimento futuro: não é exceção", () => {
    expect(
      atendidoAntesDaVenda(
        { id: "a", startsAt: "2026-11-20T17:00:00Z", status: "scheduled" },
        agora,
        diaDe
      )
    ).toBe(false);
  });
});

describe("prévia do total (espelho do servidor)", () => {
  const base = {
    subtotalCents: 18000,
    programDiscountCents: 0,
    coveredCents: 0,
    rule: { cashDiscountPercent: 10, maxDiscountPercent: 15 },
    parcelas: 1,
    meio: "pix",
    isProgramMember: false,
    plano: null,
    descontoManualCents: 0,
    acrescimoCents: 0,
  };

  it("à vista no Pix: o automático da regra entra sozinho", () => {
    const p = previaDoCaixa(base);
    expect(p.discountCents).toBe(1800);
    expect(p.finalCents).toBe(16200);
    expect(p.isAuto).toBe(true);
    expect(p.origem).toBe("avista");
  });

  it("parcelado: sem automático", () => {
    const p = previaDoCaixa({ ...base, parcelas: 2, meio: "boleto" });
    expect(p.discountCents).toBe(0);
    expect(p.finalCents).toBe(18000);
    expect(p.origem).toBeNull();
  });

  it("cartão à vista (4027): sem automático; o manual vale", () => {
    expect(previaDoCaixa({ ...base, meio: "cartao" }).finalCents).toBe(18000);
    const p = previaDoCaixa({ ...base, meio: "cartao", descontoManualCents: 1000 });
    expect(p.finalCents).toBe(17000);
    expect(p.origem).toBe("manual");
  });

  it("permuta à vista: sem automático", () => {
    expect(previaDoCaixa({ ...base, meio: "permuta" }).finalCents).toBe(18000);
  });

  it("o manual maior que o automático prevalece", () => {
    const p = previaDoCaixa({ ...base, descontoManualCents: 2500 });
    expect(p.discountCents).toBe(2500);
    expect(p.isAuto).toBe(false);
    expect(p.origem).toBe("manual");
  });

  it("cliente de programa (Empresarial): sem automático à vista", () => {
    const p = previaDoCaixa({
      ...base,
      isProgramMember: true,
      programDiscountCents: 5000,
    });
    expect(p.discountCents).toBe(0);
    expect(p.finalCents).toBe(13000);
  });

  it("PPR+: a faixa do plano, só sobre o que não tem benefício", () => {
    const plano = {
      cashDiscountPercent: 10,
      tiers: [{ upToInstallments: 6, discountPercent: 5 }],
    };
    // 300 de tabela, 100 de benefício num item que ficou em 50 (coberto).
    const entrada = {
      ...base,
      subtotalCents: 30000,
      programDiscountCents: 10000,
      coveredCents: 5000,
      plano,
      descontoManualCents: 9999, // ignorado de propósito
    };
    const avista = previaDoCaixa(entrada);
    expect(avista.discountCents).toBe(1500); // 10% de (200 − 50)
    expect(avista.finalCents).toBe(18500);
    expect(avista.origem).toBe("plano");
    const em3 = previaDoCaixa({ ...entrada, parcelas: 3 });
    expect(em3.discountCents).toBe(750);
    const em12 = previaDoCaixa({ ...entrada, parcelas: 12 });
    expect(em12.discountCents).toBe(0);
    expect(percentualDoPlano(plano, 12)).toBe(0);
  });

  it("acréscimo soma no fim", () => {
    const p = previaDoCaixa({
      ...base,
      parcelas: 2,
      meio: "boleto",
      acrescimoCents: 1000,
    });
    expect(p.finalCents).toBe(19000);
  });
});

describe("meios e parcelas do caixa", () => {
  it("o Pix vem marcado; sem Pix, o primeiro permitido", () => {
    expect(meioInicial(meiosDoCaixa(regra, recepcao))).toBe("pix");
    const semPix: RegraDoCaixa = { ...regra, allowedMethods: ["boleto"] };
    const meios = meiosDoCaixa(semPix, recepcao);
    expect(meios).toEqual(["boleto"]);
    expect(meioInicial(meios)).toBe("boleto");
    expect(meioInicial([])).toBe("");
  });

  it("permuta só para o Gerente; maquininha só com a chave ligada", () => {
    expect(meiosDoCaixa(regra, recepcao)).not.toContain("permuta");
    expect(meiosDoCaixa(regra, { isManager: true, cardMachine: true })).toContain(
      "permuta"
    );
    expect(
      meiosDoCaixa(regra, { isManager: false, cardMachine: false })
    ).not.toContain("cartao_parcelado");
  });

  it("o botão Cartão à vista (4027): só 1×; parcelar é o Cartão parcelado", () => {
    expect(meiosDoCaixa(regra, recepcao)).toContain("cartao");
    expect(parcelasDoMeio("cartao", regra, recepcao, () => 18000).map((x) => x.parcelas)).toEqual([1]);
  });

  it("Pix: à vista e parcelado, até o máximo da regra", () => {
    const o = parcelasDoMeio("pix", regra, recepcao, () => 18000);
    expect(o.map((x) => x.parcelas)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(o[2]).toEqual({ parcelas: 3, totalCents: 18000, parcelaCents: 6000 });
  });

  it("boleto: não tem à vista e respeita a parcela mínima", () => {
    // mínimo de R$ 100,00 por parcela → R$ 180,00 não cabe em 2×.
    expect(parcelasDoMeio("boleto", regra, recepcao, () => 18000)).toEqual([]);
    const o = parcelasDoMeio("boleto", regra, recepcao, () => 45000);
    expect(o.map((x) => x.parcelas)).toEqual([2, 3, 4]);
  });

  it("o total de cada opção usa o desconto daquela quantidade", () => {
    const o = parcelasDoMeio("pix", regra, recepcao, (n) =>
      n === 1 ? 16200 : 18000
    );
    expect(o[0].totalCents).toBe(16200);
    expect(o[1]).toEqual({ parcelas: 2, totalCents: 18000, parcelaCents: 9000 });
  });

  it("trocar de meio: mantém as parcelas se valem, senão a menor possível", () => {
    const boleto = parcelasDoMeio("boleto", regra, recepcao, () => 45000);
    expect(parcelasAoTrocarDeMeio(1, boleto)).toBe(2);
    expect(parcelasAoTrocarDeMeio(3, boleto)).toBe(3);
    expect(parcelasAoTrocarDeMeio(1, [])).toBe(1);
  });

  it("o que é recebido no balcão", () => {
    expect(recebidoNoBalcao("dinheiro")).toBe(true);
    expect(recebidoNoBalcao("permuta")).toBe(true);
    expect(recebidoNoBalcao("cartao_parcelado")).toBe(true);
    expect(recebidoNoBalcao("pix")).toBe(false);
    expect(recebidoNoBalcao("boleto")).toBe(false);
    expect(recebidoNoBalcao(null)).toBe(false);
  });
});

describe("atalhos", () => {
  const procs = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  it("os mais vendidos primeiro; completa pelo catálogo", () => {
    expect(
      atalhosDoCaixa(procs, { c: 9, b: 2, fora: 50 }, 3).map((p) => p.id)
    ).toEqual(["c", "b", "a"]);
  });
  it("sem venda nenhuma, a ordem do catálogo", () => {
    expect(atalhosDoCaixa(procs, {}, 2).map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("onde a venda parou", () => {
  const v = {
    cancelled: false,
    closed: false,
    finalCents: 18000,
    paymentMethod: "pix" as string | null,
    contractSigned: false,
    paymentConfirmed: false,
  };
  it("sem forma de pagamento: falta o pagamento", () => {
    const s = { ...v, paymentMethod: null };
    expect(etapaDoCaixa(s)).toBe("pagamento");
    expect(oQueFalta(s)).toBe("falta definir o pagamento");
  });
  it("R$ 0,00 pelo programa: pula o pagamento", () => {
    expect(etapaDoCaixa({ ...v, finalCents: 0, paymentMethod: null })).toBe(
      "fechamento"
    );
  });
  it("o que falta no fechamento", () => {
    expect(oQueFalta(v)).toBe("falta assinar e receber");
    expect(oQueFalta({ ...v, contractSigned: true })).toBe("falta receber");
    expect(oQueFalta({ ...v, paymentConfirmed: true })).toBe("falta assinar");
  });
  it("concluída e cancelada", () => {
    expect(etapaDoCaixa({ ...v, closed: true })).toBe("concluida");
    expect(
      etapaDoCaixa({ ...v, contractSigned: true, paymentConfirmed: true })
    ).toBe("concluida");
    expect(etapaDoCaixa({ ...v, cancelled: true, closed: true })).toBe(
      "cancelada"
    );
  });
});

describe("selo da situação nas telas de servidor", () => {
  it("toda situação tem rótulo", () => {
    for (const s of Object.values(SELO_DA_VENDA)) {
      expect(s.rotulo.length).toBeGreaterThan(0);
      expect(s.estilo.length).toBeGreaterThan(0);
    }
  });
  it("o prontuário (servidor) não lê o selo do arquivo de navegador", () => {
    // Constante de módulo "use client" chega vazia à página: o selo saía em branco.
    const pagina = readFileSync(
      "src/app/(app)/prontuarios/[id]/page.tsx",
      "utf8"
    );
    expect(pagina).not.toMatch(/DIRECT_SALE_STATUS_(LABEL|STYLE)/);
    expect(pagina).toContain("SELO_DA_VENDA[s.status].rotulo");
  });
});
