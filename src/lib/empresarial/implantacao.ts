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

export type ProgressoDaImplantacao = {
  concluidos: number;
  /** Passos que contam: os "não se aplica" saem do denominador. */
  total: number;
  percentual: number;
  faltando: ImplementationStep[];
  completa: boolean;
};

/**
 * Quanto da implantação já foi feito.
 *
 * ⚠️ "Não se aplica" sai dos DOIS lados da conta. Se ficasse no denominador, a
 * empresa que não pediu apresentação coletiva nunca chegaria a 100% — e
 * barra que nunca fecha é barra que ninguém olha.
 */
export function progressoDaImplantacao(
  registrados: readonly PassoRegistrado[]
): ProgressoDaImplantacao {
  const porPasso = new Map(registrados.map((r) => [r.step, r]));

  const contam = IMPLEMENTATION_STEPS.filter(
    (s) => !porPasso.get(s)?.notApplicable
  );
  const faltando = contam.filter((s) => !porPasso.get(s)?.doneAt);
  const concluidos = contam.length - faltando.length;

  return {
    concluidos,
    total: contam.length,
    // Sem passo nenhum que conte (tudo "não se aplica"), a implantação está
    // completa por definição — e dividir por zero não tem resposta.
    percentual:
      contam.length === 0 ? 100 : Math.round((concluidos / contam.length) * 100),
    faltando,
    completa: faltando.length === 0,
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
