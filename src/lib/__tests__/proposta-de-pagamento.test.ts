import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lerProposta, parcelamentoDaNegociacao } from "@/lib/proposta-de-pagamento";
import { OPTION_REVIEW_LABELS, PLAN_STAGE_LABELS, PLAN_STATUS_LABELS } from "@/lib/planning";

// 0374 (AP130/AP131, 10/11/2026): com a negociação aberta, o parcelamento é só
// a PROPOSTA, guardada na negociação. A cobrança nasce no "Cliente aceitou".
// Antes, o "Salvar negociação" criava cobranças de verdade, e elas contavam em
// Recebíveis, Fluxo de caixa, painéis, alertas e Metas (CBE-00001).
// O ensaio `scripts/proposta-ensaio-0374.mjs` prova no PostgreSQL; esta régua
// prende o texto para a próxima migração não perder a trava.

const RAIZ = join(__dirname, "..", "..", "..");
const PASTA = join(RAIZ, "supabase", "migrations");

function arquivosSql() {
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
function ultimasDefinicoes() {
  const defs = new Map<string, { arquivo: string; corpo: string }>();
  const FN =
    /create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\([\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\2/gi;
  for (const { arquivo, sql } of arquivosSql()) {
    for (const m of sql.matchAll(FN)) {
      const nome = m[1].toLowerCase().replace(/"/g, "");
      defs.set(nome.includes(".") ? nome : `public.${nome}`, {
        arquivo,
        corpo: m[3].replace(/--[^\n]*/g, "").replace(/\s+/g, " "),
      });
    }
  }
  return defs;
}
function ultimoComandoDoGatilho(nome: string) {
  let ultimo: { acao: string; texto: string } | null = null;
  const re = new RegExp(`(create|drop)\\s+trigger\\s+(?:if\\s+exists\\s+)?${nome}\\b([\\s\\S]*?);`, "gi");
  for (const { sql } of arquivosSql()) {
    for (const m of sql.matchAll(re)) ultimo = { acao: m[1].toLowerCase(), texto: m[2].replace(/\s+/g, " ") };
  }
  return ultimo;
}
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf8").replace(/\r\n/g, "\n");

describe("o parcelamento que a tela mostra", () => {
  const cob = (seq: number, status = "em_aberto") => ({
    seq,
    kind: "parcela",
    due_date: `2027-0${seq}-10`,
    amount_cents: 100,
    status,
  });
  const prop = [
    { kind: "entrada", due_date: "2026-12-01", amount_cents: 300, payment_method: "pix" },
    { kind: "parcela", due_date: "2027-01-01", amount_cents: 700 },
  ];

  it("negociação aberta: mostra a proposta guardada (o caso do dono)", () => {
    const p = parcelamentoDaNegociacao([], prop);
    expect(p.map((e) => [e.seq, e.kind, e.amountCents])).toEqual([
      [1, "entrada", 300],
      [2, "parcela", 700],
    ]);
  });
  it("depois do aceite: mostra as cobranças de verdade", () => {
    expect(parcelamentoDaNegociacao([cob(2), cob(1)], prop).map((e) => e.seq)).toEqual([1, 2]);
  });
  it("cobrança cancelada não conta como parcelamento vivo", () => {
    expect(parcelamentoDaNegociacao([cob(1, "cancelada")], prop)).toHaveLength(2);
  });
  it("proposta estragada ou ausente vira vazio, sem quebrar a tela", () => {
    expect(lerProposta(null)).toEqual([]);
    expect(lerProposta("x")).toEqual([]);
    expect(lerProposta([{ due_date: 1 }, null])).toEqual([]);
  });
});

describe("a proposta mora na negociação (0374)", () => {
  const defs = ultimasDefinicoes();

  it("a leitura acha o que mede (régua que não acha nada grita)", () => {
    expect(defs.size).toBeGreaterThan(400);
    expect(defs.get("public.save_payment_schedule")).toBeDefined();
  });

  it("salvar com a negociação aberta grava só a proposta e SAI antes de criar cobrança", () => {
    const d = defs.get("public.save_payment_schedule")!;
    const c = d.corpo;
    const ramo = c.match(
      /if p_negotiation_id is not null and v_neg_status is distinct from 'aceita' and not public\._negotiation_sale_closed\(p_negotiation_id\) then(.*?)end if;/
    );
    expect(ramo, `ramo da proposta perdido em ${d.arquivo}`).not.toBeNull();
    expect(ramo![1]).toMatch(/proposed_schedule = v_proposta/);
    expect(ramo![1]).toMatch(/return;\s*$/);
    expect(ramo![1]).not.toMatch(/insert into public\.payment_installments/);
    // E o ramo vem ANTES do laço que cria as cobranças.
    expect(c.indexOf(ramo![0])).toBeLessThan(c.indexOf("insert into public.payment_installments"));
  });

  it("o aceite cria as cobranças e renegociar devolve à proposta (gatilho de pé)", () => {
    const g = ultimoComandoDoGatilho("plan_negotiations_schedule_on_status");
    expect(g?.acao).toBe("create");
    expect(g?.texto).toMatch(/after update of status on public\.plan_negotiations/i);
    const f = defs.get("public.negotiation_schedule_on_status")!.corpo;
    expect(f).toMatch(/new\.status = 'aceita'.*perform public\._materialize_negotiation_schedule\(new\.id\)/);
    expect(f).toMatch(/old\.status = 'aceita'.*perform public\._schedule_back_to_proposal\(new\.id\)/);
    expect(defs.get("public._materialize_negotiation_schedule")!.corpo).toMatch(/raise exception 'SCHEDULE_TOTAL_MISMATCH'/);
  });

  it("cockpit e orçamento impresso leem pela regra única", () => {
    for (const p of [
      "src/app/(app)/apresentacao/[clientId]/negotiation-loader.ts",
      "src/app/orcamentos/[id]/page.tsx",
    ]) {
      expect(ler(p), p).toMatch(/parcelamentoDaNegociacao\(/);
    }
  });

  it("o aceite explica a recusa do parcelamento que não fecha", () => {
    expect(ler("src/app/(app)/apresentacao/[clientId]/negotiation-actions.ts")).toMatch(
      /SCHEDULE_TOTAL_MISMATCH/
    );
  });
});

describe('"aprovado" é contrato assinado; o Coordenador LIBERA (dono, 10/11/2026)', () => {
  it("os rótulos do plano não dizem aprovado", () => {
    expect(PLAN_STATUS_LABELS.approved).not.toMatch(/aprovad/i);
    expect(OPTION_REVIEW_LABELS.approved).not.toMatch(/aprovad/i);
    expect(PLAN_STAGE_LABELS.aprovado_coordenador).not.toMatch(/aprovad/i);
  });
});
