import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// 0373 (09/11/2026, cliente CBE-00001 de Cambé): a venda ainda em negociação
// entrou na DRE como receita — e EM DOBRO, porque a negociação foi salva duas
// vezes. Duas causas no banco:
//   1. a receita nascia com a COBRANÇA (gatilho da 0187), não com a VENDA;
//   2. salvar de novo apagava as cobranças e deixava a receita delas aberta.
//
// O ensaio `scripts/receita-ensaio-0373.mjs` prova o comportamento no
// PostgreSQL (e reprova nas 4 quebras). Esta régua prende o TEXTO: a próxima
// migração que recriar estas funções sem a trava reprova aqui, antes de ir ao
// dono — foi exatamente assim que travas antigas se perderam (o "levar junto"
// que dependia de memória).

const PASTA = join(__dirname, "..", "..", "..", "supabase", "migrations");

function arquivosSql(): { arquivo: string; sql: string }[] {
  return readdirSync(PASTA)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
    .map((arquivo) => ({
      arquivo,
      sql: readFileSync(join(PASTA, arquivo), "utf8")
        .replace(/\r\n/g, "\n")
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--"))
        .join("\n"),
    }));
}

/** Corpo de cada função, pela última migração que a (re)cria. */
function ultimasDefinicoes(): Map<string, { arquivo: string; corpo: string }> {
  const defs = new Map<string, { arquivo: string; corpo: string }>();
  const FN =
    /create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\([\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\2/gi;
  for (const { arquivo, sql } of arquivosSql()) {
    for (const m of sql.matchAll(FN)) {
      const nome = m[1].toLowerCase().replace(/"/g, "");
      defs.set(nome.includes(".") ? nome : `public.${nome}`, { arquivo, corpo: m[3] });
    }
  }
  return defs;
}

/** Último comando sobre um gatilho: "create" (de pé) ou "drop" (derrubado). */
function situacaoDoGatilho(nome: string): { arquivo: string; acao: string; texto: string } | null {
  let ultimo: { arquivo: string; acao: string; texto: string } | null = null;
  const re = new RegExp(
    `(create|drop)\\s+trigger\\s+(?:if\\s+exists\\s+)?${nome}\\b([\\s\\S]*?);`,
    "gi"
  );
  for (const { arquivo, sql } of arquivosSql()) {
    for (const m of sql.matchAll(re)) {
      ultimo = { arquivo, acao: m[1].toLowerCase(), texto: m[2].replace(/\s+/g, " ") };
    }
  }
  return ultimo;
}

/** Tira comentários e textos entre aspas, para a régua não casar com eles. */
const soCodigo = (corpo: string) =>
  corpo.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, (t) =>
    t === "'installment_accrual'" ? t : "''"
  );

/** A trava: pergunta se a venda fechou e SAI quando não fechou. */
function temATravaDaVendaFechada(corpo: string): boolean {
  const c = soCodigo(corpo).replace(/\s+/g, " ");
  const m = c.match(/(\w+)\s*:=\s*public\.installment_sale_closed_on\(/i);
  if (!m) return false;
  return new RegExp(`if ${m[1]} is null then return; end if;`, "i").test(c);
}

describe("receita só com a venda fechada (0373)", () => {
  const defs = ultimasDefinicoes();

  it("a leitura das migrações acha o que mede (régua que não acha nada grita)", () => {
    expect(defs.size).toBeGreaterThan(400);
    expect(defs.get("public.post_installment_accrual")).toBeDefined();
    expect(defs.get("public.sync_installment_accrual_status")).toBeDefined();
    expect(defs.get("public.installment_sale_closed_on")).toBeDefined();
  });

  it("a régua reconhece a trava e o defeito", () => {
    const certo = `v_closed_on := public.installment_sale_closed_on(v_inst);
                   if v_closed_on is null then return; end if; insert ...`;
    expect(temATravaDaVendaFechada(certo)).toBe(true);
    // Pergunta e não sai: é o defeito com cara de correção.
    const soPergunta = `v_closed_on := public.installment_sale_closed_on(v_inst); insert ...`;
    expect(temATravaDaVendaFechada(soPergunta)).toBe(false);
    // Só no comentário não vale.
    expect(temATravaDaVendaFechada(`-- installment_sale_closed_on is null then return\n insert`)).toBe(false);
  });

  it("lançar a receita da cobrança exige a venda fechada", () => {
    const d = defs.get("public.post_installment_accrual")!;
    expect(temATravaDaVendaFechada(d.corpo), `trava perdida em ${d.arquivo}`).toBe(true);
  });

  it("a 'volta atrás' da cobrança cancelada só reabre receita de venda fechada", () => {
    const d = defs.get("public.sync_installment_accrual_status")!;
    const c = soCodigo(d.corpo).replace(/\s+/g, " ");
    expect(c, `trava perdida em ${d.arquivo}`).toMatch(
      /elsif [^;]*public\.installment_sale_closed_on\(new\) is not null/i
    );
  });

  it("nenhuma outra função lança receita de cobrança por fora da porta", () => {
    const porFora = [...defs.entries()]
      .filter(([nome]) => nome !== "public.post_installment_accrual")
      .filter(([, d]) => {
        // Só o que o INSERT grava; o `on conflict ... in ('installment_accrual', ...)`
        // das outras origens só cita o nome.
        return soCodigo(d.corpo)
          .replace(/\s+/g, " ")
          .split(";")
          .filter((cmd) => /insert into public\.financial_entries\b/i.test(cmd))
          .some((cmd) => /'installment_accrual'/.test(cmd.split(/on conflict/i)[0]));
      })
      .map(([nome, d]) => `${nome} (${d.arquivo})`);
    expect(porFora).toEqual([]);
  });

  it("cobrança apagada cancela a própria receita (gatilho de pé, antes de apagar)", () => {
    const g = situacaoDoGatilho("payment_installments_cancel_accrual");
    expect(g?.acao).toBe("create");
    expect(g?.texto).toMatch(/before delete on public\.payment_installments/i);
    const f = defs.get("public.cancel_accrual_of_deleted_installment");
    expect(f).toBeDefined();
    expect(soCodigo(f!.corpo)).toMatch(/set status = ''|set status = 'cancelled'|status = ''/i);
  });

  it("fechar a venda lança a receita das cobranças dela (os 4 gatilhos de pé)", () => {
    for (const nome of [
      "commercial_sales_post_accruals_upd",
      "commercial_sales_post_accruals_ins",
      "direct_sales_post_accruals_upd",
      "direct_sales_post_accruals_ins",
    ]) {
      const g = situacaoDoGatilho(nome);
      expect(g?.acao, nome).toBe("create");
      expect(g?.texto, nome).toMatch(/post_sale_accruals_on_close\(\)/);
    }
    const f = defs.get("public.post_sale_accruals_on_close")!;
    expect(soCodigo(f.corpo)).toMatch(/perform public\.post_installment_accrual\(/i);
  });
});
