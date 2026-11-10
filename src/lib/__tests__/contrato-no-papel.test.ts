import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// OC-00171 (decisão do dono, 10/11/2026): marcar "Contrato assinado" À MÃO
// exige a foto ou o PDF do contrato assinado no papel. A trava é do BANCO
// (0392), não só da tela. Ensaio no treino em transação desfeita: 8/8.

const ler = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");
const sql = ler("supabase", "migrations", "0392_contrato_no_papel_exige_anexo.sql");

describe("contrato no papel só com o papel anexado (OC-00171)", () => {
  it("o gatilho recusa a marcação manual sem papel", () => {
    expect(sql).toMatch(/create trigger commercial_sales_paper_guard\s+before insert or update/);
    expect(sql).toMatch(/coalesce\(new\.contract_signed_source, ''\) = 'manual'[\s\S]*raise exception 'PAPER_REQUIRED'/);
  });

  it("a marcação com papel passa pela mesma conta do fechamento e confere o arquivo da negociação", () => {
    expect(sql).toMatch(/negotiation_of_paper_path\(p_path\) is distinct from p_negotiation_id/);
    expect(sql).toMatch(/_commercial_close_step_raw\(p_negotiation_id, 'contract', true, v_user, 'manual', null\)/);
  });

  it("as funções novas não executam sem login", () => {
    for (const f of [
      "commercial_mark_paper_contract(uuid, text, text)",
      "can_attach_contract_paper(uuid)",
      "negotiation_of_paper_path(text)",
      "commercial_sales_paper_guard()",
    ]) {
      expect(sql).toContain(`revoke execute on function public.${f} from public, anon, authenticated;`);
    }
  });

  it("a pasta é privada e só o Admin Master apaga o papel", () => {
    expect(sql).toMatch(/'contratos-papel', 'contratos-papel', false/);
    expect(sql).toMatch(/contratos_papel_delete[\s\S]*public\.is_admin_master\(\)/);
  });

  it("a tela: marcar à mão abre a janela do papel; a recusa do banco vira frase", () => {
    const painel = ler("src", "app", "(app)", "apresentacao", "[clientId]", "closing-panel.tsx");
    expect(painel).toMatch(/onToggle=\{\(v\) => \(v \? setPapelAberto\(true\) : toggle\("contract", false\)\)\}/);
    const acoes = ler("src", "app", "(app)", "apresentacao", "[clientId]", "closing-actions.ts");
    expect(acoes).toMatch(/PAPER_REQUIRED[\s\S]*anexe a foto ou o PDF do contrato assinado/);
  });

  it("as colunas novas são lidas à parte (a tela não quebra antes da 0392)", () => {
    const loader = ler("src", "app", "(app)", "apresentacao", "[clientId]", "negotiation-loader.ts");
    const principal = loader.match(/\.select\("contract_signed, [^"]*"\)/)?.[0] ?? "";
    expect(principal).not.toBe("");
    expect(principal).not.toContain("contract_paper");
  });
});
