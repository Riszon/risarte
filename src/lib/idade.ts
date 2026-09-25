// IDADE E DATA CIVIL — calendário, não relógio (achado AP3).
//
// ⚠️ POR QUE ISTO EXISTE. A idade era calculada em QUATRO lugares diferentes
// (`prontuarios/actions.ts`, `prontuarios/client-form.tsx` e duas funções em
// `prontuarios/[id]/page.tsx`), todas com a mesma forma:
//
//   const birth = new Date(`${birthIso}T00:00:00`);
//   const now = new Date();
//   let years = now.getFullYear() - birth.getFullYear();
//
// Duas coisas erradas aí, e as duas só aparecem ONDE O SISTEMA RODA:
//
// 1. **`now` é o relógio da MÁQUINA.** Na Vercel o servidor está em UTC, três
//    horas à frente de Brasília. Entre 21h e meia-noite, `now.getDate()` já é
//    o dia seguinte — e a pessoa que faz aniversário amanhã aparece com a
//    idade nova hoje à noite.
// 2. **A data-só vira instante.** `new Date("2004-03-04T00:00:00")` é lido no
//    fuso da máquina; se depois for exibido com `timeZone: America/Sao_Paulo`,
//    volta três horas e mostra **03/03**. O paciente nascido no dia 4 aparece
//    como nascido no dia 3, para sempre, e só no servidor.
//
// A resposta é não ter relógio no meio: **"quantos anos ela tem" é uma conta de
// calendário**, e calendário se faz com números. As funções abaixo recebem duas
// datas civis ("YYYY-MM-DD") e devolvem a resposta — iguais às 9h e às 23h.

import { todayInBrazil } from "@/lib/dates";

type Civil = { ano: number; mes: number; dia: number };

function partes(iso: string): Civil | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  const c = { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
  if (c.mes < 1 || c.mes > 12 || c.dia < 1 || c.dia > 31) return null;
  return c;
}

const antes = (a: Civil, b: Civil) =>
  a.ano !== b.ano ? a.ano < b.ano : a.mes !== b.mes ? a.mes < b.mes : a.dia < b.dia;

/** Quantos dias tem o mês (1-12). Sem relógio: dia 0 do mês seguinte. */
function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * Anos completos entre o nascimento e hoje.
 *
 * `null` quando a data não dá para ler ou está no futuro — quem chama decide o
 * que mostrar. Devolver 0 seria afirmar que a pessoa tem menos de um ano.
 */
export function anosCompletos(
  nascimentoIso: string,
  hojeIso: string = todayInBrazil()
): number | null {
  const n = partes(nascimentoIso);
  const h = partes(hojeIso);
  if (!n || !h || antes(h, n)) return null;
  let anos = h.ano - n.ano;
  // Ainda não fez aniversário este ano?
  if (h.mes < n.mes || (h.mes === n.mes && h.dia < n.dia)) anos -= 1;
  return anos;
}

/**
 * Menor de 18 anos.
 *
 * ⚠️ NA DÚVIDA, MENOR. Data ilegível devolve `true`: o cadastro de menor exige
 * responsável, e errar para o lado de pedir o responsável custa uma pergunta a
 * mais; errar para o outro lado cria prontuário de criança sem responsável —
 * que é problema legal, não de tela.
 */
export function ehMenorDeIdade(
  nascimentoIso: string,
  hojeIso: string = todayInBrazil()
): boolean {
  const anos = anosCompletos(nascimentoIso, hojeIso);
  if (anos === null) return true;
  return anos < 18;
}

/** "34 anos" — para a pílula ao lado do nome. Vazio quando não dá para saber. */
export function idadeCurta(
  nascimentoIso: string,
  hojeIso: string = todayInBrazil()
): string {
  const anos = anosCompletos(nascimentoIso, hojeIso);
  if (anos === null) return "";
  return `${anos} ${anos === 1 ? "ano" : "anos"}`;
}

/**
 * "22 anos, 3 meses e 15 dias".
 *
 * O empréstimo de dias vem do mês ANTERIOR ao de hoje — é como se conta idade
 * em cartório, e é o que a versão antiga fazia (`new Date(ano, mes, 0)`).
 */
export function idadeDetalhada(
  nascimentoIso: string,
  hojeIso: string = todayInBrazil()
): string {
  const n = partes(nascimentoIso);
  const h = partes(hojeIso);
  if (!n || !h || antes(h, n)) return "";

  let anos = h.ano - n.ano;
  let meses = h.mes - n.mes;
  let dias = h.dia - n.dia;
  if (dias < 0) {
    meses -= 1;
    // O mês ANTERIOR ao de hoje (mês 0 = dezembro do ano passado).
    const anoAnterior = h.mes === 1 ? h.ano - 1 : h.ano;
    const mesAnterior = h.mes === 1 ? 12 : h.mes - 1;
    const diasDoMesAnterior = diasNoMes(anoAnterior, mesAnterior);
    // ⚠️ O ANIVERSÁRIO MENSAL É PRESO AO FIM DO MÊS. Quem nasceu dia 31 faz
    // "mesversário" no dia 28 em fevereiro — e a versão antiga não fazia esta
    // parte: de 31/01 a 01/03 ela devolvia **"-2 dias"**, porque emprestava os
    // 28 dias de fevereiro de uma diferença de -30. Achado pelo teste, não por
    // relato; ninguém tinha olhado essa combinação.
    const aniversarioNoMesAnterior = Math.min(n.dia, diasDoMesAnterior);
    dias = h.dia + (diasDoMesAnterior - aniversarioNoMesAnterior);
  }
  if (meses < 0) {
    anos -= 1;
    meses += 12;
  }
  const palavra = (n2: number, s: string, p: string) =>
    `${n2} ${n2 === 1 ? s : p}`;
  return `${palavra(anos, "ano", "anos")}, ${palavra(meses, "mês", "meses")} e ${palavra(dias, "dia", "dias")}`;
}
