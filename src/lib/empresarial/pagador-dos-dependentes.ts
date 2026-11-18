// Risarte Empresarial — QUEM PAGA OS DEPENDENTES (1049; pedido do dono,
// 18/11/2026).
//
// "Muitos titulares incluem dependentes, mas pagam por fora, com a cobrança
// no próprio CPF ou num CNPJ." A escolha mora NO TITULAR e vale para todos os
// dependentes dele (o preço do dependente é um pacote do titular).
//
//   EMPRESA ... na cobrança da empresa, junto com o titular (o padrão).
//   TITULAR ... cobrança à parte, no CPF do próprio titular.
//   OUTRO ..... cobrança à parte, em nome e documento (CPF ou CNPJ) informados.
//
// Pura: a tela (o formulário), a mensalidade (`computeMonthlyBreakdown`) e a
// planilha usam as mesmas regras. O banco confere de novo (regra
// `employees_dependents_payer_check`).

import { formatCnpj, formatCpf, isValidCnpj, isValidCpf } from "@/lib/masks";

export const PAGADORES = ["EMPRESA", "TITULAR", "OUTRO"] as const;
export type Pagador = (typeof PAGADORES)[number];

export const PAGADOR_LABELS: Record<Pagador, string> = {
  EMPRESA: "A empresa, junto com o titular",
  TITULAR: "O próprio titular (no CPF dele)",
  OUTRO: "Outro pagador (CPF ou CNPJ)",
};

/** Curto, para selo e lista. */
export const PAGADOR_CURTO: Record<Pagador, string> = {
  EMPRESA: "Empresa",
  TITULAR: "Titular",
  OUTRO: "Outro pagador",
};

export type PagadorDoTitular = {
  pagador: Pagador;
  /** Só OUTRO. */
  nome: string | null;
  /** Só OUTRO: 11 (CPF) ou 14 (CNPJ) números. */
  documento: string | null;
};

const soDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/** O documento formatado para ler: "CPF 123.456.789-09" / "CNPJ 12.345.678/0001-90". */
export function documentoLegivel(digitos: string): string {
  if (digitos.length === 11) return `CPF ${formatCpf(digitos)}`;
  if (digitos.length === 14) return `CNPJ ${formatCnpj(digitos)}`;
  return digitos;
}

/**
 * Lê e confere a escolha (formulário ou planilha). Devolve o motivo da
 * recusa em português, ou a escolha pronta para gravar.
 */
export function conferirPagador(entrada: {
  pagador: unknown;
  nome?: unknown;
  documento?: unknown;
}): { ok: true; valor: PagadorDoTitular } | { ok: false; motivo: string } {
  const p = String(entrada.pagador ?? "EMPRESA").trim().toUpperCase() as Pagador;
  if (!(PAGADORES as readonly string[]).includes(p)) {
    return { ok: false, motivo: "Escolha quem paga os dependentes." };
  }
  if (p !== "OUTRO") return { ok: true, valor: { pagador: p, nome: null, documento: null } };
  const nome = String(entrada.nome ?? "").trim();
  const doc = soDigitos(entrada.documento);
  if (!nome) return { ok: false, motivo: "Informe o nome de quem paga os dependentes." };
  if (doc.length === 11) {
    if (!isValidCpf(doc)) return { ok: false, motivo: "O CPF de quem paga os dependentes não é válido." };
  } else if (doc.length === 14) {
    if (!isValidCnpj(doc)) return { ok: false, motivo: "O CNPJ de quem paga os dependentes não é válido." };
  } else {
    return { ok: false, motivo: "Informe o CPF (11 números) ou o CNPJ (14 números) de quem paga os dependentes." };
  }
  return { ok: true, valor: { pagador: p, nome, documento: doc } };
}

/**
 * QUEM RECEBE A COBRANÇA À PARTE. Nulo = os dependentes vão na cobrança da
 * empresa (EMPRESA, ou um TITULAR sem CPF válido — aí não há em nome de quem
 * emitir, e a cobrança cai na empresa em vez de sumir).
 */
export function pagadorDaCobranca(titular: {
  full_name: string;
  cpf: string | null;
  dependents_payer: string | null;
  dependents_payer_name: string | null;
  dependents_payer_document: string | null;
}): { nome: string; documento: string } | null {
  if (titular.dependents_payer === "TITULAR") {
    const cpf = soDigitos(titular.cpf);
    return cpf.length === 11 ? { nome: titular.full_name, documento: cpf } : null;
  }
  if (titular.dependents_payer === "OUTRO") {
    const doc = soDigitos(titular.dependents_payer_document);
    const nome = (titular.dependents_payer_name ?? "").trim();
    return nome && (doc.length === 11 || doc.length === 14) ? { nome, documento: doc } : null;
  }
  return null;
}

/** A descrição da cobrança à parte, para quem paga entender do que é. */
export function descricaoDaCobrancaAParte(base: string, titular: string): string {
  return `${base} — dependentes de ${titular.trim()}`;
}

/** A planilha de titulares: "Empresa" ou "Titular" (Outro só pela tela). */
export const PAGADOR_NA_PLANILHA: Record<"EMPRESA" | "TITULAR", string> = {
  EMPRESA: "Empresa",
  TITULAR: "Titular",
};
