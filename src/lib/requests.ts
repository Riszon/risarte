// Pedidos do dentista ao coordenador (H4.6 D): sugerir reavaliação / pedir
// revisão do plano. Tipos compartilhados entre a página e a seção.

export type ClinicalRequestKind = "reevaluation" | "plan_revision";

export const REQUEST_KIND_LABELS: Record<ClinicalRequestKind, string> = {
  reevaluation: "Sugestão de reavaliação",
  plan_revision: "Revisão do plano",
};

export type RequestMediaItem = {
  id: string;
  name: string;
  url: string | null;
};

export type ClinicalRequestItem = {
  id: string;
  kind: ClinicalRequestKind;
  body: string;
  status: "open" | "resolved";
  requesterName: string | null;
  createdAt: string;
  resolvedByName: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  media: RequestMediaItem[];
};
