// Risarte Empresarial — A CONFERÊNCIA DA PLANILHA DE TITULARES (AP97, item 6
// do plano de correções da Rita, aprovado pelo dono em 03/11/2026).
//
// A importação é TUDO OU NADA: qualquer linha inválida recusa a planilha
// inteira, e a lista de erros volta para a tela, linha por linha. Até a
// 0.95.0 a linha ruim era pulada em silêncio ("3 ignorado(s)") e o resto
// entrava — o RH ficava sem saber QUEM ficou de fora, e a lista "quem sobrou"
// sumia com a tela. Importar parte é mais cômodo e mais perigoso.
//
// Esta peça é PURA: recebe as linhas lidas da planilha e os CPFs que já estão
// na empresa, e devolve o que gravar ou os erros. Não lê banco, não grava.
// Quem lê e grava é a action — e só grava depois que ESTA conferência passou
// sem nenhum erro.
//
// ⚠️ NADA DE DADO PESSOAL NOS ERROS: a lista que volta para a tela traz o
// número da linha e o motivo. A planilha é do RH; ele acha a linha.

import { formatCpf, formatPhone } from "@/lib/masks";
import { RELATIONSHIPS } from "./constants";

export type LinhaDaPlanilha = {
  cpf: string;
  fullName: string;
  phone: string;
  email: string;
  dependentPlan: string;
  /** A linha na planilha (a 1 é o cabeçalho). Sem ela, a posição na lista. */
  linha?: number;
};

export type DependenteDaPlanilha = {
  holderCpf: string;
  cpf: string;
  fullName?: string;
  relationship?: string;
  phone?: string;
  linha?: number;
};

export type Aba = "Titulares" | "Dependentes";

export type LinhaComErro = { aba: Aba; linha: number; motivo: string };

export type TitularConferido = {
  linha: number;
  /** Só dígitos. */
  cpf: string;
  cpfFormatado: string;
  fullName: string;
  phone: string;
  email: string | null;
};

export type DependenteConferido = {
  linha: number;
  holderCpf: string;
  cpf: string;
  cpfFormatado: string;
  fullName: string | null;
  phone: string | null;
  relationship: string;
};

export type PlanilhaConferida = {
  erros: LinhaComErro[];
  titulares: TitularConferido[];
  dependentes: DependenteConferido[];
  /** Os CPFs (dígitos) que AINDA NÃO estão na empresa: são os que ocupam vaga. */
  cpfsNovos: string[];
  /** Quantos titulares da planilha já estavam cadastrados (não gravam, não ocupam vaga). */
  jaCadastrados: number;
};

const soDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/**
 * O telefone válido tem 10 ou 11 dígitos (fixo ou celular com DDD).
 * ⚠️ TELEFONE VAZIO É ERRO DA LINHA, não um cadastro sem telefone: a coluna é
 * `not null`, a Rita precisa do telefone e um titular sem telefone não tem
 * como receber as boas-vindas. Antes virava `""` gravado — um registro que
 * parecia completo e não servia para nada.
 */
function telefoneValido(phone: unknown): boolean {
  const d = soDigitos(phone);
  return d.length === 10 || d.length === 11;
}

export function conferirPlanilha(
  rows: readonly LinhaDaPlanilha[],
  dependentes: readonly DependenteDaPlanilha[],
  cpfsJaNaEmpresa: ReadonlySet<string>
): PlanilhaConferida {
  const erros: LinhaComErro[] = [];
  const titulares: TitularConferido[] = [];
  const linhaDoCpf = new Map<string, number>();

  rows.forEach((r, i) => {
    const linha = r.linha ?? i + 2;
    const cpf = soDigitos(r.cpf);
    const nome = String(r.fullName ?? "").trim();
    const faltas: string[] = [];
    if (cpf.length !== 11) faltas.push("CPF incompleto");
    if (!nome) faltas.push("sem nome");
    if (!telefoneValido(r.phone)) {
      faltas.push(soDigitos(r.phone) ? "telefone incompleto" : "sem telefone");
    }
    if (cpf.length === 11) {
      const repetida = linhaDoCpf.get(cpf);
      if (repetida != null) faltas.push(`CPF repetido (já está na linha ${repetida})`);
      else linhaDoCpf.set(cpf, linha);
    }
    if (faltas.length > 0) {
      erros.push({ aba: "Titulares", linha, motivo: faltas.join("; ") });
      return;
    }
    titulares.push({
      linha,
      cpf,
      cpfFormatado: formatCpf(cpf),
      fullName: nome,
      phone: formatPhone(String(r.phone)),
      email: String(r.email ?? "").trim() || null,
    });
  });

  // Quem já está na empresa (ativo, inativo ou excluído) não grava de novo e
  // não ocupa vaga: o upsert por (company_id, cpf) deixa como está. Só os
  // CPFs NOVOS pedem vaga ao contrato.
  const cpfsNovos = titulares.map((t) => t.cpf).filter((c) => !cpfsJaNaEmpresa.has(c));
  const jaCadastrados = titulares.length - cpfsNovos.length;

  // Dependentes: o titular tem de estar NA PLANILHA ou JÁ NA EMPRESA. Um
  // dependente sem titular conhecido não tem onde morar, e antes era contado
  // como "ignorado" sem dizer qual.
  const titularesConhecidos = new Set<string>([
    ...titulares.map((t) => t.cpf),
    ...cpfsJaNaEmpresa,
  ]);
  const dependentesVistos = new Map<string, number>();
  const dependentesConferidos: DependenteConferido[] = [];
  dependentes.forEach((d, i) => {
    const linha = d.linha ?? i + 2;
    const holderCpf = soDigitos(d.holderCpf);
    const cpf = soDigitos(d.cpf);
    const relationship = String(d.relationship ?? "").trim();
    const faltas: string[] = [];
    if (holderCpf.length !== 11) faltas.push("CPF do titular incompleto");
    else if (!titularesConhecidos.has(holderCpf)) {
      faltas.push("o CPF do titular não está na planilha nem na empresa");
    }
    if (cpf.length !== 11) faltas.push("CPF do dependente incompleto");
    if (!(RELATIONSHIPS as readonly string[]).includes(relationship)) {
      faltas.push("parentesco não reconhecido");
    }
    if (holderCpf.length === 11 && cpf.length === 11) {
      const chave = `${holderCpf}:${cpf}`;
      const repetida = dependentesVistos.get(chave);
      if (repetida != null) faltas.push(`dependente repetido (já está na linha ${repetida})`);
      else dependentesVistos.set(chave, linha);
    }
    if (faltas.length > 0) {
      erros.push({ aba: "Dependentes", linha, motivo: faltas.join("; ") });
      return;
    }
    dependentesConferidos.push({
      linha,
      holderCpf,
      cpf,
      cpfFormatado: formatCpf(cpf),
      fullName: String(d.fullName ?? "").trim() || null,
      phone: soDigitos(d.phone) ? formatPhone(String(d.phone)) : null,
      relationship,
    });
  });

  return {
    erros,
    titulares,
    dependentes: dependentesConferidos,
    cpfsNovos,
    jaCadastrados,
  };
}

/** A frase que resume a recusa na tela, antes da lista linha a linha. */
export function resumoDaRecusa(erros: readonly LinhaComErro[]): string {
  const n = erros.length;
  return (
    `A planilha não foi importada: ${n} linha(s) com problema. ` +
    `Nada foi gravado — corrija a planilha e importe de novo.`
  );
}
