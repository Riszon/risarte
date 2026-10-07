import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repartirTempo } from "@/lib/planning";

// OC-00087 (07/10/2026). O Planner pediu duas coisas no cockpit — configurar
// "Atendimentos e sequência" de TODAS as opções e ajustar o tempo do
// atendimento inteiro — e o diagnóstico achou uma terceira, maior: as sessões
// do tratamento saíam da opção PRINCIPAL mesmo quando o cliente comprava a
// alternativa.

const soma = (l: number[]) => l.reduce((a, b) => a + b, 0);

describe("repartir o tempo do atendimento entre as sessões", () => {
  it("o caso do relato: 10 sessões de 60 min num atendimento de 240", () => {
    const r = repartirTempo(240, Array(10).fill(60))!;
    expect(r).toHaveLength(10);
    expect(soma(r)).toBe(240);
    expect(r.every((m) => m === 24)).toBe(true);
  });

  it("reparte na PROPORÇÃO do tempo de cada sessão", () => {
    // 90 + 30 = 120 → em 60 minutos, a de 90 fica com o triplo da de 30.
    const r = repartirTempo(60, [90, 30])!;
    expect(soma(r)).toBe(60);
    expect(r[0]).toBeGreaterThan(r[1] * 2);
  });

  it("a soma fecha EXATAMENTE no total; a última absorve a sobra", () => {
    const r = repartirTempo(100, [60, 60, 60])!;
    expect(soma(r)).toBe(100);
    expect(r[2]).toBeGreaterThanOrEqual(r[0]);
    for (const total of [7, 13, 61, 199, 1000]) {
      expect(soma(repartirTempo(total, [45, 20, 20, 15, 30, 10, 5])!)).toBe(total);
    }
  });

  it("sessões sem tempo definido: partes iguais", () => {
    expect(repartirTempo(90, [null, null, null])).toEqual([30, 30, 30]);
    expect(soma(repartirTempo(91, [null, undefined, 0])!)).toBe(91);
  });

  it("toda sessão fica com pelo menos 1 minuto (zero voltaria ao padrão do procedimento)", () => {
    const r = repartirTempo(5, [600, 1, 1, 1, 1])!;
    expect(soma(r)).toBe(5);
    expect(r.every((m) => m >= 1)).toBe(true);
  });

  it("não reparte o que não dá: total menor que o nº de sessões, vazio ou inválido", () => {
    expect(repartirTempo(2, [60, 60, 60])).toBeNull();
    expect(repartirTempo(0, [60])).toBeNull();
    expect(repartirTempo(-30, [60, 60])).toBeNull();
    expect(repartirTempo(Number.NaN, [60, 60])).toBeNull();
    expect(repartirTempo(60, [])).toBeNull();
  });

  it("minuto quebrado é arredondado para baixo, nunca vira fração", () => {
    const r = repartirTempo(90.9, [60, 60])!;
    expect(soma(r)).toBe(90);
    expect(r.every(Number.isInteger)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RÉGUAS
// ---------------------------------------------------------------------------

const RAIZ = process.cwd();
const ler = (c: string) => readFileSync(join(RAIZ, c), "utf8").replace(/\r\n/g, "\n");

describe("régua: o cockpit configura a sequência de TODAS as opções", () => {
  const pagina = ler("src/app/(app)/planejamento/[clientId]/page.tsx");

  it("projeta as sessões de cada opção do plano, não só da principal", () => {
    expect(pagina).toMatch(/sessions: await projectOptionSessions\(o\.id\)/);
    expect(pagina).not.toMatch(/projectOptionSessions\(summaryOption\.id\)/);
  });

  it("entrega todas à tela, com o seletor de opção", () => {
    expect(pagina).toMatch(/<SequenciaPorOpcao\s+opcoes=\{sequencias\}/);
  });
});

describe("régua: as sessões do tratamento saem da opção que o cliente COMPROU", () => {
  const pasta = join(RAIZ, "supabase/migrations");
  // Só a faixa do núcleo (0000–0999): é ele o dono destas funções.
  const migracoes = readdirSync(pasta)
    .filter((f) => /^0\d{3}_.*\.sql$/.test(f))
    .sort();

  /** O corpo da definição MAIS RECENTE da função — é a que vale no banco. */
  function definicaoVigente(nome: string): { arquivo: string; corpo: string } {
    const assinatura = `create or replace function public.${nome}(`;
    const comela = migracoes.filter((f) =>
      readFileSync(join(pasta, f), "utf8").includes(assinatura)
    );
    if (comela.length === 0) throw new Error(`régua cega: ${nome} não foi encontrada`);
    const arquivo = comela[comela.length - 1];
    const sql = readFileSync(join(pasta, arquivo), "utf8").replace(/\r\n/g, "\n");
    const inicio = sql.lastIndexOf(assinatura);
    const D = "$" + "$";
    const abre = sql.indexOf(D, inicio);
    const fecha = sql.indexOf(D, abre + 2);
    return { arquivo, corpo: sql.slice(abre, fecha) };
  }

  it.each(["ensure_treatment_sessions", "topup_treatment_sessions"])(
    "%s lê a negociação aceita e respeita a compra parcial",
    (nome) => {
      const { arquivo, corpo } = definicaoVigente(nome);
      expect(corpo.length, `corpo vazio em ${arquivo}`).toBeGreaterThan(500);
      // A opção vem da venda…
      expect(corpo, arquivo).toMatch(/from public\.plan_negotiations n/);
      expect(corpo, arquivo).toMatch(/n\.status = 'aceita'/);
      // …e o que o cliente deixou de fora não vira sessão.
      expect(corpo, arquivo).toMatch(/from public\.plan_negotiation_items ni/);
      expect(corpo, arquivo).toMatch(/ni\.included = false/);
    }
  );
});
