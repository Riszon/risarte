import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  conferirVagasParaTitulares,
  recusaDaPlanilha,
  vagasParaTitulares,
} from "@/lib/empresarial/vagas";

// AP97 (item 6 do plano de correções da Rita, 03/11/2026): a trava da
// quantidade contratada vivia só no cadastro um a um; a importação de planilha
// — o caminho da lista que a empresa manda — não perguntava. Agora a conta é
// UMA (`vagasParaTitulares`) e os dois caminhos perguntam a ela.

type Db = Parameters<typeof vagasParaTitulares>[0];

type Respostas = {
  limite?: { data: unknown; error: unknown };
  companies?: { data: unknown; error: unknown };
  ativos?: { count: number | null; error: unknown };
};

/** Um banco de mentira que responde o combinado e ANOTA que tabelas leu. */
function bancoFalso(r: Respostas) {
  const tabelasLidas: string[] = [];
  const filtros: Record<string, unknown>[] = [];
  function cadeia(tabela: string) {
    const c = {
      select: () => c,
      eq: (coluna: string, valor: unknown) => {
        filtros.push({ tabela, coluna, valor });
        return c;
      },
      maybeSingle: () => Promise.resolve(r.companies ?? { data: null, error: null }),
      then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
        Promise.resolve(r.ativos ?? { count: null, error: null }).then(ok, falha),
    };
    return c;
  }
  const db = {
    rpc: () => Promise.resolve(r.limite ?? { data: null, error: null }),
    from: (tabela: string) => {
      tabelasLidas.push(tabela);
      return cadeia(tabela);
    },
  } as unknown as Db;
  return { db, tabelasLidas, filtros };
}

