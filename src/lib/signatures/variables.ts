import { CAMPOS_DO_CONTRATO } from "@/lib/empresarial/contrato";
import type { SignatureAudience, TemplateBody } from "./types";

/**
 * OS CAMPOS `{{…}}` QUE UM MODELO DE PACIENTE PODE USAR (plano ZS0 §5.3).
 *
 * ⚠️ ESTA LISTA É O CONTRATO ENTRE O TEXTO E O SISTEMA, como
 * `CAMPOS_DO_CONTRATO` no Empresarial: campo usado no modelo e ausente daqui
 * sairia impresso como `{{chave}}` num documento que vai para assinatura. Por
 * isso `assinaturas-modelos.test.ts` lê os 5 modelos semeados na 0342 e
 * confere cada campo contra esta lista, e a tela de edição recusa campo
 * desconhecido antes de salvar.
 */

export type GrupoDeCampoDoPaciente = "Paciente" | "Responsável" | "Unidade" | "Tratamento" | "Documento";

export type CampoDoModelo = {
  chave: string;
  grupo: GrupoDeCampoDoPaciente;
  rotulo: string;
};

export const CAMPOS_DO_PACIENTE: readonly CampoDoModelo[] = [
  { chave: "paciente_nome", grupo: "Paciente", rotulo: "Nome completo do paciente" },
  { chave: "paciente_cpf", grupo: "Paciente", rotulo: "CPF do paciente, com a máscara" },
  { chave: "paciente_nascimento", grupo: "Paciente", rotulo: "Data de nascimento (dd/mm/aaaa)" },
  { chave: "paciente_telefone", grupo: "Paciente", rotulo: "Telefone do paciente" },
  { chave: "paciente_email", grupo: "Paciente", rotulo: "E-mail do paciente" },
  { chave: "paciente_endereco", grupo: "Paciente", rotulo: "Endereço do paciente, em uma linha" },
  { chave: "responsavel_nome", grupo: "Responsável", rotulo: "Nome do responsável legal (menor de idade)" },
  { chave: "responsavel_cpf", grupo: "Responsável", rotulo: "CPF do responsável legal" },
  { chave: "responsavel_parentesco", grupo: "Responsável", rotulo: "Parentesco do responsável (mãe, pai, tutor…)" },
  { chave: "contratante_nome", grupo: "Responsável", rotulo: "Quem contrata: o paciente, ou o responsável quando menor" },
  { chave: "contratante_cpf", grupo: "Responsável", rotulo: "CPF de quem contrata" },
  { chave: "unidade_nome", grupo: "Unidade", rotulo: "Nome da unidade emissora" },
  { chave: "unidade_razao_social", grupo: "Unidade", rotulo: "Razão social da unidade (ou o nome, se não houver)" },
  { chave: "unidade_cnpj", grupo: "Unidade", rotulo: "CNPJ da unidade, com a máscara" },
  { chave: "unidade_endereco", grupo: "Unidade", rotulo: "Endereço da unidade, em uma linha" },
  { chave: "unidade_cidade", grupo: "Unidade", rotulo: "Cidade da unidade" },
  { chave: "unidade_telefone", grupo: "Unidade", rotulo: "Telefone da unidade" },
  { chave: "dentista_nome", grupo: "Tratamento", rotulo: "Dentista responsável pelo plano (quando houver)" },
  { chave: "tratamento_procedimentos", grupo: "Tratamento", rotulo: "Lista dos procedimentos (um por linha)" },
  { chave: "tratamento_valor_total", grupo: "Tratamento", rotulo: "Valor total, em reais" },
  { chave: "tratamento_valor_extenso", grupo: "Tratamento", rotulo: "Valor total, por extenso" },
  { chave: "tratamento_condicoes", grupo: "Tratamento", rotulo: "Forma de pagamento e parcelas, como negociado" },
  { chave: "tratamento_validade", grupo: "Tratamento", rotulo: "Validade do orçamento (dd/mm/aaaa)" },
  // OC-00158 (0348): o que o Consultor escreveu no cockpit. O envio recusa o
  // modelo que usa este campo enquanto o resumo estiver vazio (`prepararPacote`).
  { chave: "apresentacao_resumo", grupo: "Tratamento", rotulo: "Resumo da apresentação comercial, como o Consultor registrou" },
  { chave: "documento_numero", grupo: "Documento", rotulo: "Número do pacote de assinatura (ASS-000001)" },
  { chave: "documento_data", grupo: "Documento", rotulo: "Data de hoje (dd/mm/aaaa)" },
  { chave: "documento_data_extenso", grupo: "Documento", rotulo: "Data de hoje por extenso (Londrina, 31 de outubro de 2026)" },
];

/** O que se imprime no lugar de um campo sem valor — como no modelo em papel. */
export const LINHA_EM_BRANCO = "________________";

const CAMPO = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/** Os campos usados num texto, sem repetição, na ordem em que aparecem. */
export function camposDoTexto(text: string): string[] {
  const out: string[] = [];
  for (const m of (text ?? "").matchAll(CAMPO)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

export function camposDoModelo(body: TemplateBody | null): string[] {
  if (!body) return [];
  return camposDoTexto(
    [body.preamble, ...body.sections.flatMap((s) => [s.title, s.body]), body.closing].join("\n")
  );
}

/** As chaves que um modelo deste público pode usar. */
export function camposPermitidos(audience: SignatureAudience): string[] {
  return audience === "company"
    ? CAMPOS_DO_CONTRATO.map((c) => c.chave)
    : CAMPOS_DO_PACIENTE.map((c) => c.chave);
}

/** Os campos do modelo que o sistema não sabe preencher — para a tela recusar. */
export function camposDesconhecidos(body: TemplateBody | null, audience: SignatureAudience): string[] {
  const permitidos = new Set(camposPermitidos(audience));
  return camposDoModelo(body).filter((c) => !permitidos.has(c));
}

/** Troca cada `{{chave}}` pelo valor; vazio ou desconhecido vira a linha em branco. */
export function preencherTexto(text: string, values: Record<string, string | null | undefined>): string {
  return (text ?? "").replace(CAMPO, (_, chave: string) => {
    const v = values[chave];
    return v && String(v).trim() ? String(v) : LINHA_EM_BRANCO;
  });
}

export function preencherModelo(body: TemplateBody, values: Record<string, string | null | undefined>): TemplateBody {
  return {
    preamble: preencherTexto(body.preamble, values),
    sections: body.sections.map((s) => ({ title: preencherTexto(s.title, values), body: preencherTexto(s.body, values) })),
    closing: preencherTexto(body.closing, values),
  };
}

/** Um corpo de modelo válido? (forma do JSON guardado em `signature_templates.body`). */
export function corpoValido(raw: unknown): raw is TemplateBody {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  if (typeof o.preamble !== "string" || typeof o.closing !== "string" || !Array.isArray(o.sections)) return false;
  return o.sections.every(
    (s) => s && typeof s === "object" && typeof (s as TemplateSectionLike).title === "string" && typeof (s as TemplateSectionLike).body === "string"
  );
}

type TemplateSectionLike = { title: unknown; body: unknown };
