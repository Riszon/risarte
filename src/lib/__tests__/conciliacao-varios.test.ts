import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  candidatosParaVarios,
  CONTA_DE_TRANSFERENCIA,
  somaDosLancamentos,
  type LedgerEntry,
} from "@/lib/finance/reconciliation";

// Relato OC-00108 (16/10/2026): na conciliação "não há opção para baixa do
// crédito", "ignorar" tira o valor do saldo, e o receio de duplicar a baixa do
// boleto do paciente. Pesquisa a fundo (pedido do dono): a regra de casar ×
// lançar segue; as lacunas eram o depósito da maquininha (líquido, várias
// vendas — só casava 1 com 1 de mesmo valor) e a transferência entre contas
// próprias (só dava para ignorar). E a tela lia no máximo 1.000 linhas.

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const MIGRACAO = ler("supabase/migrations/0301_conciliacao_transferencia_e_varios_lancamentos.sql");

const e = (id: string, amountCents: number, cashDate: string, reconciled = false): LedgerEntry => ({
  id,
  amountCents,
  cashDate,
  description: id,
  accountCode: "1.1.01",
  reconciled,
});

describe("uma linha do extrato com vários lançamentos", () => {
  it("o depósito da maquininha = recebimentos − taxas", () => {
    // Duas vendas de R$ 200 e R$ 100 no cartão, taxas de R$ 6 e R$ 3: o banco deposita R$ 291.
    expect(somaDosLancamentos([e("a", 20000, "2026-10-10"), e("b", 10000, "2026-10-10"), e("t1", -600, "2026-10-10"), e("t2", -300, "2026-10-10")])).toBe(29100);
  });

  it("candidatos: só os sem par, até 7 dias da linha, os mais perto primeiro", () => {
    const lista = [
      e("longe", 100, "2026-10-01"),
      e("perto", 100, "2026-10-14"),
      e("mesmo-dia", 100, "2026-10-15"),
      e("ja-conciliado", 100, "2026-10-15", true),
      e("depois", 100, "2026-10-20"),
    ];
    expect(candidatosParaVarios({ postedAt: "2026-10-15" }, lista).map((x) => x.id)).toEqual(["mesmo-dia", "perto", "depois"]);
  });
});

