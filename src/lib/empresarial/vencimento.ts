// Risarte Empresarial — O VENCIMENTO E O MÊS DE REFERÊNCIA DA COBRANÇA.
//
// ⚠️ ISTO ERA UMA FUNÇÃO PRIVADA DENTRO DA SERVER ACTION, e tinha DOIS defeitos
// que ninguém relatou (achado AP1 do `docs/BACKLOG.md`, 24/09/2026, encontrado
// lendo o arquivo para outra entrega):
//
//   function nextDue(dueDay) {
//     const now = new Date();
//     const due = new Date(now.getFullYear(), now.getMonth(), dueDay);
//     if (due < now) due.setMonth(due.getMonth() + 1);
//     const reference = new Date(now.getFullYear(), now.getMonth(), 1);
//     return { dueDate: due.toISOString().slice(0,10), referenceMonth: ... };
//   }
//
// 1. **O "HOJE" VINHA DO RELÓGIO DA MÁQUINA.** `now.getFullYear()/getMonth()`
//    leem o calendário do servidor, e na Vercel o servidor roda em **UTC**.
//    Entre 21h e meia-noite de Brasília o servidor já está no dia seguinte:
//    uma cobrança gerada às 22h do dia 30/09 gravaria o **mês de referência de
//    outubro**. É a mesma armadilha de fuso que o `CLAUDE.md` registra — na
//    máquina de quem programa ela não existe, só onde o sistema roda.
//
// 2. **DIA 31 EM MÊS QUE NÃO TEM 31 ESCORREGAVA PARA O MÊS SEGUINTE.**
//    `new Date(2026, 1, 31)` é 3 de MARÇO, não 28 de fevereiro — o JavaScript
//    transborda em silêncio. Como `due_day` não tem trava no banco (aceita 1 a
//    31), a empresa com vencimento no dia 31 receberia, em fevereiro, um
//    boleto para 3 de março. "Vencimento no dia 31" em mês de 28 dias significa
//    o ÚLTIMO dia do mês, e é isso que a conta faz agora.
//
// A conta virou pura e testada de propósito: ela decide dinheiro e data, e as
// duas coisas que ela errava são invisíveis para quem olha a tela num
// computador brasileiro.

import { todayInBrazil } from "@/lib/dates";

/** Quantos dias tem o mês (1-12) daquele ano. */
export function diasNoMes(ano: number, mes: number): number {
  // Dia 0 do mês seguinte = último dia deste. Em UTC, sem relógio no meio.
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

export type Vencimento = {
  /** "YYYY-MM-DD" — a data do boleto. */
  dueDate: string;
  /** "YYYY-MM-01" — o mês a que a cobrança se refere. */
  referenceMonth: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * O próximo vencimento, a partir do dia combinado com a empresa.
 *
 * **A regra de negócio NÃO mudou**: o vencimento é o `dueDay` deste mês; se ele
 * já passou — ou é hoje —, vai para o mês que vem. Só o relógio mudou de lugar.
 *
 * ⚠️ "HOJE" É DATA CIVIL BRASILEIRA, não instante. Comparar "o dia 10 já
 * passou?" é uma pergunta de calendário, e calendário não tem hora: a resposta
 * tem de ser a mesma às 9h e às 23h. A versão antiga comparava um INSTANTE
 * (meia-noite do dia 10) com o AGORA, e por isso o dia 10 "já tinha passado"
 * a partir das 00h01 — o comportamento continua o mesmo, agora sem depender
 * da hora em que alguém clicou.
 *
 * @param hoje Data civil "YYYY-MM-DD". O padrão é hoje no Brasil; os testes
 *             passam a data para não depender do dia em que rodam.
 */
export function proximoVencimento(
  dueDay: number,
  hoje: string = todayInBrazil()
): Vencimento {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hoje);
  // Data inválida não vira data inventada: devolver "hoje" com o mês corrente
  // seria pior que falhar, porque o boleto sairia com um número plausível.
  if (!m) throw new Error(`proximoVencimento: data inválida "${hoje}"`);
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);

  // O dia combinado, preso dentro do mês. `due_day` aceita 1 a 31 no banco.
  const diaPedido = Math.min(Math.max(Math.trunc(dueDay) || 1, 1), 31);

  // Já passou (ou é hoje) neste mês? Então é o mês que vem.
  const noMesQueVem = Math.min(diaPedido, diasNoMes(ano, mes)) <= dia;
  const anoAlvo = noMesQueVem && mes === 12 ? ano + 1 : ano;
  const mesAlvo = noMesQueVem ? (mes === 12 ? 1 : mes + 1) : mes;

  const diaAlvo = Math.min(diaPedido, diasNoMes(anoAlvo, mesAlvo));

  return {
    dueDate: `${anoAlvo}-${pad(mesAlvo)}-${pad(diaAlvo)}`,
    // ⚠️ O MÊS DE REFERÊNCIA É O MÊS CORRENTE, sempre — não o do vencimento.
    // É a competência: a mensalidade de setembro que vence em 10 de outubro
    // continua sendo de setembro. Trocar isto mudaria o que a DRE enxerga.
    referenceMonth: `${ano}-${pad(mes)}-01`,
  };
}

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/**
 * "2026-09-01" → "setembro de 2026", sem passar por instante nenhum.
 *
 * ⚠️ POR QUE NÃO `toLocaleDateString`. O jeito anterior era
 * `new Date(mes + "T00:00:00").toLocaleDateString("pt-BR", { timeZone: ... })`
 * — e uma data-só SEM fuso é lida no relógio da MÁQUINA. Na Vercel (UTC) isso
 * vira meia-noite em UTC; formatado depois em São Paulo, **volta três horas** e
 * cai no dia anterior — ou seja, no MÊS anterior. A descrição da mensalidade de
 * setembro sairia escrita "agosto de 2026", e só no servidor: na máquina de
 * quem programa, que está em Brasília, o texto sai certo.
 *
 * Mês é dado de calendário, não instante. Aqui ele é lido como número.
 */
export function rotuloDoMes(referenceMonth: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(referenceMonth);
  if (!m) return referenceMonth;
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return referenceMonth;
  return `${MESES[mes - 1]} de ${m[1]}`;
}