describe("a conta pura: cabem N titulares?", () => {
  it("limite 5, 4 ativos, 2 novos → RECUSA, com a frase da planilha", () => {
    // O caso do plano: a planilha pede mais do que sobra.
    const r = conferirVagasParaTitulares(5, null, 4, 2);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe(recusaDaPlanilha(2, 1));
    expect(r.motivo).toContain("2 titular(es) novo(s)");
    expect(r.motivo).toContain("1 vaga(s)");
    expect(r.motivo).toContain("renegocie o limite ou reduza a lista");
  });

  it("limite 5, 4 ativos, 1 novo → cabe, e sobra zero", () => {
    const r = conferirVagasParaTitulares(5, null, 4, 1);
    expect(r).toEqual({ ok: true, vagas: 0, ativos: 4 });
  });

  it("um por vez, cheio → a frase de sempre do cadastro (a tela e o manual a conhecem)", () => {
    const r = conferirVagasParaTitulares(5, null, 5, 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain("já tem 5 titular(es) ativos, e o contrato fechou 5");
    expect(r.motivo).toContain("termo de inclusão");
  });

  it("limite NULO é sem trava, não zero (empresa anterior à regra)", () => {
    const r = conferirVagasParaTitulares(null, null, 500, 120);
    expect(r).toEqual({ ok: true, vagas: null, ativos: 500 });
  });

  it("o máximo da proposta é teto separado, e pode ser maior que o contratado", () => {
    // Fechou 100, pode chegar a 120 sem renegociar: 100 cabem no contratado…
    const teto = { max_adhesions: 120, adhesion_limit_target: "HOLDERS" as const };
    expect(conferirVagasParaTitulares(100, teto, 90, 10).ok).toBe(true);
    // …e a sobra que a resposta diz é a MENOR das duas (contrato esgotado).
    expect(conferirVagasParaTitulares(100, teto, 90, 10)).toMatchObject({ vagas: 0 });
    // Sem limite no contrato, o máximo da proposta ainda trava.
    const r = conferirVagasParaTitulares(null, teto, 118, 3);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain("máximo combinado na proposta é 120");
  });

  it("máximo combinado SÓ para dependentes não diz nada sobre titulares", () => {
    const teto = { max_adhesions: 3, adhesion_limit_target: "DEPENDENTS" as const };
    expect(conferirVagasParaTitulares(null, teto, 50, 10).ok).toBe(true);
  });

  it("zero novos nunca recusa (reimportar a mesma planilha é inofensivo)", () => {
    expect(conferirVagasParaTitulares(5, null, 5, 0).ok).toBe(true);
  });
});

describe("lendo o banco", () => {
  it("conta SÓ titulares ativos — dependentes não ocupam vaga", async () => {
    const { db, tabelasLidas, filtros } = bancoFalso({
      limite: { data: 10, error: null },
      companies: { data: { max_adhesions: null, adhesion_limit_target: null }, error: null },
      ativos: { count: 8, error: null },
    });
    const r = await vagasParaTitulares(db, "empresa", 2);
    expect(r).toEqual({ ok: true, vagas: 0, ativos: 8 });
    // A tabela de dependentes NÃO entra na conta.
    expect(tabelasLidas).toEqual(["companies", "employees"]);
    expect(filtros).toContainEqual({ tabela: "employees", coluna: "status", valor: "ACTIVE" });
    expect(filtros).toContainEqual({ tabela: "employees", coluna: "company_id", valor: "empresa" });
  });

  it("sem trava nenhuma, nem conta (uma leitura a menos)", async () => {
    const { db, tabelasLidas } = bancoFalso({
      limite: { data: null, error: null },
      companies: { data: { max_adhesions: null, adhesion_limit_target: null }, error: null },
    });
    const r = await vagasParaTitulares(db, "empresa", 300);
    expect(r).toEqual({ ok: true, vagas: null, ativos: null });
    expect(tabelasLidas).toEqual(["companies"]);
  });

  it("a função do banco devolve a linha como lista: lê o primeiro valor", async () => {
    const { db } = bancoFalso({
      limite: { data: [5], error: null },
      companies: { data: null, error: null },
      ativos: { count: 4, error: null },
    });
    const r = await vagasParaTitulares(db, "empresa", 2);
    expect(r.ok).toBe(false);
  });

  // ⚠️ AP11: leitura que falha é RECUSA, nunca "sem trava" nem "zero".
  it("falha ao ler o limite → recusa dizendo que nada foi alterado", async () => {
    const { db } = bancoFalso({ limite: { data: null, error: { message: "caiu" } } });
    const r = await vagasParaTitulares(db, "empresa", 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain("quantidade contratada");
    expect(r.motivo).toContain("Nada foi alterado");
  });

  it("falha ao ler o máximo da proposta → recusa", async () => {
    const { db } = bancoFalso({
      limite: { data: 10, error: null },
      companies: { data: null, error: { message: "caiu" } },
    });
    const r = await vagasParaTitulares(db, "empresa", 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain("limite combinado na proposta");
  });

  it("contagem que não contou (count nulo) → recusa, nunca zero ativos", async () => {
    // Com `count ?? 0`, 10 vagas pareceriam livres e a planilha entraria.
    const { db } = bancoFalso({
      limite: { data: 10, error: null },
      companies: { data: null, error: null },
      ativos: { count: null, error: null },
    });
    const r = await vagasParaTitulares(db, "empresa", 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain("quantos titulares a empresa já tem ativos");
  });
});

describe("⚠️ régua: os dois caminhos perguntam à MESMA conta", () => {
  const acao = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "app",
      "(app)",
      "empresarial",
      "[companyId]",
      "employee-actions.ts"
    ),
    "utf8"
  ).replace(/\r\n/g, "\n");

  function corpoDe(nome: string): string {
    const ini = acao.indexOf(`export async function ${nome}(`);
    expect(ini, `não achei ${nome}`).toBeGreaterThan(-1);
    const fim = acao.indexOf("\nexport ", ini + 1);
    return acao.slice(ini, fim < 0 ? undefined : fim);
  }

  it("o cadastro um a um pede 1 vaga a vagasParaTitulares", () => {
    expect(corpoDe("createEmployee")).toMatch(/vagasParaTitulares\(db, companyId, 1\)/);
  });

  it("a importação pede vaga para os CPFs NOVOS, e ANTES de gravar", () => {
    const corpo = corpoDe("importEmployees");
    const pergunta = corpo.indexOf("vagasParaTitulares(db, companyId, conferida.cpfsNovos.length)");
    // AP111 (1042): a gravação é a função do banco, as duas abas juntas.
    const grava = corpo.indexOf('db.rpc("importar_titulares"');
    expect(pergunta).toBeGreaterThan(-1);
    expect(grava).toBeGreaterThan(-1);
    expect(pergunta).toBeLessThan(grava);
  });

  it("nenhuma conta paralela do limite sobrou no arquivo de ações", () => {
    // Duas contas para a mesma pergunta é como a tela e a planilha divergem.
    expect(acao).not.toContain('rpc("limite_de_titulares"');
    expect(acao).not.toContain("recusaDoCadastro(");
  });
});
