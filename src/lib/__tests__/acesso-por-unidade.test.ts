import { describe, expect, it } from "vitest";
import {
  aplicarTranca,
  lerAcessoPorUnidade,
  MOTIVOS_DE_ACESSO,
  ROTULO_DO_MOTIVO,
} from "@/lib/acesso-por-unidade";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const linha = (clinic_id: string, allowed: boolean, reason: string, role = "receptionist") => ({
  clinic_id,
  role,
  allowed,
  reason,
});

describe("tranca do sistema real por unidade e função (0276)", () => {
  it("⚠️ falha do banco FECHA tudo — não abre (AP11)", () => {
    const leitura = lerAcessoPorUnidade({ data: null, error: { code: "57014", message: "timeout" } });
    expect(leitura.tipo).toBe("erro");
    expect(aplicarTranca(["A", "B"], leitura).liberadas.size).toBe(0);
  });

  it("banco sem a 0276 (função ausente) = vale a porta de antes, sem filtrar", () => {
    for (const code of ["PGRST202", "42883"]) {
      const leitura = lerAcessoPorUnidade({ data: null, error: { code, message: "x" } });
      expect(leitura.tipo).toBe("sem_funcao");
      expect([...aplicarTranca(["A", "B"], leitura).liberadas]).toEqual(["A", "B"]);
    }
  });

  it("⚠️ o caso do dono: recepção certificada abre A e B; gerência em C segue fechada", () => {
    const leitura = lerAcessoPorUnidade({
      data: [
        linha("A", true, "certificado"),
        linha("B", true, "certificado"),
        linha("C", false, "aguardando_missao", "unit_manager"),
      ],
      error: null,
    });
    const r = aplicarTranca(["A", "B", "C"], leitura);
    expect([...r.liberadas]).toEqual(["A", "B"]);
    expect(r.fechadas).toEqual([{ clinicId: "C", role: "unit_manager", motivo: "aguardando_missao" }]);
  });

  it("unidade sem resposta do banco fica FECHADA", () => {
    const leitura = lerAcessoPorUnidade({ data: [linha("A", true, "anterior")], error: null });
    expect([...aplicarTranca(["A", "B"], leitura).liberadas]).toEqual(["A"]);
  });

  it("motivo desconhecido = banco e código divergiram: conta como FECHADA", () => {
    const leitura = lerAcessoPorUnidade({ data: [linha("A", true, "motivo_novo")], error: null });
    expect(aplicarTranca(["A"], leitura).liberadas.size).toBe(0);
  });

  it("resposta que não é lista é erro, não 'nenhuma unidade'", () => {
    expect(lerAcessoPorUnidade({ data: { x: 1 }, error: null }).tipo).toBe("erro");
  });

  it("allowed só vale se for true de verdade", () => {
    const leitura = lerAcessoPorUnidade({ data: [linha("A", "sim" as unknown as boolean, "manual")], error: null });
    expect(aplicarTranca(["A"], leitura).liberadas.size).toBe(0);
  });

  it("todo motivo tem rótulo, e os motivos do código são os que a 0276 devolve", () => {
    for (const m of MOTIVOS_DE_ACESSO) expect(ROTULO_DO_MOTIVO[m]).toBeTruthy();
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/0276_acesso_por_unidade_e_funcao.sql"),
      "utf8"
    );
    // Os motivos escritos no CASE da função (as fontes 'anterior'/'manual'
    // vêm da coluna, conferida pelo CHECK da tabela).
    const noSql = new Set(
      [...sql.matchAll(/(?:then|else) '([a-z_]+)'/g)].map((m) => m[1])
    );
    const doCheck = sql.match(/source in \(([^)]*)\)/)?.[1] ?? "";
    for (const m of doCheck.matchAll(/'([a-z_]+)'/g)) noSql.add(m[1]);
    // A régua precisa ter achado algo — zero seria "não medi", não "bate".
    expect(noSql.size).toBeGreaterThan(5);
    expect([...noSql].sort()).toEqual([...MOTIVOS_DE_ACESSO].sort());
  });
});
