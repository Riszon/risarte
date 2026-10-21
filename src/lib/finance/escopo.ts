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
