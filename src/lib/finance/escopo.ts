// OC-00120 — o Financeiro da Franqueadora trabalha no financeiro das UNIDADES
// do escopo dele. Puro — testável sem banco.
//
// A regra do módulo (CLAUDE.md §8b: "finance_franchisor, com escopo de
// unidades") e o banco (`is_finance_franchisor`, 0185: vê e lança em todas)
// sempre deixaram; o que faltava era a TELA: o "Trabalhar na clínica" só
// listava as unidades em que a pessoa tem função própria — para ele, só a
// Franqueadora. As unidades entram no seletor SEM função nelas: as outras
// telas da unidade seguem o que a função dele permite.

import type { UserRole } from "@/lib/roles";

type ClinicaDaLista = { id: string; type: string; is_active?: boolean | null };

/** Tem a função Financeiro da Franqueadora (em alguma clínica liberada)? */
export function ehFinanceiroDaFranqueadora(rolesByClinic: Record<string, UserRole[]>): boolean {
  return Object.values(rolesByClinic).some((r) => r.includes("finance_franchisor"));
}

/**
 * As unidades que entram no seletor: unidade franqueada ATIVA, dentro do
 * escopo (o mesmo de `user_full_access_clinic_ids`: Todas / Específicas), que
 * a pessoa ainda não tem na lista.
 */
export function unidadesDoEscopoFinanceiro<T extends ClinicaDaLista>(
  todas: T[],
  idsDoEscopo: Iterable<string>,
  jaNaLista: Iterable<string>
): T[] {
  const escopo = new Set(idsDoEscopo);
  const ja = new Set(jaNaLista);
  return todas.filter((c) => c.type === "franchise_unit" && c.is_active !== false && escopo.has(c.id) && !ja.has(c.id));
}

/**
 * AP67 (0380, decisão do dono em 10/11/2026) — o Financeiro da Franqueadora
 * aceita SÓ o escopo "Todas".
 *
 * O banco dá a essa função o financeiro de todas as unidades
 * (`is_finance_franchisor()`, usada em mais de 130 regras), seja qual for o
 * escopo. Em vez de reescrever as regras, o dono decidiu proibir o escopo
 * restrito: a tela não oferece, a ação recusa e o banco tem uma trava
 * (`user_clinic_roles_finance_scope_all`). Assim a tela nunca promete um
 * limite que o banco não cumpre.
 */
export const FUNCOES_SO_COM_TODAS_AS_UNIDADES: readonly UserRole[] = ["finance_franchisor"];

export function soAceitaTodasAsUnidades(role: UserRole): boolean {
  return FUNCOES_SO_COM_TODAS_AS_UNIDADES.includes(role);
}

/** O escopo pedido serve para esta função? (`undefined` = o padrão, "Todas".) */
export function escopoAceitoPelaFuncao(role: UserRole, scope: string | null | undefined): boolean {
  if (!soAceitaTodasAsUnidades(role)) return true;
  return scope == null || scope === "all";
}

export const RECUSA_DO_ESCOPO_DO_FINANCEIRO =
  "O Financeiro da Franqueadora trabalha sempre com todas as unidades. Para limitar a algumas unidades, use uma função da própria unidade.";
