// A LISTA DE COBRANÇA (relato OC-00009).
//
// A tela de Recebíveis mostra uma linha por COBRANÇA — é o certo para conferir
// o financeiro. Para LIGAR, está errado: quem deve cinco parcelas aparece cinco
// vezes, e ninguém liga cinco vezes para a mesma pessoa. Aqui a dívida é
// agrupada por pessoa.
//
// ⚠️ NENHUMA CONTA NOVA DE DINHEIRO. O valor de cada cobrança já vem calculado
// por `viewInstallment` (multa, juros, benefício perdido, dias de atraso) —
// aqui só se SOMA o que ela devolveu. Recalcular aqui faria esta tela discordar
// da ficha do cliente sobre a mesma dívida.

export const COLLECTION_OUTCOMES = [
  "NAO_ATENDEU",
  "FALEI_COM_A_PESSOA",
  "PROMETEU_PAGAR",
  "JA_PAGOU",
  "CONTESTA",
  "PEDIU_RENEGOCIAR",
  "NUMERO_ERRADO",
  "SEM_CONDICOES",
] as const;
export type CollectionOutcome = (typeof COLLECTION_OUTCOMES)[number];

export const COLLECTION_OUTCOME_LABELS: Record<CollectionOutcome, string> = {
  NAO_ATENDEU: "Não atendeu",
  FALEI_COM_A_PESSOA: "Falei com a pessoa",
  PROMETEU_PAGAR: "Prometeu pagar",
  JA_PAGOU: "Diz que já pagou",
  CONTESTA: "Contesta a dívida",
  PEDIU_RENEGOCIAR: "Pediu para renegociar",
  NUMERO_ERRADO: "Número errado",
  SEM_CONDICOES: "Sem condições agora",
};

/** Só esta resposta tem data de promessa — sem ela não há o que cobrar de volta. */
export function exigeDataPrometida(outcome: CollectionOutcome): boolean {
  return outcome === "PROMETEU_PAGAR";
}

/**
 * Respostas que pedem alguém além de quem ligou.
 *
 * "Diz que já pagou" vai para a conciliação; "contesta" e "pede para
 * renegociar" são decisão de gestor. Marcá-las é o que impede a cobrança de
 * ficar ligando para quem já resolveu — ou de fechar acordo no telefone.
 */
export function precisaDeOutraPessoa(outcome: CollectionOutcome): boolean {
  return (
    outcome === "JA_PAGOU" ||
    outcome === "CONTESTA" ||
    outcome === "PEDIU_RENEGOCIAR"
  );
}

// -----------------------------------------------------------------------------

/** O mínimo que esta conta precisa de cada cobrança já calculada. */
export type CobrancaParaCobranca = {
  clientId: string | null;
  cliente: string;
  telefone: string | null;
  isLate: boolean;
  daysLate: number;
  /** O que falta do principal. */
  balanceCents: number;
  /** O que falta HOJE: principal + benefício perdido + multa + juros. */
  updatedBalanceCents: number;
};

export type UltimoContato = {
  outcome: CollectionOutcome;
  note: string | null;
  promisedDate: string | null;
  contactedAt: string;
  authorName: string | null;
};

export type Inadimplente = {
  clientId: string;
  cliente: string;
  telefone: string | null;
  /** Valor de cobrança: só o vencido, já com multa e juros. */
  vencidoCents: number;
  quantidadeVencida: number;
  /** O que essa pessoa ainda deve e NÃO venceu — contexto para a negociação. */
  aVencerCents: number;
  /** Dias do atraso mais ANTIGO — é o que ordena a fila de cobrança. */
  diasDoMaisAntigo: number;
  ultimoContato: UltimoContato | null;
  /** Contatos registrados com esta pessoa, nesta unidade. */
  totalDeContatos: number;
};

/**
 * Agrupa as cobranças por pessoa e devolve a fila de cobrança.
 *
 * ⚠️ SÓ ENTRA QUEM TEM ALGO VENCIDO. Quem está só com parcela a vencer não é
 * inadimplente, e misturá-lo faria a lista de ligação encher de gente em dia —
 * que é como uma lista de cobrança deixa de ser usada.
 *
 * ⚠️ COBRANÇA SEM CLIENTE VINCULADO FICA DE FORA, e quem chama precisa dizer
 * quantas foram. Sem pessoa não há para quem ligar, e somá-la a um "sem nome"
 * inventaria um devedor que não existe.
 */
export function agruparInadimplentes(
  cobrancas: readonly CobrancaParaCobranca[],
  contatos: ReadonlyMap<string, { ultimo: UltimoContato; total: number }>
): { fila: Inadimplente[]; semCliente: number } {
  const porCliente = new Map<string, Inadimplente>();
  let semCliente = 0;

  for (const c of cobrancas) {
    if (!c.clientId) {
      if (c.isLate) semCliente += 1;
      continue;
    }

    const atual =
      porCliente.get(c.clientId) ??
      {
        clientId: c.clientId,
        cliente: c.cliente,
        telefone: c.telefone,
        vencidoCents: 0,
        quantidadeVencida: 0,
        aVencerCents: 0,
        diasDoMaisAntigo: 0,
        ultimoContato: null,
        totalDeContatos: 0,
      };

    if (c.isLate) {
      atual.vencidoCents += c.updatedBalanceCents;
      atual.quantidadeVencida += 1;
      atual.diasDoMaisAntigo = Math.max(atual.diasDoMaisAntigo, c.daysLate);
    } else {
      atual.aVencerCents += c.balanceCents;
    }

    porCliente.set(c.clientId, atual);
  }

  const fila = [...porCliente.values()].filter((p) => p.quantidadeVencida > 0);

  for (const p of fila) {
    const registro = contatos.get(p.clientId);
    p.ultimoContato = registro?.ultimo ?? null;
    p.totalDeContatos = registro?.total ?? 0;
  }

  // Quem deve mais aparece primeiro: é onde a ligação rende mais. Empate no
  // valor, desempata o atraso mais antigo — dívida velha é a que se perde.
  return {
    fila: fila.sort(
      (a, b) =>
        b.vencidoCents - a.vencidoCents ||
        b.diasDoMaisAntigo - a.diasDoMaisAntigo
    ),
    semCliente,
  };
}

