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
    nextAction: null, nextActionOn: null, ...o,
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

  it("totais: devido usa o atualizado quando há; contestada/judicial em subtotal à parte (D17)", () => {
    const t = totaisDaLista(rows);
    expect(t.quantidade).toBe(3);
    expect(t.devidoCents).toBe(5000 + 1000 + 300);
    expect(t.contestadaJudicialCents).toBe(300);
  });
});

describe("as permissões do módulo — tela e banco iguais, e o teto", () => {
  const doBanco = (cap: string): string[] => {
    const m = SQL.match(new RegExp(`when '${cap.replace(/\./g, "\\.")}' then array\\[([^\\]]*)\\]`));
    if (!m) return [];
    return m[1].split(",").map((s) => s.replace(/['\s]/g, "")).filter(Boolean).sort();
  };
  const caps = CAPACIDADES.filter((c) => c.id === "modulo.dividas" || c.id.startsWith("acao.dividas."));

  it("são as 4 da fase 1", () => {
    expect(caps.map((c) => c.id).sort()).toEqual([
      "acao.dividas.configurar", "acao.dividas.excluir", "acao.dividas.lancar", "modulo.dividas",
    ]);
  });

  it.each(caps.map((c) => [c.id, c] as const))("%s: o padrão do código é o do banco", (_id, c) => {
    expect([...c.padrao].sort()).toEqual(doBanco(c.id));
  });

  it("o teto do banco é só o Financeiro da Franqueadora", () => {
    const teto = SQL.slice(SQL.indexOf("function public._debt_cap_ceiling"), SQL.indexOf("revoke execute on function public._debt_cap_ceiling"));
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
