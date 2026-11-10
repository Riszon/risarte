import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  autorDoAto,
  linhaDeAtos,
  nomeCurto,
  origemAutomatica,
  PELO_SISTEMA,
  SEM_AUTOR,
  textoDoAto,
} from "@/lib/finance/quem-fez";
import { tituloDaLinha, situacaoLegivel } from "@/lib/finance/historico-do-lancamento";

// 0372 — pedido do dono (09/11/2026): todo lançamento do Financeiro mostra
// quem lançou e quem deu baixa, no próprio lançamento.

describe("quem fez e quando (texto único das telas do Financeiro)", () => {
  it("diz o nome, a data e a hora no relógio de Brasília", () => {
    expect(
      textoDoAto({ rotulo: "Lançada", nome: "Maria Souza", quando: "2026-11-09T17:32:00Z" })
    ).toBe("Lançada por Maria Souza em 09/11/2026 às 14:32");
  });

  it("sem autor nunca fica em branco: sistema × antigo (decisão do dono)", () => {
    expect(autorDoAto(null)).toBe(SEM_AUTOR);
    expect(autorDoAto("  ")).toBe(SEM_AUTOR);
    expect(autorDoAto(null, true)).toBe(PELO_SISTEMA);
    expect(textoDoAto({ rotulo: "Lançada", nome: null, automatico: true })).toBe(
      "Lançada pelo sistema"
    );
    expect(textoDoAto({ rotulo: "Cancelada", nome: null })).toBe(
      "Cancelada por autor não registrado"
    );
  });

  it("nome com pessoa vence a marca de automático", () => {
    expect(autorDoAto("Ana", true)).toBe("Ana");
  });

  it("vários atos numa linha, pulando os que não existem", () => {
    expect(
      linhaDeAtos([
        { rotulo: "Lançada", nome: "Ana" },
        null,
        false,
        { rotulo: "Paga", nome: "Bia" },
      ])
    ).toBe("Lançada por Ana · Paga por Bia");
  });

  it("na lista, só o primeiro nome", () => {
    expect(nomeCurto("Maria Souza Lima")).toBe("Maria");
    expect(nomeCurto(null)).toBe(SEM_AUTOR);
    expect(nomeCurto(null, true)).toBe(PELO_SISTEMA);
  });

  it("as origens de rotina do razão são as que nascem sem pessoa", () => {
    expect(origemAutomatica("network_fee_revenue")).toBe(true);
    expect(origemAutomatica("ppr_charge")).toBe(true);
    expect(origemAutomatica("payable_cash")).toBe(false);
    expect(origemAutomatica(null)).toBe(false);
  });
});

describe("histórico do lançamento: o que cada linha da trilha quer dizer", () => {
  const de = (antes: unknown, depois: unknown) => ({ status: { antes, depois } });

  it("conta a pagar", () => {
    expect(tituloDaLinha("payables", "I", {})).toBe("Lançou a conta");
    expect(tituloDaLinha("payables", "U", de("aberta", "cancelada"))).toBe("Cancelou a conta");
    expect(tituloDaLinha("payables", "U", de("aguardando_autorizacao", "aberta"))).toBe(
      "Autorizou a conta"
    );
    expect(tituloDaLinha("payables", "U", de("aguardando_autorizacao", "recusada"))).toBe(
      "Recusou a conta"
    );
    expect(tituloDaLinha("payables", "U", { description: { antes: "a", depois: "b" } })).toBe(
      "Alterou a conta"
    );
  });

  it("pagamento e estorno", () => {
    expect(tituloDaLinha("payable_payments", "I", { amount_cents: 100 })).toBe(
      "Registrou pagamento (baixa)"
    );
    expect(tituloDaLinha("payable_payments", "I", { reversal_of: "x" })).toBe(
      "Estornou um pagamento"
    );
    expect(tituloDaLinha("payment_receipts", "I", { amount_cents: 100 })).toBe(
      "Registrou recebimento (baixa)"
    );
  });

  it("extrato: casar, ignorar e desfazer", () => {
    expect(tituloDaLinha("bank_transactions", "U", de("pendente", "conciliado"))).toBe(
      "Casou com o lançamento"
    );
    expect(tituloDaLinha("bank_transactions", "U", de("pendente", "ignorado"))).toBe(
      "Ignorou a linha"
    );
    expect(tituloDaLinha("bank_transactions", "U", de("conciliado", "pendente"))).toBe(
      "Desfez a conciliação"
    );
    expect(tituloDaLinha("bank_transaction_matches", "D", {})).toBe(
      "Desfez um casamento (Vários)"
    );
  });

  it("a situação aparece em português", () => {
    expect(situacaoLegivel("bank_transactions", "ignorado")).toBe("Ignorada");
    expect(situacaoLegivel("payment_installments", "em_aberto")).toBe("Em aberto");
    expect(situacaoLegivel("payables", "cancelada")).toBe("Cancelada");
  });
});

// ⚠️ A RÉGUA DO BANCO: as três funções que antes não guardavam o autor no
// próprio registro (0372). Ao recriar qualquer uma delas numa migração nova,
// levar a gravação junto — senão o "Cancelada por …" volta a ficar sem nome.
describe("o banco grava quem cancelou, ignorou e desfez (0372)", () => {
  const pasta = join(process.cwd(), "supabase", "migrations");
  const arquivos = readdirSync(pasta)
    .filter((f) => /^0\d{3}_.*\.sql$/.test(f))
    .sort();

  /** O corpo da ÚLTIMA migração que (re)cria a função. */
  function ultimaVersao(funcao: string): string {
    let achada = "";
    for (const f of arquivos) {
      const t = readFileSync(join(pasta, f), "utf8").toLowerCase();
      // A CRIAÇÃO, não o "grant/revoke ... on function" que vem depois dela.
      const criacoes = [
        ...t.matchAll(new RegExp(`create or replace function public\\.${funcao}\\s*\\(`, "g")),
      ];
      if (criacoes.length === 0) continue;
      const i = criacoes[criacoes.length - 1].index ?? 0;
      const fim = t.indexOf("$;", t.indexOf("as $", i) + 4);
      achada = t.slice(i, fim > 0 ? fim : undefined);
    }
    expect(achada, `não achei public.${funcao} nas migrações`).not.toBe("");
    return achada.toLowerCase();
  }

  it("cancel_payable grava cancelled_by e cancelled_at", () => {
    const f = ultimaVersao("cancel_payable");
    expect(f).toMatch(/cancelled_by\s*=/);
    expect(f).toMatch(/cancelled_at\s*=/);
  });

  it("ignore_bank_transaction grava ignored_by e ignored_at", () => {
    const f = ultimaVersao("ignore_bank_transaction");
    expect(f).toMatch(/ignored_by\s*=\s*\(select auth\.uid\(\)\)/);
    expect(f).toMatch(/ignored_at\s*=/);
  });

  it("unreconcile_bank_transaction grava undone_by e undone_at", () => {
    const f = ultimaVersao("unreconcile_bank_transaction");
    expect(f).toMatch(/undone_by\s*=\s*\(select auth\.uid\(\)\)/);
    expect(f).toMatch(/undone_at\s*=/);
  });
});
