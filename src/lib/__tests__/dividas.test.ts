import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAPACIDADES } from "@/lib/permissions";
import {
  EMPTY_DEBT,
  FILTROS_VAZIOS,
  centavosDoCampo,
  debtToPayload,
  diasEmAtraso,
  etapaPedeMotivo,
  faixaDeAtraso,
  faltaNoCadastro,
  filtrarDividas,
  limiteDaNegativacao,
  ordenarDividas,
  origemPedeJustificativa,
  origemSugerida,
  prazoDeInadimplencia,
  situacaoDaDivida,
  totaisDaLista,
  type DebtListRow,
  ANEXO_MAX_BYTES,
  ANEXO_TIPOS,
  descontoDaProposta,
  faltaNaProposta,
  pedeConferencia,
  propostaVencendo,
  ratear,
  selosDaDivida,
  impactoNoFinanceiro,
  fraseDoImpacto,
  valorDevido,
  titulosParecidos,
} from "@/lib/finance/dividas";

const SQL = readFileSync("supabase/migrations/0404_dividas_base.sql", "utf8").replace(/\r\n/g, "\n");

describe("situação da dívida (espelho de _debt_compute_status)", () => {
  const hoje = "2026-11-20";
  const s = (due: string, stage: Parameters<typeof situacaoDaDivida>[0]["manualStage"] = null, prazo = 30) =>
    situacaoDaDivida({ dueDate: due, manualStage: stage, today: hoje, daysToDefault: prazo });

  it("vence hoje ou depois = a vencer; do 1º ao 30º dia = em atraso; 31º = inadimplente", () => {
    expect(s("2026-11-20")).toBe("a_vencer");
    expect(s("2026-12-01")).toBe("a_vencer");
    expect(s("2026-11-19")).toBe("em_atraso");
    expect(s("2026-10-21")).toBe("em_atraso"); // 30 dias
    expect(s("2026-10-20")).toBe("inadimplente"); // 31 dias
  });

  it("o prazo vem do tipo do credor, depois do devedor, depois da rede, senão 30", () => {
    expect(prazoDeInadimplencia({ doTipoDoCredor: 5, doDevedor: 15, daRede: 30 })).toBe(5);
    expect(prazoDeInadimplencia({ doTipoDoCredor: null, doDevedor: 15, daRede: 30 })).toBe(15);
    expect(prazoDeInadimplencia({ daRede: 45 })).toBe(45);
    expect(prazoDeInadimplencia({})).toBe(30);
    expect(s("2026-11-10", null, 5)).toBe("inadimplente");
  });

  it("etapa manual ganha do vencimento, na ordem do plano", () => {
    expect(s("2020-01-01", "baixada")).toBe("baixada");
    expect(s("2020-01-01", "contestada")).toBe("contestada");
    expect(s("2020-01-01", "judicial")).toBe("judicial");
    expect(s("2030-01-01", "em_negociacao")).toBe("em_negociacao");
  });

  it("o banco tem a mesma precedência (a ordem dos `if` na função)", () => {
    const corpo = SQL.slice(SQL.indexOf("function public._debt_compute_status"));
    const ordem = ["'baixada'", "'contestada'", "'judicial'", "'em_negociacao'", "'a_vencer'", "'em_atraso'", "'inadimplente'"]
      .map((t) => corpo.indexOf(`then return ${t}`) >= 0 ? corpo.indexOf(`then return ${t}`) : corpo.indexOf(`return ${t}`));
    expect(ordem.every((p) => p > 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
  });

  it("contestada, judicial e baixada pedem motivo ao entrar e ao sair; negociação não", () => {
    expect(etapaPedeMotivo(null, "contestada")).toBe(true);
    expect(etapaPedeMotivo("judicial", null)).toBe(true);
    expect(etapaPedeMotivo(null, "em_negociacao")).toBe(false);
    expect(etapaPedeMotivo("em_negociacao", null)).toBe(false);
    expect(etapaPedeMotivo("baixada", "baixada")).toBe(false);
  });
});

describe("datas", () => {
  it("dias em atraso atravessam mês e ano", () => {
    expect(diasEmAtraso("2026-12-31", "2027-01-02")).toBe(2);
    expect(diasEmAtraso("2026-11-20", "2026-11-20")).toBe(0);
    expect(diasEmAtraso("2026-11-21", "2026-11-20")).toBe(-1);
  });

  it("faixas de atraso do pedido (3.2)", () => {
    expect(faixaDeAtraso(0)).toBeNull();
    expect(faixaDeAtraso(1)).toBe("1-30");
    expect(faixaDeAtraso(30)).toBe("1-30");
    expect(faixaDeAtraso(31)).toBe("31-60");
    expect(faixaDeAtraso(90)).toBe("61-90");
    expect(faixaDeAtraso(180)).toBe("91-180");
    expect(faixaDeAtraso(365)).toBe("181-365");
    expect(faixaDeAtraso(366)).toBe("365+");
  });

  it("limite de 5 anos da negativação, inclusive 29/02", () => {
    expect(limiteDaNegativacao("2025-04-10")).toBe("2030-04-10");
    expect(limiteDaNegativacao("2024-02-29")).toBe("2029-02-28");
  });
});

describe("origem (D2: a data em que a dívida NASCEU, nunca o vencimento)", () => {
  const goLive = "2026-11-16";
  it("emitida antes da implantação = A; depois = B", () => {
    expect(origemSugerida({ goLiveOn: goLive, issueDate: "2026-11-15", accrualMonth: null })).toBe("A");
    expect(origemSugerida({ goLiveOn: goLive, issueDate: "2026-11-16", accrualMonth: null })).toBe("B");
  });
  it("sem emissão, usa a competência (primeiro dia do mês)", () => {
    expect(origemSugerida({ goLiveOn: goLive, issueDate: null, accrualMonth: "2026-10" })).toBe("A");
    expect(origemSugerida({ goLiveOn: goLive, issueDate: null, accrualMonth: "2026-12-01" })).toBe("B");
  });
  it("sem data de nascimento ou sem implantação, não sugere", () => {
    expect(origemSugerida({ goLiveOn: goLive, issueDate: null, accrualMonth: null })).toBeNull();
    expect(origemSugerida({ goLiveOn: null, issueDate: "2026-01-01", accrualMonth: null })).toBeNull();
  });
  it("discordar de A/B exige justificativa; C não", () => {
    expect(origemPedeJustificativa("B", "A")).toBe(true);
    expect(origemPedeJustificativa("A", "A")).toBe(false);
    expect(origemPedeJustificativa("C", "A")).toBe(false);
    expect(origemPedeJustificativa("B", null)).toBe(false);
  });
});

describe("formulário", () => {
  const base = { ...EMPTY_DEBT, clinicId: "c", supplierId: "s", dueDate: "2026-12-01", original: "1.234,56" };

  it("valores brasileiros viram centavos", () => {
    expect(centavosDoCampo("1.234,56")).toBe(123456);
    expect(centavosDoCampo("R$ 80")).toBe(8000);
    expect(centavosDoCampo("")).toBeNull();
    expect(Number.isNaN(centavosDoCampo("12,345"))).toBe(true);
  });

  it("mínimos do pedido: devedor, credor, valor e vencimento", () => {
    expect(faltaNoCadastro(base, null)).toBeNull();
    expect(faltaNoCadastro({ ...base, clinicId: "" }, null)).toMatch(/devedor/);
    expect(faltaNoCadastro({ ...base, supplierId: "" }, null)).toMatch(/credor/);
    expect(faltaNoCadastro({ ...base, dueDate: "" }, null)).toMatch(/vencimento/);
    expect(faltaNoCadastro({ ...base, original: "" }, null)).toMatch(/valor/);
  });

  it("valor atualizado pede a data de referência", () => {
    expect(faltaNoCadastro({ ...base, updated: "1.500,00" }, null)).toMatch(/referência/);
    expect(faltaNoCadastro({ ...base, updated: "1.500,00", updatedRefDate: "2026-11-13" }, null)).toBeNull();
  });

  it("origem contra a sugestão sem justificativa não salva", () => {
    expect(faltaNoCadastro({ ...base, origin: "B" }, "A")).toMatch(/justificativa/);
    expect(faltaNoCadastro({ ...base, origin: "B", originOverrideReason: "comprado depois" }, "A")).toBeNull();
  });

  it("o pacote para o banco leva centavos, competência no dia 1 e só ids", () => {
    const p = debtToPayload({ ...base, accrualMonth: "2026-10", updated: "", tagIds: ["t1"] });
    expect(p.original_cents).toBe(123456);
    expect(p.updated_cents).toBeNull();
    expect(p.accrual_month).toBe("2026-10-01");
    expect(p.tag_ids).toEqual(["t1"]);
    expect(p.guarantor_name).toBe("");
  });
});

describe("lista, filtros e totais", () => {
  const linha = (o: Partial<DebtListRow>): DebtListRow => ({
    id: o.code ?? "x", code: "DV-000001", clinicId: "ldn", clinicName: "Londrina", supplierId: "s1",
    supplierName: "Banco Exemplo", supplierKind: "bancos", categoryId: null, subcategoryId: null,
    natureCode: null, tagIds: [], status: "em_atraso", dueDate: "2026-11-01", originalCents: 1000,
    updatedCents: null, priority: null, ownerUserId: null, origin: "A", contractNumber: null,
    description: null, installmentLabel: null, needsSplit: false, bundledCount: 1, groupCode: null,
    nextAction: null, nextActionOn: null, negativada: false, protestada: false, judicial: false,
    propostaCents: null, propostaValidade: null, custasCents: 0, lastCheckedOn: "2026-11-01", ...o,
  });
  const rows = [
    linha({ code: "DV-000001", updatedCents: 5000, priority: "baixa" }),
    linha({ code: "DV-000002", clinicId: "cbe", clinicName: "Cambé", dueDate: "2026-12-10", status: "a_vencer", priority: "alta", tagIds: ["t"] }),
    linha({ code: "DV-000003", status: "contestada", originalCents: 300, supplierName: "Operadora Ação", dueDate: "2025-01-01" }),
  ];

  it("filtra por devedor, etiqueta, faixa e busca sem acento", () => {
    const hoje = "2026-11-20";
    expect(filtrarDividas(rows, { ...FILTROS_VAZIOS, devedor: "cbe" }, hoje).map((r) => r.code)).toEqual(["DV-000002"]);
    expect(filtrarDividas(rows, { ...FILTROS_VAZIOS, etiqueta: "t" }, hoje)).toHaveLength(1);
    expect(filtrarDividas(rows, { ...FILTROS_VAZIOS, faixa: "a_vencer" }, hoje).map((r) => r.code)).toEqual(["DV-000002"]);
    expect(filtrarDividas(rows, { ...FILTROS_VAZIOS, faixa: "1-30" }, hoje).map((r) => r.code)).toEqual(["DV-000001"]);
    expect(filtrarDividas(rows, { ...FILTROS_VAZIOS, busca: "acao" }, hoje).map((r) => r.code)).toEqual(["DV-000003"]);
  });

  it("ordena por valor (o atualizado vale mais que o original) e por prioridade", () => {
    expect(ordenarDividas(rows, "valor").map((r) => r.code)).toEqual(["DV-000001", "DV-000002", "DV-000003"]);
    expect(ordenarDividas(rows, "prioridade")[0].code).toBe("DV-000002");
  });

  it("filtra por restrição, proposta e conferência", () => {
    const hoje = "2026-11-20";
    const rs = [
      linha({ code: "A", negativada: true, propostaCents: 500, propostaValidade: "2026-11-25" }),
      linha({ code: "B", protestada: true, lastCheckedOn: null }),
      linha({ code: "C", judicial: true, propostaCents: 100, propostaValidade: "2026-12-30" }),
    ];
    const cods = (f: Partial<typeof FILTROS_VAZIOS>) =>
      filtrarDividas(rs, { ...FILTROS_VAZIOS, ...f }, hoje).map((r) => r.code);
    expect(cods({ restricao: "negativada" })).toEqual(["A"]);
    expect(cods({ restricao: "alguma" })).toEqual(["A", "B", "C"]);
    expect(cods({ restricao: "nenhuma" })).toEqual([]);
    expect(cods({ proposta: "sem" })).toEqual(["B"]);
    expect(cods({ proposta: "vencendo" })).toEqual(["A"]);
    expect(cods({ conferir: "1" })).toEqual(["B"]);
  });

  it("totais: devido usa o atualizado quando há; contestada/judicial em subtotal à parte (D17)", () => {
    const t = totaisDaLista(rows);
    expect(t.quantidade).toBe(3);
    expect(t.devidoCents).toBe(5000 + 1000 + 300);
    expect(t.contestadaJudicialCents).toBe(300);
  });
});

describe("as permissões do módulo — tela e banco iguais, e o teto", () => {
  // A definição mais nova dos padrões (a 0407 acrescentou "importar").
  const SQL_CAPS = readFileSync("supabase/migrations/0407_dividas_importacao.sql", "utf8").replace(/\r\n/g, "\n");
  const doBanco = (cap: string): string[] => {
    const m = SQL_CAPS.match(new RegExp(`when '${cap.replace(/\./g, "\\.")}' then array\\[([^\\]]*)\\]`));
    if (!m) return [];
    return m[1].split(",").map((s) => s.replace(/['\s]/g, "")).filter(Boolean).sort();
  };
  const caps = CAPACIDADES.filter((c) => c.id === "modulo.dividas" || c.id.startsWith("acao.dividas."));

  it("são as 4 da fase 1 + importar (0407)", () => {
    expect(caps.map((c) => c.id).sort()).toEqual([
      "acao.dividas.configurar", "acao.dividas.excluir", "acao.dividas.importar", "acao.dividas.lancar", "modulo.dividas",
    ]);
  });

  it.each(caps.map((c) => [c.id, c] as const))("%s: o padrão do código é o do banco", (_id, c) => {
    expect([...c.padrao].sort()).toEqual(doBanco(c.id));
  });

  it("o teto do banco é só o Financeiro da Franqueadora", () => {
    const teto = SQL_CAPS.slice(SQL_CAPS.indexOf("function public._debt_cap_ceiling"), SQL_CAPS.indexOf("revoke execute on function public._debt_cap_ceiling"));
    expect(teto).toContain("'acao.dividas.importar'");
    expect(teto).toMatch(/then array\['finance_franchisor'\]/);
    expect(teto).not.toMatch(/unit_manager|franchisee|franchisor_staff/);
  });

  it("nenhuma tabela do módulo tem regra de escrita (só as funções gravam)", () => {
    const policies = [...SQL.matchAll(/create policy "([^"]+)" on public\.(debt\w*)\s+for (\w+)/gi)];
    expect(policies.length).toBe(10);
    expect(policies.filter((p) => p[3].toLowerCase() !== "select").map((p) => p[1])).toEqual([]);
  });

  it("toda função que responde a logados tira o anônimo antes", () => {
    const grants = [...SQL.matchAll(/grant execute on function (public\.\w+)\(/g)].map((m) => m[1]);
    expect(grants.length).toBeGreaterThan(10);
    for (const f of grants) {
      expect(SQL).toMatch(new RegExp(`revoke execute on function ${f.replace(".", "\\.")}\\([^)]*\\) from public, anon, authenticated`));
    }
  });
});

describe("propostas, rateio e selos (fase 2)", () => {
  const base = (o: Partial<DebtListRow>): DebtListRow => ({
    id: "x", code: "DV-1", clinicId: "c", clinicName: "C", supplierId: "s", supplierName: "S", supplierKind: null,
    categoryId: null, subcategoryId: null, natureCode: null, tagIds: [], status: "em_atraso", dueDate: "2026-11-01",
    originalCents: null, updatedCents: null, priority: null, ownerUserId: null, origin: "A", contractNumber: null,
    description: null, installmentLabel: null, needsSplit: false, bundledCount: 1, groupCode: null, nextAction: null,
    nextActionOn: null, negativada: false, protestada: false, judicial: false, propostaCents: null,
    propostaValidade: null, custasCents: 0, lastCheckedOn: "2026-11-15", ...o,
  });

  it("DÍVIDA SEM PROPOSTA NÃO É 100% DE DESCONTO (3.9.2, o erro da planilha original)", () => {
    const t = totaisDaLista([
      base({ updatedCents: 100_000, propostaCents: 60_000 }),
      base({ updatedCents: 200_000, propostaCents: null }),
    ]);
    expect(t.devidoCents).toBe(300_000);
    expect(t.propostasCents).toBe(60_000);
    expect(t.economiaCents).toBe(40_000); // não 240.000
    expect(t.descontoMedio).toBeCloseTo(0.4);
    expect(t.semPropostaCents).toBe(200_000);
    expect(t.estimadoCents).toBe(260_000); // proposta + devido sem proposta
  });

  it("custo total para regularizar = estimado + custas do cartório", () => {
    expect(totaisDaLista([base({ updatedCents: 100_000, propostaCents: 50_000, custasCents: 12_000 })]).custoTotalCents).toBe(62_000);
  });

  it("proposta maior que a dívida dá economia negativa (aparece, não some)", () => {
    expect(totaisDaLista([base({ updatedCents: 50_000, propostaCents: 64_000 })]).economiaCents).toBe(-14_000);
  });

  it("sem proposta nenhuma, desconto médio é nulo (não zero)", () => {
    expect(totaisDaLista([base({ updatedCents: 1000 })]).descontoMedio).toBeNull();
    expect(descontoDaProposta(1000, null)).toBeNull();
    expect(descontoDaProposta(1000, 750)).toBeCloseTo(0.25);
  });

  it("rateio: proporcional, a última parte absorve o resíduo, a soma bate", () => {
    expect(ratear(100, [1, 1, 1])).toEqual([33, 33, 34]);
    expect(ratear(120_000, [30_000, 70_000])).toEqual([36_000, 84_000]);
    expect(ratear(99_999, [12_345, 67_890, 1]).reduce((a, b) => a + b, 0)).toBe(99_999);
    expect(ratear(10, [0, 0])).toEqual([5, 5]);
    expect(ratear(10, [])).toEqual([]);
  });

  it("proposta vencendo: dentro do aviso; vencida ou sem validade, não", () => {
    const hoje = "2026-11-20";
    expect(propostaVencendo({ propostaCents: 1, propostaValidade: "2026-11-27" }, hoje, 7)).toBe(true);
    expect(propostaVencendo({ propostaCents: 1, propostaValidade: "2026-11-28" }, hoje, 7)).toBe(false);
    expect(propostaVencendo({ propostaCents: 1, propostaValidade: "2026-11-19" }, hoje, 7)).toBe(false);
    expect(propostaVencendo({ propostaCents: 1, propostaValidade: null }, hoje, 7)).toBe(false);
    expect(propostaVencendo({ propostaCents: null, propostaValidade: "2026-11-21" }, hoje, 7)).toBe(false);
  });

  it("conferência: nunca conferida ou há mais de N dias pede conferir", () => {
    expect(pedeConferencia(null, "2026-11-20", 60)).toBe(true);
    expect(pedeConferencia("2026-09-21", "2026-11-20", 60)).toBe(false); // 60 dias
    expect(pedeConferencia("2026-09-20", "2026-11-20", 60)).toBe(true);
  });

  it("selos na ordem da tela", () => {
    const s = selosDaDivida(
      base({ negativada: true, protestada: true, judicial: true, propostaCents: 1, propostaValidade: "2026-11-21", needsSplit: true, bundledCount: 3, lastCheckedOn: null }),
      "2026-11-20",
      { alertaDaProposta: 7, conferencia: 60 }
    );
    expect(s.map((x) => x.rotulo)).toEqual(["Negativada", "Protestada", "Judicial", "Proposta vencendo", "Desdobrar (3)", "Nunca conferida"]);
  });

  it("selo 'No Contas a Pagar' só com título (0406)", () => {
    const prazos = { alertaDaProposta: 7, conferencia: 60 };
    const com = selosDaDivida(base({ noFinanceiro: true, lastCheckedOn: "2026-11-20" }), "2026-11-20", prazos);
    const sem = selosDaDivida(base({ lastCheckedOn: "2026-11-20" }), "2026-11-20", prazos);
    expect(com.map((x) => x.codigo)).toEqual(["no_financeiro"]);
    expect(sem).toEqual([]);
  });

  it("proposta: valor, parcelas e validade", () => {
    const hoje = "2026-11-20";
    expect(faltaNaProposta({ valor: "1.000,00", tipo: "a_vista", parcelas: "", validade: "", hoje })).toBeNull();
    expect(faltaNaProposta({ valor: "", tipo: "a_vista", parcelas: "", validade: "", hoje })).toMatch(/valor/);
    expect(faltaNaProposta({ valor: "100", tipo: "parcelado", parcelas: "", validade: "", hoje })).toMatch(/parcelas/);
    expect(faltaNaProposta({ valor: "100", tipo: "a_vista", parcelas: "", validade: "2026-11-19", hoje })).toMatch(/passou/);
  });
});

describe("0405 — tela e banco", () => {
  const SQL5 = readFileSync("supabase/migrations/0405_dividas_restricoes_propostas_anexos.sql", "utf8").replace(/\r\n/g, "\n");

  it("nenhuma tabela nova tem regra de escrita; na pasta, só enviar (nunca apagar)", () => {
    const pol = [...SQL5.matchAll(/create policy "([^"]+)" on (public\.debt\w*|storage\.objects)\s+for (\w+)/gi)];
    expect(pol.filter((p) => p[3].toLowerCase() !== "select").map((p) => p[1])).toEqual(["dividas_insert"]);
    expect(SQL5).not.toMatch(/for delete/i);
  });

  it("toda função que responde a logados tira o anônimo antes", () => {
    const grants = [...SQL5.matchAll(/grant execute on function (public\.\w+)\(/g)].map((m) => m[1]);
    expect(grants.length).toBeGreaterThan(10);
    for (const f of grants) {
      expect(SQL5).toMatch(new RegExp(`revoke execute on function ${f.replace(".", "\\.")}\\([^)]*\\) from public, anon, authenticated`));
    }
  });

  it("os tipos e o tamanho de arquivo da pasta são os da tela", () => {
    const m = SQL5.match(/'dividas', 'dividas', false, (\d+),\s*array\[([^\]]+)\]/);
    expect(Number(m![1])).toBe(ANEXO_MAX_BYTES);
    expect(m![2].split(",").map((x) => x.replace(/['\s]/g, "")).sort()).toEqual([...ANEXO_TIPOS].sort());
  });
});

describe("impacto no Financeiro (fase 3, espelho de _debt_title_spec)", () => {
  const fora = (c: string) => ["6", "5.1", "5.3", "5.4", "5.5"].some((p) => c.startsWith(p));
  const base = {
    origin: "A" as const, contaDaDivida: null, contaDeAberturaDaCategoria: null, contaDeDespesaDaCategoria: null,
    updatedCents: 130_000, originalCents: 100_000, implantacao: "2026-11-16", hoje: "2026-11-20",
    competencia: null, emissao: "2025-02-01", vencimento: "2026-08-10", foraDoResultado: fora,
  };

  it("A: conta de saldo 5.5.01, valor ATUALIZADO (D7), competência na implantação, fora da DRE", () => {
    const i = impactoNoFinanceiro(base);
    expect(i).toMatchObject({ conta: "5.5.01", valorCents: 130_000, competencia: "2026-11-16", naDre: false, saldoDeImplantacao: true, problema: null });
  });

  it("A em categoria de empréstimo usa a conta da categoria (5.3.01)", () => {
    expect(impactoNoFinanceiro({ ...base, contaDeAberturaDaCategoria: "5.3.01" }).conta).toBe("5.3.01");
  });

  it("A com conta de despesa escolhida na dívida: problema (não pode entrar na DRE)", () => {
    expect(impactoNoFinanceiro({ ...base, contaDaDivida: "3.3.01" }).problema).toMatch(/conta de saldo/);
  });

  it("B: conta de despesa, valor ORIGINAL, competência da dívida, entra na DRE", () => {
    const i = impactoNoFinanceiro({ ...base, origin: "B", contaDeDespesaDaCategoria: "3.4.01", competencia: "2026-11" });
    expect(i).toMatchObject({ conta: "3.4.01", valorCents: 100_000, competencia: "2026-11-01", naDre: true, saldoDeImplantacao: false, problema: null });
  });

  it("B sem conta de despesa ou com conta de saldo: problema", () => {
    expect(impactoNoFinanceiro({ ...base, origin: "B" }).problema).toMatch(/conta de despesa/);
    expect(impactoNoFinanceiro({ ...base, origin: "B", contaDaDivida: "5.5.01" }).problema).toMatch(/saldo/);
  });

  it("C não gera título", () => {
    expect(impactoNoFinanceiro({ ...base, origin: "C" }).problema).toMatch(/vincule/);
  });

  it("a frase do resumo diz quantos títulos, onde, quanto e o efeito na DRE", () => {
    expect(fraseDoImpacto(impactoNoFinanceiro(base), "Risarte Cambé", "Saldo de implantação")).toMatch(
      /1 título no Contas a Pagar de Risarte Cambé, de R\$\s?1\.300,00, na conta 5\.5\.01 · Saldo de implantação.*Nenhum lançamento na DRE/
    );
  });

  it("valor devido desconta o que já foi pago nos títulos (e nunca fica negativo)", () => {
    expect(valorDevido({ updatedCents: 130_000, originalCents: 100_000, pagoCents: 65_000 })).toBe(65_000);
    expect(valorDevido({ updatedCents: 1000, originalCents: null, pagoCents: 5000 })).toBe(0);
  });
});

describe("0406 — a prévia do código e a do banco têm as mesmas frases de problema", () => {
  const SQL6 = readFileSync("supabase/migrations/0406_dividas_contas_a_pagar.sql", "utf8");
  it.each([
    "Origem C: vincule os títulos que já estão no Contas a Pagar.",
    "Dívida anterior à implantação precisa de conta de saldo (fora da DRE), como a 5.5.01. Troque a conta da dívida.",
    "Dívida nova precisa da conta de despesa: escolha na dívida ou configure na categoria.",
    "Dívida nova é despesa: a conta não pode ser de saldo (fora da DRE).",
  ])("%s", (frase) => {
    expect(SQL6).toContain(frase);
    expect(readFileSync("src/lib/finance/dividas.ts", "utf8")).toContain(frase);
  });
});

describe("títulos parecidos no Contas a Pagar (ajuste 2: sugerir a origem C)", () => {
  const livres = [
    { id: "1", fornecedorId: "s1", vencimento: "2026-10-01", valorCents: 22_200, documento: null },
    { id: "2", fornecedorId: "s1", vencimento: "2026-10-01", valorCents: 22_201, documento: null },
    { id: "3", fornecedorId: "s2", vencimento: "2026-09-01", valorCents: 1, documento: "NF 123" },
  ];
  it("mesmo credor + vencimento + valor", () => {
    expect(titulosParecidos(livres, { fornecedorId: "s1", vencimento: "2026-10-01", valorCents: 22_200, contrato: null }).map((t) => t.id)).toEqual(["1"]);
  });
  it("ou o mesmo nº de contrato/nota (sem diferença de maiúscula)", () => {
    expect(titulosParecidos(livres, { fornecedorId: "x", vencimento: "2020-01-01", valorCents: 5, contrato: " nf 123 " }).map((t) => t.id)).toEqual(["3"]);
  });
  it("valor diferente em um centavo não é o mesmo título", () => {
    expect(titulosParecidos(livres, { fornecedorId: "s1", vencimento: "2026-10-01", valorCents: 22_199, contrato: null })).toEqual([]);
  });
});
