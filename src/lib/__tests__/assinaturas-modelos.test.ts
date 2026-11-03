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

// 0349: O TEXTO PADRÃO DO CONTRATO DE PRESTAÇÃO (decisões do dono, B1–B12 de
// `docs/assinaturas/CONTRATO-PRESTACAO-PADRAO.md`). Mesma régua dos modelos
// semeados, mais: o texto é da rede, então não pode ter dado de ninguém.
describe("0349 — o contrato de prestação com o texto padrão da rede", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "supabase", "migrations", "0349_contrato_prestacao_texto_padrao.sql"),
    "utf8"
  ).replace(/\r\n/g, "\n");
  const update = sql.slice(sql.indexOf("update public.signature_templates"), sql.indexOf("do $$"));

  it("todo {{campo}} está no catálogo e na lista `variables`", () => {
    const usados = [...new Set([...update.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]))];
    const m = update.match(/variables = array\[([^\]]*)\]/);
    const declarados = m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [];
    const permitidos = new Set(camposPermitidos("patient"));
    expect(usados.length).toBeGreaterThan(10);
    expect(usados.filter((c) => !permitidos.has(c))).toEqual([]);
    expect([...declarados].sort()).toEqual([...usados].sort());
  });

  it("não traz CPF, CNPJ, RG nem os nomes do documento de origem", () => {
    expect(update).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    expect(update).not.toMatch(/\d{2}[.,]\d{3}[.,]\d{3}\/\d{4}-\d{2}/);
    expect(update).not.toMatch(/\bRG\b/);
    expect(update).not.toMatch(/Jeferson|Amanda|Cambé|Londrina|ControleODONTO/i);
  });

  it("14 cláusulas, só troca o provisório e tira a marca d'água", () => {
    expect(update.match(/jsonb_build_object\('title'/g)?.length).toBe(14);
    expect(update).toMatch(/where t\.code = 'contrato_prestacao'\n {2}and t\.is_provisional_text;/);
    expect(update).toMatch(/is_provisional_text = false/);
  });

  it("as decisões do dono estão no texto", () => {
    expect(update).toMatch(/multa compensatória de 50% \(cinquenta por cento\)/); // B1
    expect(update).toMatch(/autorizam, desde já, o uso das imagens/); // B2
    expect(update).toMatch(/na condição de controladora/); // B3
    expect(update).toMatch(/suspensão imediata da prestação dos serviços/); // B5
    expect(update).toMatch(/50% \(cinquenta por cento\) do valor do procedimento "consulta odontológica"/); // B11
    expect(update).not.toMatch(/120,00/); // B11
    expect(update).toMatch(/foro do seu domicílio/); // B9
    expect(update).not.toMatch(/irrevogável/i); // B10
    expect(update).toMatch(/gerado e assinado no mesmo ato da negociação/); // B12
  });
});
