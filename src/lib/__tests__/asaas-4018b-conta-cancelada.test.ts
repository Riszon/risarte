// 4018b — a conta de taxa cancelada à mão não volta; e o acordo vai para a unidade da caixa.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync("supabase/migrations/4018b_asa3_conta_cancelada_a_mao.sql", "utf8");
const TELA = readFileSync("src/app/(app)/financeiro/taxas-da-rede/conteudo.tsx", "utf8");

describe("4018b", () => {
  it("a conta cancelada à mão fica como está; só a da apuração é refeita", () => {
    expect(SQL).toContain("and coalesce(x.cancel_reason, '') <> 'Sem valor apurado no mês') then");
    // Fora da função, nada muda dado: só a redefinição e a conferência.
    const fora = SQL.slice(SQL.lastIndexOf("$function$;"));
    expect(fora).not.toMatch(/(update|delete|insert)/i);
  });
  it("entrando pela franqueadora, a unidade padrão é a 1ª da caixa (nunca a franqueadora)", () => {
    expect(TELA).toContain('session.activeClinic?.type === "franchisor" ? primeiraUnidade : activeClinicId');
  });
});
