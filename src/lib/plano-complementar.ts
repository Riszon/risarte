// AP64 (decisão do dono, 03/11/2026): o PLANO COMPLEMENTAR. Um plano vendido
// pode ganhar um complemento enquanto o cliente está em tratamento (Fase 5):
// o Coordenador abre (com as informações clínicas), o Planner monta, o
// Coordenador aprova e o Consultor apresenta. O plano vendido não muda.
// Plano: docs/comercial/AP63-AP64-PLANO.md. Banco: 0355.
// Puro: testável sem banco. Quem decide de verdade é `open_plan_complement`.

import type { JourneyPhase } from "@/lib/journey";
import { planStage, type PlanLifecycle, type TreatmentPlanStatus } from "@/lib/planning";

type PlanoResumo = {
  id: string;
  status: TreatmentPlanStatus;
  lifecycle: PlanLifecycle | null;
  commercialReturnNote?: string | null;
  supersededAt?: string | null;
  complementOfPlanId?: string | null;
  complementNo?: number | null;
  createdAt: string;
};

/** Os ciclos de vida de um plano que foi VENDIDO e segue valendo. */
const VENDIDO: PlanLifecycle[] = ["aceito", "em_tratamento", "concluido", "suspenso"];

export function ehComplemento(p: Pick<PlanoResumo, "complementOfPlanId">): boolean {
  return Boolean(p.complementOfPlanId);
}

/**
 * O plano vendido que recebe o complemento: o mais novo que foi vendido e não é
 * complemento. ⚠️ "Vendido" = tem negociação ACEITA (`vendidos`, os ids). A
 * situação do plano (aceito, em tratamento) é marcada à mão e no treino 3 de 4
 * planos vendidos seguiam "aguardando apresentação" — ela só vale como reforço.
 */
export function planoVendidoDeBase<T extends PlanoResumo>(
  planos: T[],
  vendidos: ReadonlySet<string> = new Set()
): T | null {
  return (
    [...planos]
      .filter((p) => !ehComplemento(p) && p.status === "approved" && !p.supersededAt)
      .filter((p) => vendidos.has(p.id) || (p.lifecycle && VENDIDO.includes(p.lifecycle)))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null
  );
}

/** Os planos com negociação aceita, a partir do mapa comercial do prontuário. */
export function planosVendidos(commercialByPlan: Record<string, { status: string }>): Set<string> {
  return new Set(Object.entries(commercialByPlan).filter(([, v]) => v.status === "aceita").map(([id]) => id));
}

/** Os complementos do cliente, do primeiro ao último. */
export function complementosDoCliente<T extends PlanoResumo>(planos: T[]): T[] {
  return planos
    .filter(ehComplemento)
    .sort((a, b) => (a.complementNo ?? 0) - (b.complementNo ?? 0));
}

/** Há um complemento ainda em montagem ou aprovação (só um por vez). */
export function complementoEmAndamento<T extends PlanoResumo>(planos: T[]): T | null {
  return complementosDoCliente(planos).find((p) => p.status !== "approved") ?? null;
}

/**
 * O botão "Abrir plano complementar": Coordenador (ou Admin), cliente na Fase 5,
 * com plano vendido e nenhum complemento em andamento. Devolve o motivo quando
 * não pode — a tela mostra em vez de esconder o caminho.
 */
export function podeAbrirComplemento(args: {
  fase: JourneyPhase;
  ehCoordenadorOuAdmin: boolean;
  planos: PlanoResumo[];
  /** Os ids dos planos com negociação aceita (`planosVendidos`). */
  vendidos?: ReadonlySet<string>;
}): { pode: true; baseId: string } | { pode: false; motivo: string | null } {
  if (!args.ehCoordenadorOuAdmin) return { pode: false, motivo: null };
  if (args.fase !== "treatment_start") return { pode: false, motivo: null };
  const base = planoVendidoDeBase(args.planos, args.vendidos);
  if (!base) return { pode: false, motivo: "O complemento parte de um plano vendido, e este cliente ainda não tem." };
  const andamento = complementoEmAndamento(args.planos);
  if (andamento) {
    return {
      pode: false,
      motivo: `O plano complementar ${andamento.complementNo ?? ""} ainda está em andamento. Aprove-o antes de abrir outro.`.replace("  ", " "),
    };
  }
  return { pode: true, baseId: base.id };
}

/** "Complemento 2 · Aguardando aprovação" — o rótulo curto do cartão e do prontuário. */
export function rotuloDoComplemento(p: PlanoResumo): string {
  const SITUACAO: Record<string, string> = {
    em_planejamento: "em planejamento",
    replanejamento: "em planejamento",
    aguardando_aprovacao: "aguardando aprovação",
    em_revisao: "devolvido ao Planner",
    aprovado_coordenador: "aprovado",
    aguardando_apresentacao: "aguardando apresentação",
    apresentado: "apresentado",
    aceito: "vendido",
    reprovado: "não aceito",
    em_tratamento: "em tratamento",
    concluido: "concluído",
    cancelado: "cancelado",
    suspenso: "suspenso",
  };
  const s = SITUACAO[planStage(p)] ?? planStage(p);
  return `Complemento ${p.complementNo ?? ""} · ${s}`.replace("  ", " ");
}

export const MENSAGENS_DO_COMPLEMENTO: Record<string, string> = {
  NOT_ALLOWED: "Só o Coordenador Clínico da unidade (ou o Admin Master) abre o plano complementar.",
  CLINICAL_NOTES_REQUIRED: "Escreva as informações clínicas: o que viu, o que indica e por quê.",
  WRONG_PHASE: "O plano complementar é aberto com o cliente em tratamento (Fase 5).",
  PARENT_NOT_SOLD: "O complemento parte de um plano vendido (negociação aceita e venda não cancelada).",
  COMPLEMENT_IN_PROGRESS: "Já há um plano complementar em andamento. Aprove-o antes de abrir outro.",
  PLAN_NOT_FOUND: "Plano não encontrado.",
};

export function mensagemDoComplemento(erro: string): string {
  const chave = Object.keys(MENSAGENS_DO_COMPLEMENTO).find((k) => erro.includes(k));
  return chave ? MENSAGENS_DO_COMPLEMENTO[chave] : "Não foi possível abrir o plano complementar.";
}
