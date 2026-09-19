// ADMIN PRINCIPAL (0262) — as regras puras de quem mexe no acesso de quem.
//
// Pedido do dono (19/09/2026): pode haver outros Admins, mas sempre abaixo
// dele. Decisões dele: só o Admin Principal dá ou tira o Admin; o acesso de
// QUALQUER Admin (senha, funções, ambientes, desativar) só o Admin Principal
// altera; a matriz de permissões segue aberta a qualquer Admin.
//
// O banco repete estas travas (0262) para o que passa por ele. Senha e bloqueio
// de login passam pela chave de serviço, que o banco não sabe de quem veio —
// por isso a regra existe aqui também, e as ações a consultam.

export type Hierarquia = {
  /** Quem está logado é Admin Master? */
  souAdmin: boolean;
  /** Quem está logado é o Admin Principal? */
  souPrincipal: boolean;
  /** A pessoa cujo acesso se quer mexer é Admin? */
  alvoEAdmin: boolean;
  alvoEPrincipal: boolean;
  ehVoceMesmo: boolean;
};

/** Pode alterar login, senha, funções e ambientes desta pessoa? */
export function podeMexerNoAcessoDe(h: Hierarquia): boolean {
  if (!h.souAdmin) return false;
  if (h.alvoEAdmin && !h.souPrincipal) return false;
  return true;
}

/** Pode dar ou tirar o Admin desta pessoa? Só o Principal, e nunca em si. */
export function podeDarOuTirarAdmin(h: Hierarquia): boolean {
  return h.souPrincipal && !h.ehVoceMesmo && !h.alvoEPrincipal;
}

export const SO_O_ADMIN_PRINCIPAL =
  "O acesso de um Admin só o Admin Principal altera.";
