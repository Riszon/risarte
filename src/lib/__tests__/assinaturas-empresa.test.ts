import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  TITULO_DO_ANEXO,
  corpoDoContratoParaAssinatura,
  semMarcacao,
  textoDoAnexo,
  type AnexoDoContrato,
} from "@/lib/empresarial/contrato-para-assinatura";
import { LINHA_EM_BRANCO } from "@/lib/empresarial/contrato";
import { montarSignatariosDaEmpresa } from "@/lib/signatures/signers";
import type { StaffSignerOption } from "@/lib/signatures/types";

// ZS5 — a assinatura digital do Empresarial: o contrato de adesão vira o texto
// do PDF e quem assina pela empresa entra antes das testemunhas e da Risarte.

const modelo = {
  titulo: "CONTRATO DE ADESÃO — {{contratante_razao_social}}",
  preambulo: "Pelo presente, **{{contratante_razao_social}}**, CNPJ {{contratante_documento}}, adere ao programa.",
  blocos: [
    { titulo: "CLÁUSULA PRIMEIRA", corpo: "O objeto é o programa.\nParágrafo único: vale o **Anexo I**." },
    { titulo: "CLÁUSULA SEGUNDA", corpo: "O valor é {{valor_titular}}." },
  ],
  fecho: "E, por estarem justas, assinam.",
};

const anexo: AnexoDoContrato = {
  carenciaDoProgramaDias: 30,
  carenciaDoTitularDias: null,
  beneficios: [
    { nome: "Limpeza", unidades: null, cobertura: "100%", paraQuem: "titular e dependentes", limite: "1 a cada 6 meses", carencia: "sem carência" },
    { nome: "Clareamento", unidades: "Londrina", cobertura: "30% de desconto", paraQuem: "titular", limite: "sem limite", carencia: "3 meses" },
  ],
  pagamento: "Pix, boleto ou cartão em até 12x",
  social: { metas: ["10 titulares ativos e mensalidade em dia"] },
  vantagens: ["Palestra anual de saúde bucal"],
};

describe("contrato de adesão → texto do PDF (ZS5)", () => {
  const valores = {
    contratante_razao_social: "Empresa Teste LTDA",
    contratante_documento: "12.345.678/0001-90",
    valor_titular: "R$ 29,90 (vinte e nove reais e noventa centavos)",
    cidade_assinatura: "Londrina",
    data_assinatura: "2 de novembro de 2026",
  };
  const r = corpoDoContratoParaAssinatura({ modelo, valores, anexo });

  it("preenche os campos, tira o negrito e leva o rótulo de cada parágrafo", () => {
    expect(r.titulo).toBe("CONTRATO DE ADESÃO — Empresa Teste LTDA");
    expect(r.body.preamble).toBe("Pelo presente, Empresa Teste LTDA, CNPJ 12.345.678/0001-90, adere ao programa.");
    expect(r.body.sections[0].body).toBe("CLÁUSULA PRIMEIRA: O objeto é o programa.\n\nParágrafo único: vale o Anexo I.");
    expect(r.body.sections[1].body).toContain("R$ 29,90");
    const tudo = JSON.stringify(r);
    expect(tudo).not.toContain("**");
    expect(tudo).not.toContain("{{");
  });

  it("o fecho leva a cidade e a data; o Anexo I é a última seção", () => {
    expect(r.body.closing).toBe("E, por estarem justas, assinam.\n\nLondrina, 2 de novembro de 2026.");
    const ultima = r.body.sections[r.body.sections.length - 1];
    expect(ultima.title).toBe(TITULO_DO_ANEXO);
    expect(r.body.sections).toHaveLength(modelo.blocos.length + 1);
  });

  it("campo sem valor sai como linha em branco (e por isso o envio bloqueia antes)", () => {
    const vazio = corpoDoContratoParaAssinatura({ modelo, valores: {}, anexo });
    expect(vazio.body.preamble).toContain(LINHA_EM_BRANCO);
    expect(vazio.body.closing).toContain(`${LINHA_EM_BRANCO}, ${LINHA_EM_BRANCO}.`);
  });

  it("o Anexo I traz carência, cada benefício, o pagamento, o Riso+ Social e as vantagens", () => {
    const t = textoDoAnexo(anexo);
    expect(t).toContain("Carência do programa: 30 dia(s)");
    expect(t).not.toContain("Carência de cada titular");
    expect(t).toContain("• Limpeza: cobertura 100%; para titular e dependentes; limite de uso: 1 a cada 6 meses; carência: sem carência.");
    expect(t).toContain("• Clareamento (Londrina): cobertura 30% de desconto");
    expect(t).toContain("Pagamento do tratamento: Pix, boleto ou cartão em até 12x");
    expect(t).toContain("1. 10 titulares ativos e mensalidade em dia");
    expect(t).toContain("• Palestra anual de saúde bucal");
  });

  it("sem benefício e sem Riso+ Social, o anexo diz isso em vez de sumir", () => {
    const t = textoDoAnexo({ ...anexo, beneficios: [], social: null, vantagens: [] });
    expect(t).toContain("Nenhum procedimento foi combinado na proposta desta empresa.");
    expect(t).not.toContain("Riso+ Social");
    expect(t).not.toContain("Outras vantagens");
  });

  it("semMarcacao só tira os asteriscos do negrito", () => {
    expect(semMarcacao("a **b** c")).toBe("a b c");
  });
});

