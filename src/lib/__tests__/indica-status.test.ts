import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EXIGE_MOTIVO,
  INDICACAO_STATUS,
  INDICACAO_STATUS_LABEL,
  STATUS_FINAIS,
  TRANSICOES,
  transicaoPermitida,
} from "@/lib/indica/status";

// O banco é quem manda (`indica.transicao_permitida`). Esta régua lê a ÚLTIMA
// migração do Indica que define a função e reprova se o espelho das telas
// divergir — senão a tela mostraria um botão que o banco recusa, ou esconderia
// um que ele aceita.
const DIR = "supabase/migrations";

function tabelaDoBanco(): Record<string, string[]> {
  const sql = readdirSync(DIR)
    .filter((f) => /^2\d{3}_.*\.sql$/.test(f))
    .sort()
    .map((f) => readFileSync(join(DIR, f), "utf8"))
    .filter((s) => s.includes("function indica.transicao_permitida"))
    .at(-1);
  if (!sql) throw new Error("indica.transicao_permitida não encontrada nas migrações 2000+");

  const corpo = sql.slice(sql.indexOf("function indica.transicao_permitida"));
  const tabela: Record<string, string[]> = {};
  for (const m of corpo.matchAll(/when '(\w+)'\s+then array\[([^\]]*)\]/g)) {
    tabela[m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]);
  }
  // Régua que não acha nada grita (§0d do CLAUDE.md).
  if (Object.keys(tabela).length === 0) {
    throw new Error("não consegui ler as transições da migração");
  }
  return tabela;
}

describe("Indica +Risos — máquina de estados", () => {
  it("o espelho das telas é igual à tabela do banco", () => {
    const banco = tabelaDoBanco();
    for (const status of INDICACAO_STATUS) {
      expect([...(banco[status] ?? [])].sort(), status).toEqual([...TRANSICOES[status]].sort());
    }
    // Nenhum status no banco que as telas não conheçam.
    for (const status of Object.keys(banco)) {
      expect(INDICACAO_STATUS as readonly string[]).toContain(status);
    }
  });

  it("todo status tem rótulo em português", () => {
    for (const s of INDICACAO_STATUS) expect(INDICACAO_STATUS_LABEL[s]).toMatch(/\S/);
    expect(INDICACAO_STATUS_LABEL.nao_fechou).toBe("Não fechou");
  });

  it("finais não andam; o caminho feliz anda", () => {
    expect([...STATUS_FINAIS].sort()).toEqual(["cancelada", "convertida", "expirada", "recusada"]);
    const feliz = ["registrada", "validada", "agendada", "compareceu", "fechou", "convertida"] as const;
    for (let i = 0; i < feliz.length - 1; i++) {
      expect(transicaoPermitida(feliz[i], feliz[i + 1])).toBe(true);
    }
    expect(transicaoPermitida("registrada", "fechou")).toBe(false);
  });

  it("os status que exigem motivo são os mesmos que o banco cobra", () => {
    const sql = readFileSync(join(DIR, "2002_indica_motor.sql"), "utf8");
    const m = sql.match(/if p_novo in \(([^)]*)\) and nullif\(btrim\(p_motivo\)/);
    expect(m, "trecho do motivo obrigatório não encontrado").not.toBeNull();
    const banco = [...m![1].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort();
    expect(banco).toEqual([...EXIGE_MOTIVO].sort());
  });
});
