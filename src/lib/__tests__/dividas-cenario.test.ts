import { describe, expect, it } from "vitest";
import { cenarioDeQuitacao } from "@/lib/finance/dividas-cenario";

// LEVANTAMENTO DE DÍVIDAS, FASE 7: o cenário "e se eu pagar à vista?" — só tela.
describe("cenário de quitação à vista", () => {
  const base = {
    hoje: "2026-11-15",
    dias: 30,
    saldoHojeCents: 10000,
    previstos: [
      { dia: "2026-11-20", entradaCents: 5000, saidaCents: 0 },
      { dia: "2026-11-25", entradaCents: 0, saidaCents: 3000 }, // inclui o título da dívida
      { dia: "2027-01-10", entradaCents: 99999, saidaCents: 0 }, // fora da janela
    ],
    titulos: [
      { vencimento: "2026-11-25", faltaCents: 3000 },
      { vencimento: "2026-10-01", faltaCents: 7000 }, // vencido: não está no previsto
    ],
    pagamento: { dia: "2026-11-16", valorCents: 8000 },
  };
  const c = cenarioDeQuitacao(base);
  it("sem acordo segue o previsto; à vista sai o valor e deixam de sair os títulos da janela", () => {
    expect(c.substituidosCents).toBe(3000);
    expect(c.sem.finalCents).toBe(10000 + 5000 - 3000);
    expect(c.com.finalCents).toBe(10000 + 5000 - 8000);
    expect(c.pontos.find((p) => p.dia === "2026-11-16")).toEqual({ dia: "2026-11-16", semCents: 10000, comCents: 2000 });
  });
  it("o menor saldo e o primeiro dia negativo", () => {
    expect(c.com).toMatchObject({ menorCents: 2000, diaDoMenor: "2026-11-16" });
    expect(c.negativoEm).toBeNull();
    const caro = cenarioDeQuitacao({ ...base, pagamento: { dia: "2026-11-16", valorCents: 12000 } });
    expect(caro.negativoEm).toBe("2026-11-16");
    expect(caro.negativoSemEm).toBeNull();
    expect(cenarioDeQuitacao({ ...base, saldoHojeCents: -1 }).negativoSemEm).toBe("2026-11-15");
  });
  it("data no passado: o pagamento sai hoje", () => {
    const x = cenarioDeQuitacao({ ...base, pagamento: { dia: "2026-11-01", valorCents: 1000 } });
    expect(x.pontos[0].comCents).toBe(9000);
  });
});
