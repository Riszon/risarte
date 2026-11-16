// Risarte Empresarial — a fase 8 do funil: a implantação.
//
// Puro e testado. A lista de passos espelha o CHECK da migração 1011, e há
// teste que LÊ a migração: duas listas da mesma coisa divergem no dia em que
// alguém mexe só numa.

export const IMPLEMENTATION_STEPS = [
  "IMPORT_EMPLOYEES",
  "GUIDELINES_SENT",
  "WELCOME",
  "GROUP_PRESENTATION",
  "FIRST_SCHEDULING",
] as const;
export type ImplementationStep = (typeof IMPLEMENTATION_STEPS)[number];

export const IMPLEMENTATION_STEP_LABELS: Record<ImplementationStep, string> = {
  IMPORT_EMPLOYEES: "Cadastrar os titulares",
  GUIDELINES_SENT: "Enviar as orientações",
  WELCOME: "Dar as boas-vindas",
  GROUP_PRESENTATION: "Apresentação para todos os titulares",
  FIRST_SCHEDULING: "Agendar a primeira consulta de cada um",
};

export const IMPLEMENTATION_STEP_HELP: Record<ImplementationStep, string> = {
  IMPORT_EMPLOYEES:
    "A empresa envia a lista (nome, CPF, telefone, e-mail) e o sistema cria o pré-cadastro. Os dados são completados no agendamento da primeira consulta.",
  GUIDELINES_SENT:
    "Como usar o programa, o que está coberto e o que fazer para marcar.",
  WELCOME:
    "Boas-vindas à empresa e a cada titular — é a fila da recepção e do SDR.",
  GROUP_PRESENTATION:
    "Algumas empresas pedem uma apresentação para toda a equipe. Nem toda pede: marque “não se aplica”.",
  FIRST_SCHEDULING:
    "O SDR liga para cada titular e marca a primeira consulta.",
};

/**
 * COMO O SISTEMA CONFERE CADA PASSO (1046). É o que a ficha mostra enquanto o
 * passo não fechou — quem lê precisa saber o que fazer para ele andar.
 */
export const IMPLEMENTATION_STEP_AUTO: Record<ImplementationStep, string> = {
  IMPORT_EMPLOYEES:
    "Conferido pelo sistema: titulares ativos na empresa, contra a quantidade contratada.",
  GUIDELINES_SENT:
    "Conferido pelo sistema: registre o envio com “Orientações do programa” na aba Envio e selos.",
  WELCOME:
    "Conferido pelo sistema: titulares com boas-vindas registradas (atendeu ou recusou), na fila de Boas-vindas da empresa.",
  GROUP_PRESENTATION:
    "Conferido pelo sistema: uma reunião da agenda marcada como realizada depois do fechamento.",
  FIRST_SCHEDULING:
    "Conferido pelo sistema: titulares com consulta marcada na agenda (cancelada não conta).",
};

/** Só este passo é opcional por natureza — as outras empresas todas precisam. */
export function podeNaoSeAplicar(step: ImplementationStep): boolean {
  return step === "GROUP_PRESENTATION";
}

export type PassoRegistrado = {
  step: ImplementationStep;
  doneAt: string | null;
  notApplicable: boolean;
  note: string | null;
  doneByName: string | null;
};

/**
 * O QUE O SISTEMA JÁ SABE MEDIR (1046, `implantacao_dos_leads`).
 *
 * Pedido do dono (16/11/2026): a implantação deixa de depender de alguém
 * lembrar de marcar. Cada passo é medido pelo que aconteceu de verdade; a
 * marca à mão fica para a exceção ("concluir mesmo assim", com motivo) — o
 * automático não pode travar a empresa que tem um titular que não quer
 * agendar.
 */
export type MedidasDaImplantacao = {
  /** Contratados + termos aceitos. `null` = contrato sem quantidade. */
  contratados: number | null;
  /** Titulares ativos. */
  ativos: number;
  /** Titulares ativos com boas-vindas registradas (contatado ou recusou). */
  boasVindas: number;
  /** Titulares ativos com algum agendamento não cancelado. */
  comAgendamento: number;
  /** Primeiro envio registrado com as orientações. */
  orientacoesEm: string | null;
  /** Reunião realizada depois do ganho. */
  apresentacaoEm: string | null;
};

export type OrigemDoPasso = "AUTOMATICO" | "MANUAL" | "NAO_SE_APLICA" | "PENDENTE";

export type SituacaoDoPasso = {
  step: ImplementationStep;
  /** Quanto do passo já foi feito, de 0 a 1 (o parcial entra no %). */
  fracao: number;
  feito: boolean;
  origem: OrigemDoPasso;
  /** "3 de 11", quando o passo é uma contagem. */
  parcial: string | null;
};

export type ProgressoDaImplantacao = {
  concluidos: number;
  /** Passos que contam: os "não se aplica" saem do denominador. */
  total: number;
  percentual: number;
  faltando: ImplementationStep[];
  completa: boolean;
  /** Cada passo, na ordem da lista. */
  passos: SituacaoDoPasso[];
};

