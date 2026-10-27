import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ajusteDoItem,
  ajusteEfetivo,
  ajusteParaUmSo,
  precoNoPacote,
  temDistribuicaoPropria,
  totaisDoGrupo,
  totalDoLancamento,
} from "@/lib/procedimentos/grupos";

// DE ONDE SAI O DESCONTO DO PACOTE (0328, GP9, pedido do dono, 27/10/2026):
// um pouco de cada (como era), de um procedimento só, ou escolhido em cada um.

const ler = (rel: string) =>
  readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");

const precos: Record<string, number> = { canal: 95000, resina: 45000 };
const preco = (id: string) => precos[id] ?? 0;

describe("o percentual de cada procedimento", () => {
  it("o próprio vale; sem ele, o do grupo (a regra de plan_item_group_percent)", () => {
    expect(ajusteDoItem({ ajustePercent: -20 }, -10)).toBe(-20);
    expect(ajusteDoItem({ ajustePercent: null }, -10)).toBe(-10);
    expect(ajusteDoItem({}, -10)).toBe(-10);
    expect(ajusteDoItem({ ajustePercent: 0 }, -10)).toBe(0); // zero próprio = sem desconto neste
  });

  it("o total do pacote soma cada um com o seu percentual", () => {
    const itens = [
      { procedureId: "canal", quantidade: 1, ajustePercent: -14.74 },
      { procedureId: "resina", quantidade: 1, ajustePercent: null },
    ];
    const t = totaisDoGrupo(itens, preco, 0);
    expect(t.tabelaCents).toBe(140000);
    expect(t.pacoteCents).toBe(precoNoPacote(95000, -14.74) + 45000);
    expect(temDistribuicaoPropria(itens)).toBe(true);
    expect(temDistribuicaoPropria([{ ajustePercent: null }, {}])).toBe(false);
  });
});

describe("o desconto num procedimento só", () => {
  const itens = [
    { procedureId: "canal", quantidade: 1 },
    { procedureId: "resina", quantidade: 1 },
  ];

  it("o pacote de R$ 1.400 por R$ 1.260 tirando só do canal: −14,7368% no canal, e fecha NO CENTAVO", () => {
    const pct = ajusteParaUmSo(itens, preco, "canal", 126000)!;
    expect(pct).toBe(-14.7368); // 4 casas (com 2, saíam R$ 1.259,97 — achado na tela)
    const t = totaisDoGrupo([{ ...itens[0], ajustePercent: pct }, { ...itens[1], ajustePercent: null }], preco, 0);
    expect(t.pacoteCents).toBe(126000);
  });

  it("fecha no centavo em totais 'quebrados' também", () => {
    for (const alvo of [126001, 133337, 99999]) {
      const pct = ajusteParaUmSo(itens, preco, "canal", alvo)!;
      const t = totaisDoGrupo([{ ...itens[0], ajustePercent: pct }, itens[1]], preco, 0);
      expect(t.pacoteCents).toBe(alvo);
    }
  });

  it("tirando só da resina, o percentual dela é maior (o mesmo R$ sobre um preço menor)", () => {
    expect(ajusteParaUmSo(itens, preco, "resina", 126000)).toBe(-31.1111);
  });

  it("não fecha quando o desconto passa do preço do procedimento, ou o acréscimo do limite", () => {
    expect(ajusteParaUmSo(itens, preco, "resina", 90000)).toBeNull(); // R$ 500 de desconto numa resina de R$ 450
    expect(ajusteParaUmSo(itens, preco, "resina", 300000)).toBeNull(); // acréscimo > 100%
    expect(ajusteParaUmSo(itens, preco, "outro", 126000)).toBeNull();
  });

  it("o ajuste efetivo do pacote é o mesmo, de onde quer que saia", () => {
    const doCanal = ajusteEfetivo([{ ...itens[0], ajustePercent: -14.7368 }, itens[1]], preco, 0)!;
    expect(Math.round(doCanal)).toBe(-10);
  });

  it("o lançamento pelo botão Grupo usa o percentual de cada procedimento", () => {
    const linhas = [
      { procedureId: "canal", quantidade: 1, tooth: "36", faces: [], regionCode: null },
      { procedureId: "resina", quantidade: 1, tooth: "36", faces: [], regionCode: null },
    ];
    const pct = (id: string) => (id === "canal" ? -20 : 0);
    expect(totalDoLancamento(linhas, preco, pct)).toBe(76000 + 45000);
    expect(totalDoLancamento(linhas, preco, -10)).toBe(85500 + 40500); // a forma antiga continua
  });
});

describe("o banco e as telas", () => {
  const sql = ler("supabase/migrations/0328_desconto_do_pacote_por_procedimento.sql");

  it("a conta do banco usa o percentual do procedimento, senão o do grupo", () => {
    expect(sql).toMatch(/select coalesce\(gi\.price_adjust_percent, g\.price_adjust_percent\)/);
  });

  it("o percentual de cada procedimento tem 4 casas (no banco e na tela)", () => {
    expect(sql).toMatch(/alter column price_adjust_percent type numeric\(7,4\)/);
    expect(sql).toMatch(/set price_adjust_percent = round\(v_pct, 4\)/);
    expect(precoNoPacote(95000, -14.7368)).toBe(81000);
  });

  it("editar o grupo leva o percentual de quem fica", () => {
    expect(sql).toMatch(/jsonb_object_agg\(gi\.procedure_id::text, gi\.price_adjust_percent\)/);
    expect(sql).toMatch(/values \(v_id, v_proc, v_ordem, v_qtd, \(v_pcts ->> v_proc::text\)::numeric\)/);
  });

  it("só o Admin Master distribui; o mínimo confere o pacote efetivo", () => {
    const porta = sql.slice(sql.indexOf("function public.set_procedure_group_split("));
    expect(porta).toMatch(/if not public\.is_admin_master\(\) then\s+raise exception 'PRICE_NOT_ALLOWED'/);
    expect(porta).toMatch(/coalesce\(gi\.price_adjust_percent, round\(p_percent, 2\)\)/);
    expect(porta).toMatch(/raise exception 'MIN_ABOVE_PRICE'/);
  });

  it("a tela grava a distribuição, e o modo 'cada um' compara com a tabela × quantidade", () => {
    const tela = ler("src/app/(app)/procedimentos/grupos/preco-do-pacote.tsx");
    expect(tela).toMatch(/ajusteDoPreco\(c, preco\(i\.procedureId\) \* i\.quantidade\)/);
    expect(tela).toMatch(/ajusteParaUmSo\(itens, preco, umSo, totalUmSoCents\)/);
    const acoes = ler("src/app/(app)/procedimentos/grupos/actions.ts");
    expect(acoes).toMatch(/rpc\("set_procedure_group_split"/);
    expect(ler("src/app/(app)/prontuarios/[id]/lancar-grupo.tsx")).toMatch(/totalDoLancamento\(montagem\.linhas, precoDe, ajusteDe\)/);
    expect(ler("src/app/(app)/procedimentos/grupos/repasse-do-pacote.tsx")).toMatch(/ajusteDoItem\(i, ajustePercent\)/);
    expect(ler("src/lib/procedimentos/grupos-db.ts")).toMatch(/select\("group_id, procedure_id, price_adjust_percent"\)/);
  });
});
