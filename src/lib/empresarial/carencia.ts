/**
 * QUANDO A PESSOA PODE COMEÇAR A USAR O PROGRAMA.
 *
 * ⚠️ A CARÊNCIA NÃO É UM NÚMERO, SÃO TRÊS — e vale a mais longa:
 *
 *   1. a da **empresa**, contada do início do contrato;
 *   2. a do **colaborador**, contada da entrada dele (a empresa define o padrão
 *      e cada colaborador pode ter a sua);
 *   3. a do **benefício**, em meses, contada também da entrada — essa é por
 *      procedimento e por isso NÃO entra na data desta lista (ver abaixo).
 *
 * Esta função responde a pergunta da recepção: *"a partir de quando eu posso
 * agendar para essa pessoa?"*. Ela devolve a data das duas carências GERAIS —
 * as que valem para qualquer procedimento.
 *
 * ⚠️ A CARÊNCIA POR PROCEDIMENTO FICA DE FORA DA DATA, DE PROPÓSITO, e a tela
 * declara isso. Ela é diferente para cada procedimento; misturá-la aqui daria
 * uma data única que estaria errada para quase todos os casos — cedo demais
 * para uns, tarde demais para outros. A lista mostra a data geral e, ao lado, a
 * relação dos procedimentos que têm carência própria, que é a informação que
 * quem liga precisa para não marcar o que ainda não pode.
 *
 * O motor de benefícios (`benefits.ts`) continua sendo quem decide, procedimento
 * a procedimento, na hora do orçamento. Aqui é só o aviso antecipado.
 */

export type EntradaDaCarencia = {
  /** Início do contrato da empresa (ISO) — nulo quando ainda não começou. */
  contratoIniciadoEm: string | null;
  /** Carência da empresa, em dias, a partir do início do contrato. */
  diasDaEmpresa: number;
  /** Padrão de carência do colaborador, em dias, a partir da entrada dele. */
  diasDoColaboradorPadrao: number;
  /** Carência própria deste colaborador; `null` = usa o padrão da empresa. */
  diasDesteColaborador: number | null;
  /** Entrada da pessoa no programa (ISO). Dependente usa a data do titular. */
  entrouEm: string | null;
};

export type Liberacao = {
  /** Quando a pessoa passa a poder agendar. `null` = já pode. */
  liberadoEm: string | null;
  /** Já está liberada nesta data de referência? */
  liberada: boolean;
  /** Qual das duas carências decidiu a data — para a tela poder explicar. */
  motivo: "empresa" | "colaborador" | null;
};

function somaDias(iso: string, dias: number): Date {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + dias);
  return d;
}

/**
 * ⚠️ `referencia` ENTRA COMO PARÂMETRO, não é lida do relógio aqui dentro.
 * Função que pergunta as horas sozinha não tem como ser testada, e este projeto
 * já pagou caro por hora lida no fuso errado — a data de negócio vem de quem
 * chama, que sabe se é o relógio brasileiro ou uma data de teste.
 */
export function liberacaoDaPessoa(
  entrada: EntradaDaCarencia,
  referencia: Date
): Liberacao {
  const candidatas: { data: Date; motivo: "empresa" | "colaborador" }[] = [];

  if (entrada.contratoIniciadoEm && entrada.diasDaEmpresa > 0) {
    candidatas.push({
      data: somaDias(entrada.contratoIniciadoEm, entrada.diasDaEmpresa),
      motivo: "empresa",
    });
  }

  // ⚠️ `?? padrão` E NÃO `|| padrão`: a carência própria pode ser ZERO, que
  // significa "esta pessoa não tem carência nenhuma". Com `||`, o zero cairia
  // no padrão da empresa e a pessoa ficaria presa a uma carência que alguém
  // tirou dela de propósito.
  const diasDoColaborador =
    entrada.diasDesteColaborador ?? entrada.diasDoColaboradorPadrao;
  if (entrada.entrouEm && diasDoColaborador > 0) {
    candidatas.push({
      data: somaDias(entrada.entrouEm, diasDoColaborador),
      motivo: "colaborador",
    });
  }

  if (candidatas.length === 0) {
    return { liberadoEm: null, liberada: true, motivo: null };
  }

  // A mais LONGA manda: passar uma carência não adianta se a outra ainda corre.
  const maior = candidatas.reduce((a, b) => (b.data > a.data ? b : a));

  if (maior.data <= referencia) {
    return { liberadoEm: null, liberada: true, motivo: null };
  }
  return {
    liberadoEm: maior.data.toISOString(),
    liberada: false,
    motivo: maior.motivo,
  };
}