const deN = (feitos: number, de: number) => `${Math.min(feitos, de)} de ${de}`;

/** Um passo medido: fração e parcial, sem olhar a marca à mão. */
function medir(
  step: ImplementationStep,
  m: MedidasDaImplantacao
): { fracao: number; parcial: string | null } {
  const porTitular = (feitos: number) =>
    m.ativos > 0
      ? { fracao: Math.min(1, feitos / m.ativos), parcial: deN(feitos, m.ativos) }
      : { fracao: 0, parcial: "sem titulares ainda" };
  switch (step) {
    case "IMPORT_EMPLOYEES": {
      // Sem quantidade no contrato, basta haver titular: não há número a
      // alcançar, e exigir "todos" seria uma meta que ninguém sabe qual é.
      if (m.contratados == null || m.contratados <= 0) {
        return m.ativos > 0
          ? { fracao: 1, parcial: `${m.ativos} cadastrado(s)` }
          : { fracao: 0, parcial: "nenhum cadastrado" };
      }
      return {
        fracao: Math.min(1, m.ativos / m.contratados),
        parcial: deN(m.ativos, m.contratados),
      };
    }
    case "WELCOME":
      return porTitular(m.boasVindas);
    case "FIRST_SCHEDULING":
      return porTitular(m.comAgendamento);
    case "GUIDELINES_SENT":
      return { fracao: m.orientacoesEm ? 1 : 0, parcial: null };
    case "GROUP_PRESENTATION":
      return { fracao: m.apresentacaoEm ? 1 : 0, parcial: null };
  }
}

/**
 * Quanto da implantação já foi feito.
 *
 * Sem `medidas` (leitura que falhou), vale só a marca à mão, como antes. Com
 * elas, cada passo é medido e o PARCIAL entra no % — "3 de 11 titulares" anda
 * a barra, em vez de esperar o passo inteiro.
 *
 * ⚠️ "Não se aplica" sai dos DOIS lados da conta. Se ficasse no denominador, a
 * empresa que não pediu apresentação coletiva nunca chegaria a 100% — e
 * barra que nunca fecha é barra que ninguém olha.
 *
 * ⚠️ A marca à mão ("concluir mesmo assim") vence a medida: é a saída para o
 * passo que o sistema mede e que, na vida real, não vai chegar a 100%.
 */
export function progressoDaImplantacao(
  registrados: readonly PassoRegistrado[],
  medidas?: MedidasDaImplantacao | null
): ProgressoDaImplantacao {
  const porPasso = new Map(registrados.map((r) => [r.step, r]));

  const passos: SituacaoDoPasso[] = IMPLEMENTATION_STEPS.map((step) => {
    const r = porPasso.get(step);
    if (r?.notApplicable) {
      return { step, fracao: 0, feito: false, origem: "NAO_SE_APLICA", parcial: null };
    }
    const medido = medidas ? medir(step, medidas) : { fracao: 0, parcial: null };
    if (medido.fracao >= 1) {
      return { step, fracao: 1, feito: true, origem: "AUTOMATICO", parcial: medido.parcial };
    }
    if (r?.doneAt) {
      return { step, fracao: 1, feito: true, origem: "MANUAL", parcial: medido.parcial };
    }
    return { step, fracao: medido.fracao, feito: false, origem: "PENDENTE", parcial: medido.parcial };
  });

  const contam = passos.filter((p) => p.origem !== "NAO_SE_APLICA");
  const faltando = contam.filter((p) => !p.feito).map((p) => p.step);
  const soma = contam.reduce((t, p) => t + p.fracao, 0);

  return {
    concluidos: contam.length - faltando.length,
    total: contam.length,
    // Sem passo nenhum que conte (tudo "não se aplica"), a implantação está
    // completa por definição — e dividir por zero não tem resposta. Com
    // passo faltando, nunca mostra 100% (arredonda para baixo, até 99).
    percentual:
      faltando.length === 0
        ? 100
        : Math.min(99, Math.floor((soma / contam.length) * 100)),
    faltando,
    completa: faltando.length === 0,
    passos,
  };
}

// -----------------------------------------------------------------------------
// A conferência do fechamento
// -----------------------------------------------------------------------------

export type ConferenciaInput = {
  /** A empresa precisa existir: implantação é cadastrar titulares nela. */
  companyId: string | null;
  everythingOk: boolean;
  considerations: string | null;
};

/**
 * O que impede o consultor de confirmar o fechamento.
 *
 * Lista o que falta em vez de só recusar — mesma regra da proposta.
 */
export function impedimentosDaConferencia(input: ConferenciaInput): string[] {
  const falta: string[] = [];
  if (!input.companyId) {
    falta.push(
      "criar a empresa a partir do lead (a implantação cadastra os titulares nela)"
    );
  }
  // "Não está tudo certo" não é erro — é informação. Mas aí precisa dizer o quê,
  // senão o registro não serve para ninguém resolver nada.
  if (!input.everythingOk && !input.considerations?.trim()) {
    falta.push("escrever o que não está certo");
  }
  return falta;
}