const pessoa = (key: string, name: string, cpf: string | null): StaffSignerOption => ({
  key,
  name,
  cpf,
  email: `${key}@example.com`,
  phone: "43999990000",
  user_id: key,
  staff_member_id: null,
  role_label: "Equipe",
});
const modeloDeAdesao = { name: "Contrato de adesão empresarial", witness_count: 2, risarte_signer_mode: "role" as const, risarte_signer_role: null, risarte_signer_user_id: null };
const representante = { name: "Maria Empresa", cpf: "529.982.247-25", email: "maria@empresa.com", phone: "43988887777" };

describe("quem assina pela empresa (ZS5)", () => {
  it("1º a empresa, 2º as testemunhas, 3º a Risarte", () => {
    const r = montarSignatariosDaEmpresa({
      representante,
      templates: [modeloDeAdesao],
      witnesses: [pessoa("t1", "Testemunha Um", "11144477735"), pessoa("t2", "Testemunha Dois", "93541134780")],
      representatives: [pessoa("dono", "Titular", "39053344705")],
    });
    expect(r.blockers).toEqual([]);
    expect(r.signers.map((s) => [s.order_group, s.signer_type, s.qualification])).toEqual([
      [1, "company_representative", "Representante da empresa"],
      [2, "witness", "Testemunha"],
      [2, "witness", "Testemunha"],
      [3, "risarte_representative", "Representante da Risarte"],
    ]);
    expect(r.signers[0].cpf).toBe("52998224725");
    expect(r.signers[0].email).toBe("maria@empresa.com");
  });

  it("sem nome de quem assina pela empresa, bloqueia", () => {
    const r = montarSignatariosDaEmpresa({ representante: { ...representante, name: "  " }, templates: [modeloDeAdesao], witnesses: [], representatives: [null] });
    expect(r.blockers).toContain("Falta o nome de quem assina pela empresa.");
  });

  it("faltando testemunha ou quem assina pela Risarte, bloqueia", () => {
    const r = montarSignatariosDaEmpresa({ representante, templates: [modeloDeAdesao], witnesses: [pessoa("t1", "T", "11144477735")], representatives: [null] });
    expect(r.blockers.some((b) => b.includes("Faltam testemunhas"))).toBe(true);
    expect(r.blockers.some((b) => b.includes("quem assina pela Risarte"))).toBe(true);
  });

  it("testemunha com o CPF de quem assina pela empresa bloqueia", () => {
    const r = montarSignatariosDaEmpresa({
      representante,
      templates: [modeloDeAdesao],
      witnesses: [pessoa("t1", "Mesma Pessoa", "52998224725"), pessoa("t2", "Outra", "93541134780")],
      representatives: [pessoa("dono", "Titular", "39053344705")],
    });
    expect(r.blockers.some((b) => b.includes("mesmo CPF"))).toBe(true);
  });
});

describe("a tela e o PDF leem o contrato do MESMO jeito (ZS5)", () => {
  const ler = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
  it("a tela do contrato e o envio usam carregarContratoDoLead", () => {
    expect(ler("src/app/(app)/empresarial/funil/[leadId]/contrato/page.tsx")).toContain("carregarContratoDoLead(leadId)");
    // O envio passa quem vai assinar pela Risarte (o texto cita a mesma pessoa, AP95).
    expect(ler("src/lib/signatures/send-empresa.ts")).toContain("carregarContratoDoLead(leadId, { representanteUserId:");
  });
  it("a aba Envio e selos do funil tem o envio digital do contrato", () => {
    expect(ler("src/app/(app)/empresarial/funil/[leadId]/page.tsx")).toMatch(/<EnvioESelos[\s\S]{0,800}assinatura=\{\s*<AssinaturasDaEmpresa/);
  });
  it("o envio digital entra no registro do funil SEM a proposta (a fase não muda)", () => {
    const acoes = ler("src/app/(app)/assinaturas/envio-empresa-actions.ts");
    const itens = acoes.match(/const itens = \[[^\n]*\];/)?.[0] ?? "";
    expect(itens).toContain('"CONTRACT"');
    expect(itens).not.toContain("PROPOSAL");
    expect(acoes).toContain('channel: "OTHER"');
  });
  it("arquivo guardado só entra no pacote se a pessoa o enxerga (pela RLS)", () => {
    const envio = ler("src/lib/signatures/send-empresa.ts");
    expect(envio).toContain("ctx.arquivosGuardados.find((g) => g.id === a.arquivoId)");
    expect(envio).toMatch(/from\("company_files"\)[\s\S]{0,200}\.eq\("company_id", companyId\)/);
  });
  it("o esboço antigo da ZapSign no Empresarial saiu (um caminho só)", () => {
    const acoes = ler("src/app/(app)/empresarial/[companyId]/contract-actions.ts");
    expect(acoes).not.toMatch(/export async function (sendContract|markContractSigned|createContract)\b/);
  });
});