describe("a transferência entre contas próprias (0301)", () => {
  it("é a conta 6.3.01, de ATIVO — o grupo 6 fica fora da DRE", () => {
    expect(CONTA_DE_TRANSFERENCIA).toBe("6.3.01");
    expect(MIGRACAO).toMatch(/\('6\.3\.01', 'Aplicações e transferências entre contas próprias', +'6\.3', 'expense', 'asset'/);
  });

  it("a DRE e o resultado excluem o grupo 6 (é por isso que a transferência não vira receita)", () => {
    // A definição mais recente de cada função de resultado, nas migrações.
    const pasta = join(RAIZ, "supabase", "migrations");
    const arquivos = readdirSync(pasta).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    for (const nome of ["dre_lines", "profit_cash_bridge", "budget_vs_actual", "consolidated_dre"]) {
      let corpo = "";
      const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${nome}\\s*\\([\\s\\S]*?\\bas\\s+(\\$\\w*\\$)([\\s\\S]*?)\\1`, "gi");
      for (const f of arquivos) for (const m of readFileSync(join(pasta, f), "utf8").matchAll(re)) corpo = m[2];
      expect(corpo, nome).not.toBe("");
      // Função com "porta" (padrão 0282): a conta mora em `_X_raw` e a porta
      // só confere a guarda — a regra vale onde a conta está. `dre_lines`
      // virou porta na 0320.
      if (corpo.includes(`public._${nome}_raw(`)) {
        const reRaw = new RegExp(re.source.replace(String.raw`public\.` + nome, String.raw`public\._` + nome + "_raw"), "gi");
        let raw = "";
        for (const f of arquivos) for (const m of readFileSync(join(pasta, f), "utf8").matchAll(reRaw)) raw = m[2];
        expect(raw, `_${nome}_raw`).not.toBe("");
        corpo = raw;
      }
      expect(corpo, nome).toContain("not like '6%'");
    }
  });

  it("no fluxo de caixa conta como INVESTIMENTO (resgate não é dinheiro da operação)", () => {
    expect(MIGRACAO).toContain("when e.account_code like '5.1%' or e.account_code like '6.3%' then 'investimento'");
    expect(MIGRACAO).toContain("when p.account_code like '5.1%' or p.account_code like '6.3%' then 'investimento'");
  });
});

describe("o banco confere a conciliação de vários (0301)", () => {
  const i = MIGRACAO.indexOf("create or replace function public.reconcile_bank_transaction_multi(");
  const corpo = MIGRACAO.slice(i, MIGRACAO.indexOf("$$;", MIGRACAO.indexOf("as $$", i)));

  it("a soma tem de bater no centavo, com permissão, e com lançamentos livres", () => {
    expect(corpo).toContain("if not public.can_reconcile(v_tx.clinic_id) then raise exception 'NOT_ALLOWED'; end if;");
    expect(corpo).toContain("if v_soma <> v_tx.amount_cents then raise exception 'AMOUNT_MISMATCH'; end if;");
    expect(corpo).toContain("and e.reconciled_at is null;");
    expect(corpo).toContain("if coalesce(v_qtd, 0) < 2 then raise exception 'NEED_TWO_OR_MORE'; end if;");
  });

  it("um lançamento concilia com UMA linha só, em qualquer dos dois caminhos", () => {
    expect(MIGRACAO).toContain("create unique index if not exists bank_transaction_matches_entry_unique");
    expect(MIGRACAO).toContain("if v_entry.reconciled_at is not null then raise exception 'ENTRY_ALREADY_RECONCILED'; end if;");
  });

  it("desfazer solta todos os lançamentos da linha", () => {
    expect(MIGRACAO).toContain("delete from public.bank_transaction_matches where transaction_id = p_transaction_id;");
    expect(MIGRACAO).toMatch(/update public\.financial_entries e\s+set reconciled_at = null, reconciled_by = null\s+from public\.bank_transaction_matches m/);
  });

  it("a tabela nova entra na auditoria e não abre para quem não está logado", () => {
    expect(MIGRACAO).toContain("select public.audit_attach_all();");
    expect(MIGRACAO).toContain("revoke execute on function public.reconcile_bank_transaction_multi(uuid, uuid[]) from public, anon, authenticated;");
  });
});

describe("a tela da conciliação", () => {
  const tela = ler("src/app/(app)/financeiro/conciliacao/reconciliation-board.tsx");
  const pagina = ler("src/app/(app)/financeiro/conciliacao/page.tsx");

  it("avisa antes de lançar o que já está no sistema (contra duplicar)", () => {
    expect(tela).toMatch(/const parecidosAoLancar = useMemo\(\s*\(\) =>\s*creatingFor\s*\?\s*suggestMatches\(/);
    expect(tela).toContain("Isto parece já estar no sistema.");
    expect(tela).toContain("Conciliar com este");
    // O recebimento do paciente nasce em Recebíveis: lançar de novo duplicaria.
    expect(tela).toContain("nasce na baixa da parcela, em Recebíveis");
  });

  it("tem Vários e Transferência, e só concilia vários quando a soma bate", () => {
    expect(tela).toContain("accountCode: CONTA_DE_TRANSFERENCIA,");
    expect(tela).toMatch(/variosSel\.length < 2 \|\|\s+somaDosVarios !== variosFor\.amountCents/);
  });

  it("o Ignorar não manda mais transferência para lá", () => {
    expect(tela).not.toContain("transferência para a conta poupança da própria unidade");
    expect(tela).toContain("deixa de bater com o extrato");
  });

  it("lê o extrato e os lançamentos INTEIROS, em páginas, e avisa se falhar", () => {
    // Extrato, lançamentos e (OC-00110) as contas a pagar em aberto.
    expect(pagina.match(/lerTodasAsPaginas<Record<string, unknown>>\(\(de, ate\) =>/g)).toHaveLength(3);
    // O envelope sem o .range() leria a mesma primeira página para sempre: a
    // página tem de ir até o fim de cada leitura.
    for (const tabela of ["bank_transactions", "financial_entries", "payables"]) {
      const i = pagina.indexOf(`.from("${tabela}")`);
      expect(i, tabela).toBeGreaterThan(0);
      const trecho = pagina.slice(i, pagina.indexOf("),", pagina.indexOf(".range(", i) > 0 ? pagina.indexOf(".range(", i) : i));
      expect(trecho, tabela).toContain(".range(de, ate)");
    }
    expect(pagina).toContain("Não foi possível ler todo o extrato, todos os lançamentos ou as contas");
    expect(pagina).toContain("!leituraDasLinhas.ok || !leituraDosLancamentos.ok || !leituraDasContas.ok");
  });
});
