// ASA3, entrega 3 (4010) — REPASSES DA FRANQUIA: o que não depende do banco.
// O período (P3), as somas da tela, a planilha de cada parte (P6), a permissão
// igual no código e no banco (P2) e as réguas da tela (nome, porta, auditoria).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAPACIDADES_POR_ID } from "@/lib/permissions";
import {
  PARTES,
  aReceberPorData,
  diferencaDaTaxa,
  ehParte,
  lerFiltros,
  recebidoDaUnidade,
  relatorioDaParte,
  rotuloDoPeriodo,
  totalDoResumo,
  type Repasses,
} from "@/lib/finance/repasses-franquia";

const SQL = readFileSync("supabase/migrations/4010_asa3_repasses_da_franquia.sql", "utf8");
const PAGINA = readFileSync("src/app/(app)/financeiro/repasses-da-franquia/page.tsx", "utf8");
const ROTA = readFileSync("src/app/(app)/financeiro/repasses-da-franquia/planilha/route.ts", "utf8");
const NAV = readFileSync("src/app/(app)/financeiro/finance-nav.tsx", "utf8");

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

const R: Repasses = {
  de: "2026-11-01",
  ate: "2026-11-30",
  hoje: "2026-11-13",
  rede: true,
  tolerancia_cents: 10,
  resumo: [
    { clinic_id: U1, name: "Londrina", devido: 1000, pago_no_split: 600, a_receber: 100, foi_para_conta_a_pagar: 300, conta_a_pagar_aberta: 300, conta_a_pagar_vencida: 0 },
    { clinic_id: U2, name: "Cambé", devido: 500, pago_no_split: 0, a_receber: 0, foi_para_conta_a_pagar: 500, conta_a_pagar_aberta: 200, conta_a_pagar_vencida: 300 },
  ],
  recebido: [
    { clinic_id: U1, categoria: "split", n: 3, recebido: 6000, devido: 700, pago_no_split: 700, conta_a_pagar: 0, percentual: 60 },
    { clinic_id: U1, categoria: "dinheiro", n: 1, recebido: 4000, devido: 300, pago_no_split: 0, conta_a_pagar: 300, percentual: 40 },
  ],
  media_rede: { split: 30, dinheiro: 20, externa: 50 },
  motivos_sem_split: [],
  taxas: [
    { clinic_id: U1, fee: "royalty", devido_liquidadas: 380, liquidado: 377, a_receber: 60, fora_do_split: null, absorvidas: 2, mensageria: 0, divergentes: 0 },
    { clinic_id: U1, fee: "fundo", devido_liquidadas: null, liquidado: null, a_receber: 20, fora_do_split: null, absorvidas: 0, mensageria: 0, divergentes: 0 },
  ],
  cobrancas: [],
  a_receber: [
    { charge_id: "c1", clinic_id: U1, client_id: null, cliente: "A", codigo: "LDN-1", meio: "PIX", pago_em: "2026-11-10", previsto: "2026-11-10", atrasado: true, taxa: "royalty", valor: 40, bloqueado: false },
    { charge_id: "c1", clinic_id: U1, client_id: null, cliente: "A", codigo: "LDN-1", meio: "PIX", pago_em: "2026-11-10", previsto: "2026-11-10", atrasado: true, taxa: "fundo", valor: 10, bloqueado: false },
    { charge_id: "c2", clinic_id: U1, client_id: null, cliente: "B", codigo: "LDN-2", meio: "CREDIT_CARD", pago_em: "2026-11-12", previsto: "2026-12-14", atrasado: false, taxa: "royalty", valor: 20, bloqueado: false },
  ],
  liquidado_no_periodo: [],
  divergencias: [],
  dispensas: [],
  unidades: { [U1]: "Londrina", [U2]: "Cambé" },
  saldo: null,
};

describe("o período (P3)", () => {
  it("sem nada, o mês atual inteiro", () => {
    expect(lerFiltros({}, "2026-11-13")).toEqual({ de: "2026-11-01", ate: "2026-11-30", mes: "2026-11", unidade: null });
  });
  it("outro mês, com o último dia certo (fevereiro e bissexto)", () => {
    expect(lerFiltros({ mes: "2026-02" }, "2026-11-13").ate).toBe("2026-02-28");
    expect(lerFiltros({ mes: "2028-02" }, "2026-11-13").ate).toBe("2028-02-29");
  });
  it("um intervalo de datas ganha do mês", () => {
    expect(lerFiltros({ mes: "2026-10", de: "2026-10-05", ate: "2026-11-02" }, "2026-11-13")).toMatchObject({ de: "2026-10-05", ate: "2026-11-02", mes: null });
  });
  it("lixo, intervalo invertido ou longo demais (> 400 dias) voltam ao mês atual", () => {
    expect(lerFiltros({ de: "2026-11-30", ate: "2026-11-01" }, "2026-11-13").mes).toBe("2026-11");
    expect(lerFiltros({ de: "2024-01-01", ate: "2026-11-01" }, "2026-11-13").mes).toBe("2026-11");
    expect(lerFiltros({ mes: "2026-13", unidade: "x'; drop" }, "2026-11-13")).toMatchObject({ mes: "2026-11", unidade: null });
  });
  it("o rótulo do período", () => {
    expect(rotuloDoPeriodo(lerFiltros({}, "2026-11-13"))).toBe("novembro de 2026");
    expect(rotuloDoPeriodo(lerFiltros({ de: "2026-10-05", ate: "2026-11-02" }, "2026-11-13"))).toBe("05/10/2026 a 02/11/2026");
  });
});

