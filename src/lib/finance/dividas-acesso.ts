import { pode, type SessionContext } from "@/lib/auth";
import { isFinanceFranchisor } from "@/lib/finance/access";

// LEVANTAMENTO DE DÍVIDAS (0404) — quem abre e quem mexe.
//
// Espelho de `public.debt_can`: a matriz decide, mas com TETO — só o
// Financeiro da Franqueadora alcança (o Admin Master sempre passa). Marcar
// outro papel na matriz não abre a tela, porque o banco também não abriria os
// dados; a tela segue o banco (a lição de OC-00094 a OC-00099).

function comTeto(session: SessionContext, capacidade: string): boolean {
  if (session.isAdminMaster) return true;
  return isFinanceFranchisor(session) && pode(session, capacidade);
}

export function podeVerDividas(session: SessionContext): boolean {
  return comTeto(session, "modulo.dividas");
}

export function podeLancarDividas(session: SessionContext): boolean {
  return podeVerDividas(session) && comTeto(session, "acao.dividas.lancar");
}

export function podeExcluirDividas(session: SessionContext): boolean {
  return podeVerDividas(session) && comTeto(session, "acao.dividas.excluir");
}

export function podeConfigurarDividas(session: SessionContext): boolean {
  return podeVerDividas(session) && comTeto(session, "acao.dividas.configurar");
}
