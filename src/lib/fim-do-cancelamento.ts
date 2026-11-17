// O CANCELAMENTO PELO CAMINHO DO FIM (0426, Etapa 5 do plano
// docs/jornada/FIM-DO-TRATAMENTO-PLANO.md, seção 5.3).
//
// Quem decide é o banco (`prepare_cancellation_apply`,
// `register_cancellation_risks`, os gatilhos em `plan_cancellations`); este
// arquivo só diz o que a tela mostra e traduz as recusas.

export type DestinoDoCancelamento = "reevaluation" | "follow_up";

export type CanalDosRiscosDoCancelamento = "ligacao" | "mensagem" | "presencial" | "carta";

export const DESTINO_DO_CANCELAMENTO_LABEL: Record<DestinoDoCancelamento, string> = {
  reevaluation: "Reavaliação (Fase 6): o Coordenador avalia o que foi feito",
  follow_up: "Acompanhamento (Fase 7) com retorno: o Coordenador contata o cliente",
};

export const CANAL_DOS_RISCOS_DO_CANCELAMENTO: Record<CanalDosRiscosDoCancelamento, string> = {
  ligacao: "Ligação",
  mensagem: "Mensagem",
  presencial: "Pessoalmente",
  carta: "Carta ou e-mail",
};

/** O mínimo de texto dos riscos (o banco recusa abaixo). */
export const MINIMO_DOS_RISCOS_DO_CANCELAMENTO = 20;

export type FimDoCancelamento = {
  kind: string;
  /** Sobra outro tratamento: o cliente fica na Fase 5, sem destino. */
  segueEmTratamento: boolean;
  /** A fase do cliente agora. */
  fase: string | null;
  destino: DestinoDoCancelamento | null;
  retorno: string | null;
  /** D25: o termo espera o registro do Coordenador sobre os riscos. */
  riscosPendentes: boolean;
};

/** A efetivação pede o destino? Só no contrato, com o cliente na Fase 5 e nada sobrando. */
export function pedeDestino(f: FimDoCancelamento | null | undefined): boolean {
  return Boolean(f && f.kind === "contrato" && f.fase === "treatment_start" && !f.segueEmTratamento);
}

/** As recusas do banco, em português de quem opera. */
export function recusaDoCancelamento(mensagem: string): string | null {
  const m = mensagem ?? "";
  if (m.includes("RISKS_PENDING"))
    return "O termo tem procedimento começado e não terminado: o Coordenador precisa registrar os riscos informados ao cliente antes da assinatura.";
  if (m.includes("RISKS_REQUIRED"))
    return `Descreva os riscos clínicos informados ao cliente (pelo menos ${MINIMO_DOS_RISCOS_DO_CANCELAMENTO} caracteres).`;
  if (m.includes("ALREADY_SIGNED")) return "O termo já foi assinado: os riscos são registrados antes da assinatura.";
  if (m.includes("INVALID_CHANNEL")) return "Escolha por qual meio os riscos foram informados.";
  if (m.includes("INVALID_DATE")) return "A data em que os riscos foram informados não pode ser no futuro.";
  if (m.includes("DESTINATION_REQUIRED"))
    return "Não sobra outro tratamento: escolha para onde o cliente vai (Reavaliação ou Acompanhamento).";
  if (m.includes("INVALID_DESTINATION")) return "Escolha Reavaliação ou Acompanhamento.";
  if (m.includes("RETURN_DATE_PAST")) return "A data do retorno tem de ser depois de hoje.";
  if (m.includes("TREATMENT_STILL_OPEN"))
    return "O cliente ainda tem tratamento em andamento: ele fica na Fase 5. Atualize a tela e efetive de novo.";
  if (m.includes("ALREADY_APPLIED")) return "Este cancelamento já foi efetivado.";
  if (m.includes("NOT_ALLOWED")) return "Sua função não permite esta etapa do cancelamento.";
  if (m.includes("NOT_FOUND")) return "Termo não encontrado. Atualize a tela.";
  return null;
}
