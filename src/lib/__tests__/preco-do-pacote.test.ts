import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ajusteDoTotal,
  ajusteValido,
  mensagemDoGrupo,
  pacotesDaOpcao,
  precoNoPacote,
  rotuloDoPacote,
  textoDoAjuste,
  totaisDoGrupo,
  totalDoLancamento,
} from "@/lib/procedimentos/grupos";

// O PREÇO DO GRUPO (0325, pedido do dono, 27/10/2026). Decisões GP4–GP6:
// vale no plano, o grupo guarda o PERCENTUAL, o paciente vê "de … por …".

const ler = (rel: string) =>
  readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");

describe("a conta do pacote (a mesma do banco)", () => {
  it("meio para cima, item a item — os casos do ensaio da 0325", () => {
    expect(precoNoPacote(33333, -10)).toBe(30000); // 29.999,7
    expect(precoNoPacote(15, -50)).toBe(8); // 7,5
    expect(precoNoPacote(45000, 15)).toBe(51750);
    expect(precoNoPacote(45000, 0)).toBe(45000);
    expect(precoNoPacote(12345, -12.5)).toBe(10802); // 10.801,875
    expect(precoNoPacote(60965, 33.33)).toBe(81285); // 81.284,6345
  });

  it("o total digitado vira percentual com 2 casas", () => {
    expect(ajusteDoTotal(540000, 600000)).toBe(-10);
    expect(ajusteDoTotal(690000, 600000)).toBe(15);
    expect(ajusteDoTotal(600000, 600000)).toBe(0);
    expect(ajusteDoTotal(100000, 300000)).toBe(-66.67);
    expect(ajusteDoTotal(100, 0)).toBeNull();
  });

  it("limites do banco: desconto abaixo de 100%, acréscimo até 100%", () => {
    expect(ajusteValido(-99.99)).toBe(true);
    expect(ajusteValido(-100)).toBe(false);
    expect(ajusteValido(100)).toBe(true);
    expect(ajusteValido(100.01)).toBe(false);
    expect(ajusteValido(Number.NaN)).toBe(false);
  });

  it("o texto diz se é desconto ou acréscimo", () => {
    expect(textoDoAjuste(-10)).toBe("10% de desconto");
    expect(textoDoAjuste(12.5)).toBe("12,5% de acréscimo");
    expect(textoDoAjuste(0)).toBe("sem ajuste");
  });

  it("o total do grupo soma item a item (como o banco grava), com a quantidade", () => {
    const precos: Record<string, number> = { a: 33333, b: 15 };
    const t = totaisDoGrupo(
      [
        { procedureId: "a", quantidade: 2 },
        { procedureId: "b", quantidade: 1 },
      ],
      (id) => precos[id],
      -10
    );
    expect(t.tabelaCents).toBe(66681);
    expect(t.pacoteCents).toBe(30000 * 2 + 14); // 13,5 → 14
  });

  it("o lançamento pelo botão Grupo soma com o ajuste", () => {
    const linhas = [
      { procedureId: "a", quantidade: 1, tooth: "36", faces: [], regionCode: null },
      { procedureId: "a", quantidade: 1, tooth: "46", faces: [], regionCode: null },
    ];
    expect(totalDoLancamento(linhas, () => 100000)).toBe(200000);
    expect(totalDoLancamento(linhas, () => 100000, -10)).toBe(180000);
  });
});

describe("a linha do pacote (GP6)", () => {
  const g1 = { id: "g1", nome: "Implante + coroa" };
  const g2 = { id: "g2", nome: "Canal + restauração" };

  it("uma linha por grupo que mudou o preço; o resto do plano fica de fora", () => {
    const linhas = pacotesDaOpcao([
      { grupo: g1, quantidade: 1, precoCents: 270000, precoDeTabelaCents: 300000 },
      { grupo: g1, quantidade: 2, precoCents: 90000, precoDeTabelaCents: 100000 },
      { grupo: null, quantidade: 1, precoCents: 50000, precoDeTabelaCents: null },
      // Grupo sem ajuste: não vira linha ("de" igual ao "por").
      { grupo: g2, quantidade: 1, precoCents: 80000, precoDeTabelaCents: null },
    ]);
    expect(linhas).toEqual([{ grupoId: "g1", nome: "Implante + coroa", deCents: 500000, porCents: 450000 }]);
  });

  it("o rótulo não repete 'Pacote' quando o nome já começa assim", () => {
    expect(rotuloDoPacote("Implante + coroa")).toBe("Pacote Implante + coroa");
    expect(rotuloDoPacote("Pacote clareamento")).toBe("Pacote clareamento");
    expect(rotuloDoPacote("pacote clareamento")).toBe("pacote clareamento");
    expect(rotuloDoPacote("Pacotes VIP")).toBe("Pacote Pacotes VIP");
  });

  it("acréscimo também aparece (o 'por' maior que o 'de')", () => {
    const [l] = pacotesDaOpcao([{ grupo: g2, quantidade: 1, precoCents: 115000, precoDeTabelaCents: 100000 }]);
    expect(l.porCents).toBeGreaterThan(l.deCents);
  });
});

