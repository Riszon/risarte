// Indica +Risos — várias indicações de uma vez (a partir do "Pedir indicação").
// Regra PURA: confere as linhas antes de ir ao banco. O banco confere de novo
// cada uma (duplicidade, já é cliente, autoindicação) — isto aqui só evita a
// ida inútil e mostra o erro na linha certa.

export const ACEITES = ["presencial", "telefone", ""] as const;
export type Aceite = (typeof ACEITES)[number];

export const ACEITE_LABEL: Record<Aceite, string> = {
  presencial: "Sim, pessoalmente",
  telefone: "Sim, por telefone",
  "": "Ainda não (convite)",
};

export type LinhaLote = { nome: string; telefone: string; aceite: Aceite };

/** Limite de pessoas numa leva (proteção contra colar uma lista gigante por engano). */
export const MAX_POR_LOTE = 30;

const digitos = (s: string) => s.replace(/\D/g, "");

/** Linha vazia (nome e telefone em branco) é ignorada — a última costuma ficar assim. */
export const linhaVazia = (l: LinhaLote) => !l.nome.trim() && !digitos(l.telefone);

/**
 * Erros por linha (índice → mensagem), na ordem da tela. Telefone repetido
 * DENTRO da leva é apontado aqui: o banco recusaria a segunda como duplicada.
 */
export function errosDoLote(linhas: LinhaLote[]): Map<number, string> {
  const erros = new Map<number, string>();
  const vistos = new Map<string, number>();
  linhas.forEach((l, i) => {
    if (linhaVazia(l)) return;
    const tel = digitos(l.telefone);
    if (!l.nome.trim()) erros.set(i, "Informe o nome.");
    else if (!tel) erros.set(i, "Informe o WhatsApp.");
    else if (tel.length < 10 || tel.length > 11) erros.set(i, "WhatsApp com DDD (10 ou 11 números).");
    else if (!ACEITES.includes(l.aceite)) erros.set(i, "Escolha como a pessoa aceitou o contato.");
    else if (vistos.has(tel)) erros.set(i, `Mesmo WhatsApp da pessoa ${vistos.get(tel)! + 1} desta lista.`);
    if (tel) vistos.set(tel, vistos.get(tel) ?? i);
  });
  return erros;
}

/** As linhas que vão ao banco (sem as vazias). */
export const linhasPreenchidas = (linhas: LinhaLote[]) => linhas.filter((l) => !linhaVazia(l));