/**
 * Quem já foi contatado e quem nunca foi.
 *
 * É o número que diz se a cobrança está acontecendo. Sem ninguém na fila a
 * resposta é NULA, não 0% — "0% contatado" sobre uma fila vazia seria acusar
 * de omissão quem não tem o que cobrar.
 */
export function cobertura(fila: readonly Inadimplente[]): {
  contatados: number;
  semContato: number;
  percentual: number | null;
} {
  if (fila.length === 0) {
    return { contatados: 0, semContato: 0, percentual: null };
  }
  const contatados = fila.filter((p) => p.totalDeContatos > 0).length;
  return {
    contatados,
    semContato: fila.length - contatados,
    percentual: Math.round((contatados / fila.length) * 100),
  };
}

/**
 * Promessas de pagamento que já venceram.
 *
 * É a lista mais acionável da tela: alguém disse "pago dia 10", o dia 10 passou
 * e a dívida continua aberta. Sem isso, "prometeu pagar" viraria um jeito de
 * a cobrança se dar por satisfeita.
 */
export function promessasVencidas(
  fila: readonly Inadimplente[],
  hoje: string
): Inadimplente[] {
  return fila.filter(
    (p) =>
      p.ultimoContato?.outcome === "PROMETEU_PAGAR" &&
      p.ultimoContato.promisedDate != null &&
      p.ultimoContato.promisedDate < hoje
  );
}

/**
 * A cobrança venceu dentro do período pedido?
 *
 * Extremos INCLUSOS: quem escolhe "de 01/03 a 31/03" espera o dia 31 dentro.
 * Ponta em branco é ponta aberta — "de 01/03 em diante" é um filtro legítimo,
 * e exigir as duas datas obrigaria a inventar um fim.
 */
export function noPeriodo(
  data: string,
  de: string | null,
  ate: string | null
): boolean {
  if (de && data < de) return false;
  if (ate && data > ate) return false;
  return true;
}

/**
 * O texto do período, para o cabeçalho do relatório e o nome do arquivo.
 *
 * ⚠️ Sem filtro, diz "tudo em aberto" — nunca uma data inventada. Relatório
 * que declara um período que ninguém escolheu faz quem lê acreditar num
 * recorte que não existe.
 */
export function rotuloDoPeriodo(
  de: string | null,
  ate: string | null,
  formatar: (iso: string) => string
): string {
  if (!de && !ate) return "Tudo em aberto";
  if (de && ate) return `Vencimento de ${formatar(de)} a ${formatar(ate)}`;
  if (de) return `Vencimento a partir de ${formatar(de)}`;
  return `Vencimento até ${formatar(ate!)}`;
}

/**
 * A frase da margem, para a tela e para o relatório.
 *
 * ⚠️ MORA AQUI, e não no componente de exportação, porque o SERVIDOR também a
 * usa (no cabeçalho de impressão). Exportar uma função de um arquivo
 * `"use client"` e chamá-la do servidor **compila e quebra ao abrir a tela** —
 * a mesma armadilha que derrubou a v0.229.0, na direção oposta.
 *
 * ⚠️ "Dentro do limite", nunca "saudável". O número é uma decisão da rede, não
 * uma referência de mercado — chamar de saudável seria o relatório se dar nota.
 */
export function situacaoDaMargem(
  taxaPercent: number | null,
  limitePercent: number | null
): string {
  if (taxaPercent === null) return "Nada a receber — não há taxa para comparar.";
  if (limitePercent === null) {
    return "A rede não definiu limite de inadimplência.";
  }
  return taxaPercent > limitePercent
    ? `ACIMA do limite de ${limitePercent}% definido pela rede.`
    : `Dentro do limite de ${limitePercent}% definido pela rede.`;
}

/**
 * A data que veio da URL, ou nulo.
 *
 * ⚠️ TEXTO QUE NÃO É DATA VIRA NULO, NUNCA ERRO DE TELA. Um endereço com
 * `?de=ontem` — link velho, favorito estragado, alguém digitando — chegava até
 * o formatador e derrubava a página inteira com erro 500. **Filtro ilegível é
 * filtro ausente**: a tela mostra tudo, que é a resposta honesta.
 */
export function dataDoFiltro(valor: string | null | undefined): string | null {
  const v = (valor ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  // Formato certo não garante data que existe: "2026-02-31" passa no molde.
  const d = new Date(`${v}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === v ? v : null;
}

/** O endereço que abre a conversa no WhatsApp. `null` sem telefone utilizável. */
export function linkDoWhatsApp(telefone: string | null): string | null {
  const digitos = (telefone ?? "").replace(/\D/g, "");
  if (digitos.length < 10) return null;
  const comPais = digitos.startsWith("55") ? digitos : `55${digitos}`;
  return `https://wa.me/${comPais}`;
}
