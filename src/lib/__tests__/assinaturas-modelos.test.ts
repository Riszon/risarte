import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAMPOS_DO_PACIENTE, camposPermitidos } from "@/lib/signatures/variables";

// OS MODELOS SEMEADOS NA 0342 SÓ USAM CAMPOS QUE O SISTEMA PREENCHE. Esta é a
// mesma régua do Empresarial (`contrato.ts`): campo escrito no texto e
// ausente de `CAMPOS_DO_PACIENTE` sairia impresso como `{{chave}}` num
// documento que vai para assinatura. Lê o arquivo da migração (normalizando
// CRLF, lição da 0307).

const MIGRATION = path.join(process.cwd(), "supabase", "migrations", "0342_assinaturas_zs2_modelos_e_envio.sql");

describe("modelos semeados (0342) × catálogo de campos", () => {
  const sql = readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n");

  it("todo {{campo}} do arquivo está no catálogo do paciente", () => {
    const usados = [...new Set([...sql.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)].map((m) => m[1]))];
    expect(usados.length).toBeGreaterThan(5);
    const permitidos = new Set(camposPermitidos("patient"));
    expect(usados.filter((c) => !permitidos.has(c))).toEqual([]);
  });

  it("a lista `variables` de cada modelo é um subconjunto do catálogo e cobre o que o texto usa", () => {
    const blocos = sql.split(/\n\(\n\s*'/).slice(1);
    expect(blocos.length).toBe(5);
    const permitidos = new Set(CAMPOS_DO_PACIENTE.map((c) => c.chave));
    for (const b of blocos) {
      const m = b.match(/array\[([^\]]*)\]/);
      const declarados = m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [];
      const usados = [...new Set([...b.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)].map((x) => x[1]))];
      expect(declarados.filter((c) => !permitidos.has(c))).toEqual([]);
      expect(usados.filter((c) => !declarados.includes(c))).toEqual([]);
    }
  });

  it("os cinco códigos esperados estão lá, e o de adesão lê o texto do Empresarial", () => {
    for (const code of ["contrato_prestacao", "tcle", "orcamento_aprovado", "autorizacao_imagem", "adesao_empresarial"]) {
      expect(sql).toContain(`'${code}'`);
    }
    expect(sql).toMatch(/source = 'empresarial_contract_templates'/);
    expect(sql).toMatch(/on conflict \(code\) do nothing/);
  });
});