describe("as somas da tela", () => {
  it("o resumo da rede soma as unidades (ajuste 3)", () => {
    expect(totalDoResumo(R.resumo)).toEqual({ devido: 1500, pago_no_split: 600, a_receber: 100, foi_para_conta_a_pagar: 800, conta_a_pagar_aberta: 500, conta_a_pagar_vencida: 300 });
  });
  it("a fatia de cada forma de recebimento, com a média da rede ao lado (ajuste 2)", () => {
    const l = recebidoDaUnidade(R, U1);
    expect(l.find((x) => x.valor === "split")).toMatchObject({ recebido: 6000, percentual: 60, mediaDaRede: 30 });
    expect(l.find((x) => x.valor === "externa")).toMatchObject({ recebido: 0, percentual: 0, mediaDaRede: 50 });
    expect(l.some((x) => x.valor === "cartao")).toBe(false); // nem a unidade nem a rede têm
  });
  it("a diferença é só das cobranças liquidadas; sem liquidação não há diferença (ajuste 1)", () => {
    expect(diferencaDaTaxa(R.taxas[0])).toBe(3);
    expect(diferencaDaTaxa(R.taxas[1])).toBeNull();
  });
  it("o a receber por data prevista, com o atrasado marcado", () => {
    expect(aReceberPorData(R.a_receber)).toEqual([
      { data: "2026-11-10", valor: 50, atrasado: true, cobrancas: 1 },
      { data: "2026-12-14", valor: 20, atrasado: false, cobrancas: 1 },
    ]);
  });
});

describe("a planilha (P6)", () => {
  it("cada parte vira um relatório com as colunas preenchidas", () => {
    for (const parte of PARTES) {
      const rel = relatorioDaParte({ parte, dados: R, filtros: lerFiltros({}, "2026-11-13"), nomeDaUnidade: null, geradoPor: "Teste", agora: "2026-11-13 10:00" });
      expect(rel.titulo).toContain("Repasses da franquia");
      expect(rel.nomeDoArquivo).toContain(parte);
      for (const linha of rel.linhas) for (const col of rel.colunas) expect(linha).toHaveProperty(col.chave);
    }
  });
  it("só as partes conhecidas", () => {
    expect(ehParte("resumo")).toBe(true);
    expect(ehParte("tudo")).toBe(false);
    for (const p of PARTES) expect(SQL).toContain(`'${p}'`);
  });
  it("a planilha passa pela porta com p_export (o banco grava a auditoria); a tela, sem", () => {
    expect(ROTA).toContain('rpc("franchise_payouts_read"');
    expect(ROTA).toContain("p_export: parte");
    expect(PAGINA).toContain("p_export: null");
    expect(SQL).toMatch(/insert into public\.audit_logs[\s\S]*'export', 'franchise_payouts'/);
  });
});

describe("quem vê (P2) e as réguas", () => {
  it("nasce só com o Admin: o padrão do código é o mesmo do banco", () => {
    expect(CAPACIDADES_POR_ID.get("modulo.repasses_franquia")?.padrao).toEqual([]);
    expect(SQL).toContain("when 'modulo.repasses_franquia' then '{}'::public.user_role[]");
  });
  it("o teto do banco: Gerente, Franqueado e Financeiro da Franqueadora — nunca a Recepção", () => {
    expect(SQL).toMatch(/when 'modulo\.repasses_franquia' then\s+array\['unit_manager','franchisee','finance_franchisor'\]::public\.user_role\[\]/);
  });
  it("a 4010 mantém as permissões das entregas anteriores na lista do banco", () => {
    expect(SQL).toContain("when 'acao.cobranca.estorno' then array['franchisee','unit_manager']");
    expect(SQL).toContain("when 'modulo.painel_cobrancas' then '{}'");
    expect(SQL).toContain("when 'acao.cobranca.selo_atraso' then array['unit_manager','franchisee']");
  });
  it("as funções internas ficam fechadas; só a porta abre para quem entrou", () => {
    expect(SQL).toContain("revoke execute on function public._franchise_payout_charge_fees(date, date, uuid[], uuid) from public, anon, authenticated;");
    expect(SQL).toContain("revoke execute on function public._franchise_payout_receipts(date, date, uuid[], uuid) from public, anon, authenticated;");
    expect(SQL).toContain("grant execute on function public.franchise_payouts_read(date, date, uuid, text) to authenticated;");
    expect(SQL).not.toMatch(/grant execute on function public\._franchise/);
  });
  it("o nome não se confunde com o repasse dos dentistas", () => {
    expect(NAV).toContain('label: "Repasses da franquia"');
    expect(NAV).toContain('{ href: "/financeiro/repasses", label: "Repasses" }');
  });
  it("a RisLife nunca aparece como destino nesta tela (D7)", () => {
    expect(PAGINA).not.toMatch(/RisLife/i);
  });
});