describe("mensagens", () => {
  it("as da 0325 em pt-BR, e a falta da 0325 dita com o número certo", () => {
    expect(mensagemDoGrupo("PRICE_NOT_ALLOWED")).toMatch(/Só o Admin Master/);
    expect(mensagemDoGrupo("INVALID_ADJUST")).toMatch(/desconto vai até/);
    expect(
      mensagemDoGrupo("Could not find the function public.set_procedure_group_price(p_id, p_percent) in the schema cache")
    ).toMatch(/0325/);
    expect(mensagemDoGrupo("Could not find the function public.save_procedure_group in the schema cache")).toMatch(/0324/);
  });
});

describe("o banco e as telas seguem a mesma regra", () => {
  const sql = ler("supabase/migrations/0325_preco_do_grupo.sql");
  const guarda = sql.slice(sql.indexOf("function public.plan_item_catalog_guard()"), sql.indexOf("function public.submit_treatment_plan("));
  const envio = sql.slice(sql.indexOf("function public.submit_treatment_plan("), sql.indexOf("function public.set_procedure_group_price("));
  const porta = sql.slice(sql.indexOf("function public.set_procedure_group_price("));

  it("a conta do banco é a de precoNoPacote (meio para cima sobre 100 + %)", () => {
    expect(sql).toMatch(/round\(p_price::numeric \* \(100 \+ p_percent\) \/ 100\)::integer/);
  });

  it("o item lançado e o envio do plano usam o pacote", () => {
    expect(guarda.length).toBeGreaterThan(0);
    expect(guarda).toMatch(/security invoker/); // com definer a trava nunca valeria (0306)
    expect(guarda).toMatch(/group_adjusted_price\(v_tabela, v_pct\)/);
    expect(guarda).toMatch(/list_price_cents is distinct from old\.list_price_cents/);
    expect(guarda).toMatch(/procedure_group_id is distinct from old\.procedure_group_id/);
    expect(envio).toMatch(/set unit_price_cents = public\.group_adjusted_price\(/);
    expect(envio).toMatch(/list_price_cents = case/);
  });

  it("só o Admin Master define o preço do pacote", () => {
    expect(porta).toMatch(/if not public\.is_admin_master\(\) then\s+raise exception 'PRICE_NOT_ALLOWED'/);
    expect(porta).not.toMatch(/is_planner/);
  });

  it("o ajuste é lido À PARTE (sem a 0325 a lista de grupos não cai)", () => {
    const db = ler("src/lib/procedimentos/grupos-db.ts");
    const principal = db.slice(db.indexOf(".from(\"procedure_groups\")"), db.indexOf(".order(\"name\")"));
    expect(principal).not.toMatch(/price_adjust_percent/);
    expect(db).toMatch(/select\("id, price_adjust_percent"\)/);
    const loader = ler("src/app/(app)/prontuarios/[id]/plan-loader.ts");
    expect(loader).toMatch(/select\("id, list_price_cents"\)/);
  });

  it("plano, orçamento e apresentação mostram a linha do pacote", () => {
    expect(ler("src/app/(app)/prontuarios/[id]/planning-section.tsx")).toMatch(/<LinhasDoPacote /);
    expect(ler("src/app/orcamentos/[id]/page.tsx")).toMatch(/<LinhasDoPacote linhas=\{pacotes\}/);
    expect(ler("src/app/(app)/apresentacao/[clientId]/presentation-view.tsx")).toMatch(/option\.pacotes\.map/);
    expect(ler("src/app/(app)/apresentacao/[clientId]/actions.ts")).toMatch(/\$\{rotuloDoPacote\(p\.nome\)\}/);
    expect(ler("src/app/(app)/prontuarios/[id]/lancar-grupo.tsx")).toMatch(/totalDoLancamento\(montagem\.linhas, precoDe, ajuste\)/);
  });

  it("quem vê só os totais não vê o subtotal do pacote (F4)", () => {
    const plano = ler("src/app/(app)/prontuarios/[id]/planning-section.tsx");
    const resumo = plano.slice(plano.indexOf("if (summaryOnly) {"), plano.indexOf("if (summaryOnly) {") + 4000);
    const fimDoResumo = resumo.indexOf("\n  }\n");
    expect(fimDoResumo).toBeGreaterThan(0);
    expect(resumo.slice(0, fimDoResumo)).not.toMatch(/LinhasDoPacote/);
    expect(ler("src/app/(app)/apresentacao/[clientId]/presentation-data.ts")).toMatch(/pacotes: veApenasTotais\s*\?\s*\[\]/);
  });

  it("na tela de grupos, só o Admin define o preço", () => {
    const page = ler("src/app/(app)/procedimentos/grupos/page.tsx");
    expect(page).toMatch(/podeDefinirPreco=\{session\.isAdminMaster\}/);
    const acoes = ler("src/app/(app)/procedimentos/grupos/actions.ts");
    const fn = acoes.slice(acoes.indexOf("export async function definirPrecoDoPacote"));
    expect(fn).toMatch(/if \(!session\.isAdminMaster\)/);
  });
});
