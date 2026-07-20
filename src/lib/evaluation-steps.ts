// Sequências guiadas do Cockpit do Coordenador (Fase 4 — reformulação, Bloco B).
// AVALIAÇÃO = Fase 2 (Conversão Clínica); REAVALIAÇÃO = Fase 6 (Reavaliação).
// Cada passo é um momento da consulta; o cockpit segue esta ordem.

export type EvaluationFlowKind = "avaliacao" | "reavaliacao";

export type EvaluationStep = {
  /** Número do passo (1..8). */
  n: number;
  title: string;
  description: string;
  /** id de uma seção do cockpit para onde o botão do passo rola (opcional). */
  anchor?: string;
};

/** Âncora da área de ferramentas clínicas do cockpit (fotos, considerações, envio). */
export const TOOLS_ANCHOR = "avaliacao-ferramentas";

export const AVALIACAO_STEPS: EvaluationStep[] = [
  {
    n: 1,
    title: "Quebra-gelo e rapport",
    description:
      "Estabeleça conexão genuína com o cliente: escuta ativa e autenticidade.",
  },
  {
    n: 2,
    title: "Levantamento de informações",
    description:
      "Anamnese, queixa principal e o que motivou o cliente a procurar a Risarte.",
    anchor: TOOLS_ANCHOR,
  },
  {
    n: 3,
    title: "Avaliação clínica inicial",
    description:
      "Observação visual e tátil. Faça fotos, radiografias, escaneamento intraoral e testes clínicos, documentando os achados.",
    anchor: TOOLS_ANCHOR,
  },
  {
    n: 4,
    title: "Despertar (awakening)",
    description:
      "Use as fotos e exames para mostrar ao cliente os problemas latentes e criar consciência da necessidade de tratamento.",
    anchor: TOOLS_ANCHOR,
  },
  {
    n: 5,
    title: "Apresentação da Metodologia Risarte",
    description:
      "Explique os 6 pilares que guiam o cuidado: Diagnóstico, Planejamento, Saúde, Função, Estética e Prevenção.",
  },
  {
    n: 6,
    title: "Escuta estratégica",
    description:
      "Identifique prioridades, decisores e urgências. Registre a reação do cliente — ajuda o planejamento e o comercial.",
    anchor: TOOLS_ANCHOR,
  },
  {
    n: 7,
    title: "Documentação e gravação",
    description:
      "Garanta que a conversa, os arquivos e as considerações fiquem salvos, para o Planejamento e o Comercial terem o contexto completo.",
    anchor: TOOLS_ANCHOR,
  },
  {
    n: 8,
    title: "Enviar ao Planejamento",
    description:
      "Reunidas as informações, envie ao Centro de Planejamento. A recepção agenda a apresentação do plano com o cliente.",
    anchor: TOOLS_ANCHOR,
  },
];

export const REAVALIACAO_STEPS: EvaluationStep[] = [
  {
    n: 1,
    title: "Acolhimento e recepção",
    description:
      "Crie um ambiente de boas-vindas: o cliente deve se sentir lembrado e especial.",
  },
  {
    n: 2,
    title: "Coleta de feedback",
    description:
      "Ouça a percepção do cliente sobre o resultado, sua satisfação e eventuais preocupações.",
  },
  {
    n: 3,
    title: "Controle de qualidade (avaliação clínica)",
    description:
      "Confira o último plano concluído procedimento a procedimento (aprovar, revisar ou reprovar). Faça novas fotos, radiografias e considerações para os próximos planos.",
    anchor: TOOLS_ANCHOR,
  },
  {
    n: 4,
    title: "Antes × depois",
    description:
      "Compare as fotos antigas com as novas (câmera intraoral) para o cliente compreender a transformação alcançada.",
    anchor: TOOLS_ANCHOR,
  },
  {
    n: 5,
    title: "Despertar",
    description:
      "Amplie a percepção de valor: continuidade de tratamento, novos planos ou encaminhar para o Acompanhamento (Fase 7).",
  },
  {
    n: 6,
    title: "Solicitação de novos exames",
    description:
      "Se necessário, explique com clareza e justificativa a necessidade de novos exames, sem gerar ansiedade.",
    anchor: TOOLS_ANCHOR,
  },
  {
    n: 7,
    title: "Próximas etapas e documentação",
    description:
      "Oriente o cliente sobre o que vem a seguir. Garanta que tudo fique salvo para o Planejamento e o Comercial.",
    anchor: TOOLS_ANCHOR,
  },
  {
    n: 8,
    title: "Enviar ao Planejamento",
    description:
      "Encaminhe para a próxima fase; a recepção agenda a explicação do plano/orçamento com o cliente.",
    anchor: TOOLS_ANCHOR,
  },
];

export function stepsForFlow(kind: EvaluationFlowKind): EvaluationStep[] {
  return kind === "avaliacao" ? AVALIACAO_STEPS : REAVALIACAO_STEPS;
}

export const FLOW_LABELS: Record<EvaluationFlowKind, string> = {
  avaliacao: "Avaliação",
  reavaliacao: "Reavaliação",
};
