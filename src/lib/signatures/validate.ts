import { isValidCpf } from "@/lib/masks";
import { isValidEmail } from "./settings";
import type { SignerDraft, TemplateBody } from "./types";
import { camposDoModelo } from "./variables";

/**
 * O QUE A ZAPSIGN EXIGE DE CADA SIGNATÁRIO, conferido antes de gastar crédito
 * (plano ZS0 §7): CPF válido (os dígitos verificadores) e telefone OU e-mail
 * para receber o link e o código. Regra pura, testada.
 */

export type ValidationIssue = { signer: string; message: string };

export function validarSignatarios(signers: SignerDraft[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const s of signers) {
    const quem = `${s.qualification} ${s.name}`.trim();
    if (!s.name.trim()) issues.push({ signer: quem, message: "sem nome." });
    if (!s.cpf) issues.push({ signer: quem, message: "sem CPF cadastrado." });
    else if (!isValidCpf(s.cpf)) issues.push({ signer: quem, message: "o CPF cadastrado não é válido." });
    const temTelefone = telefoneValido(s.phone);
    const temEmail = !!s.email && isValidEmail(s.email);
    if (!temTelefone && !temEmail) {
      issues.push({ signer: quem, message: "sem telefone com DDD nem e-mail válido para receber o link." });
    }
  }
  return issues;
}

export function telefoneValido(phone: string | null | undefined): boolean {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length === 10 || d.length === 11 || (d.startsWith("55") && (d.length === 12 || d.length === 13));
}

/** Telefone brasileiro → `{ phone_country: "55", phone_number: "43999998888" }` para a ZapSign. */
export function telefoneParaZapsign(phone: string | null | undefined): { phone_country: string; phone_number: string } | null {
  let d = (phone ?? "").replace(/\D/g, "");
  if (!telefoneValido(d)) return null;
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  return { phone_country: "55", phone_number: d };
}

/** Um PDF avulso anexado ao pacote: tamanho e tipo antes de abrir. */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export function validarAnexo(file: { name: string; size: number; type: string }): string | null {
  if (file.type && file.type !== "application/pdf") return `"${file.name}" não é um PDF.`;
  if (!/\.pdf$/i.test(file.name)) return `"${file.name}" não é um PDF.`;
  if (file.size === 0) return `"${file.name}" está vazio.`;
  if (file.size > MAX_ATTACHMENT_BYTES) return `"${file.name}" passa de 8 MB.`;
  return null;
}

/**
 * OC-00158 (0348): documento que usa `{{apresentacao_resumo}}` só sai com o
 * resumo escrito — senão o cliente assinaria uma linha em branco no lugar do
 * que ouviu. Devolve a mensagem para a tela, ou nulo quando pode seguir.
 */
export function faltaResumoDaApresentacao(
  templates: { name: string; body: TemplateBody | null }[],
  resumo: string | null | undefined
): string | null {
  if ((resumo ?? "").trim()) return null;
  const usam = templates.filter((t) => camposDoModelo(t.body).includes("apresentacao_resumo"));
  if (usam.length === 0) return null;
  return `${usam.map((t) => `"${t.name}"`).join(" e ")} ${usam.length === 1 ? "usa" : "usam"} o resumo da apresentação, que ainda não foi escrito. Escreva no cockpit do Consultor (aba Apresentação) e envie de novo.`;
}
