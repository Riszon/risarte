import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// AP61 (decisão do dono, 03/11/2026): "paga por procedimento concluído. Se um
// procedimento tem 3 sessões só vai contabilizar para o repasse quando
// finalizar as 3 sessões daquele procedimento."
//
// Antes, `accrue_session_payout` lançava o valor inteiro a cada sessão: num
// item com quantidade 2 e protocolo de 3 sessões, o ensaio no treino deu 6
// repasses (R$ 600,00 com a tabela em R$ 100,00) onde o certo são 2
// (R$ 200,00). A prova de comportamento é o ensaio em transação desfeita
// (registrado no ESTADO, bloco 0.386.0); esta régua prende o texto da
// definição mais recente, para quem recriar a função não perder a regra.

const PASTA = join(__dirname, "..", "..", "..", "supabase", "migrations");
const arquivos = readdirSync(PASTA).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const sql = (f: string) => readFileSync(join(PASTA, f), "utf8").replace(/\r\n/g, "\n");

function ultimaDefinicao(nome: string): { arquivo: string; corpo: string } {
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${nome}\\s*\\([\\s\\S]*?\\bas\\s+(\\$\\w*\\$)([\\s\\S]*?)\\1`,
    "gi"
  );
  let achado: { arquivo: string; corpo: string } | null = null;
  for (const f of arquivos) for (const m of sql(f).matchAll(re)) achado = { arquivo: f, corpo: m[2] };
  if (!achado) throw new Error(`NÃO MEDI: não achei a definição de public.${nome}`);
  return achado;
}

describe("AP61: o repasse sai por procedimento concluído", () => {
  // Desde a 0398 (AP141) a conta do bloco mora em `_payout_accrue_block`; o
  // gatilho cuida da venda direta e chama a conta para o item do plano.
  const gatilho = ultimaDefinicao("accrue_session_payout");
  const bloco = ultimaDefinicao("_payout_accrue_block");
  const arquivo = gatilho.arquivo;
  const corpo = gatilho.corpo + "\n" + bloco.corpo;

  it("o gatilho entrega o item do plano à conta do bloco", () => {
    expect(gatilho.corpo).toContain("perform public._payout_accrue_block(new.id);");
  });

  it("a definição mais recente é a da 0352 ou posterior", () => {
    expect(arquivo >= "0352").toBe(true);
  });

  it("acha o bloco de sessões do procedimento pela quantidade do item", () => {
    expect(corpo).toContain("from public.treatment_plan_option_items i");
    expect(corpo).toContain("v_per := v_total / v_qty;");
    expect(corpo).toContain("s.session_index between v_from and v_to");
  });

  it("só lança quando nenhuma sessão do bloco está por fazer (concluída ou cancelada — AP141)", () => {
    expect(corpo).toMatch(/s\.id = any\(v_block\) and s\.status not in \('done', 'cancelled'\)[\s\S]*?return;/);
  });

  it("não paga de novo um procedimento que já tem repasse (refação)", () => {
    expect(bloco.corpo).toMatch(/from public\.provider_payouts p where p\.session_id = any\(v_block\)[\s\S]*?return;/);
    expect(gatilho.corpo).toMatch(/from public\.provider_payouts p where p\.session_id = any\(v_block\)[\s\S]*?return new;/);
  });

  it("revisão não paga e não conta no bloco", () => {
    expect(gatilho.corpo).toContain("if new.redo_kind is not distinct from 'revisao' then");
    expect(bloco.corpo).toContain("if v_s.redo_kind is not distinct from 'revisao' then return; end if;");
    expect(bloco.corpo.match(/redo_kind is distinct from 'revisao'/g)?.length).toBe(2);
  });

  it("o bloco único (sessões que não dividem pela quantidade) paga a quantidade toda", () => {
    expect(corpo).toContain("v_units := v_qty;");
    expect(corpo).toContain("coalesce(v_rate.amount_cents, 0) * v_units");
  });

  it("venda direta continua: cada sessão sem item já é um procedimento", () => {
    expect(corpo).toMatch(/if new\.item_id is null then\s+--[^\n]*\n\s+v_block := array\[new\.id\];/);
  });
});
