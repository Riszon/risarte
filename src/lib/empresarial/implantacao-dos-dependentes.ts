// Risarte Empresarial — A IMPLANTAÇÃO DOS DEPENDENTES NOVOS (1050, R7;
// decisões do dono, 18/11/2026).
//
// Antes, a implantação de dependente só saía na 1ª implantação da empresa
// (quando combinada "com dependentes"); quem entrava depois não tinha como
// ser cobrado. Regras do dono:
//   • cobra só os dependentes que entraram e ainda não pagaram;
//   • o valor é UM MÊS DO PACOTE de dependentes do titular (individual,
//     familiar ou extras) — quem passa do individual ao familiar paga o
//     familiar INTEIRO (não a diferença);
//   • quem paga segue a 1049 (o titular que paga os próprios dependentes
//     recebe a cobrança no nome dele);
//   • só na empresa com "implantação com dependentes" combinada.
//
// Por dependente (sem pacote), cada dependente é o próprio pacote: cobra só
// os novos — cobrar todos de novo faria quem já pagou pagar duas vezes.
//
// Pura: "cobertos" vem de `dependents_implantation_coverage` (o maior número
// coberto entre as linhas sem cobrança e as de cobrança não cancelada).

import { custoDosDependentesDoTitular, type AdhesionPricing } from "./pricing";

export type TitularDaImplantacao = {
  employeeId: string;
  nome: string;
  /** Dependentes ativos hoje. */
  ativos: number;
  /** Quantos dependentes dele já pagaram implantação. */
  cobertos: number;
  /** 1049: nulo = a empresa paga os dependentes dele. */
  pagador: { nome: string; documento: string } | null;
};

export type ImplantacaoDoTitular = {
  employeeId: string;
  nome: string;
  /** Dependentes ativos que a cobrança cobre (vai para a cobertura). */
  dependentes: number;
  novos: number;
  cents: number;
  pagador: { nome: string; documento: string } | null;
};

/** Quem deve implantação de dependente agora, e quanto. */
export function implantacaoDosDependentesNovos(
  pricing: AdhesionPricing,
  titulares: readonly TitularDaImplantacao[]
): ImplantacaoDoTitular[] {
  const out: ImplantacaoDoTitular[] = [];
  for (const t of titulares) {
    const ativos = Math.max(0, Math.floor(t.ativos));
    const cobertos = Math.max(0, Math.floor(t.cobertos));
    if (ativos <= cobertos) continue;
    let cents: number;
    if (pricing.dependentMode === "PER_DEPENDENT") {
      cents = (ativos - cobertos) * Math.max(0, pricing.dependentIndividualFeeCents);
    } else {
      const antes = custoDosDependentesDoTitular(pricing, cobertos);
      const depois = custoDosDependentesDoTitular(pricing, ativos);
      // Entrou alguém sem mudar o pacote (o 3º num familiar de até 3): o
      // pacote já pago cobre.
      if (depois <= antes) continue;
      cents = depois;
    }
    if (cents <= 0) continue;
    out.push({ employeeId: t.employeeId, nome: t.nome, dependentes: ativos, novos: ativos - cobertos, cents, pagador: t.pagador });
  }
  return out;
}

/**
 * Quantos dependentes de cada titular já estão cobertos: o maior entre as
 * linhas sem cobrança (já pagos antes, estimativa, dispensa) e as de cobrança
 * que não foi cancelada.
 */
export function cobertosPorTitular(
  linhas: readonly { employee_id: string; dependents_covered: number; billing_status: string | null }[]
): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of linhas) {
    if (l.billing_status === "CANCELLED") continue;
    m.set(l.employee_id, Math.max(m.get(l.employee_id) ?? 0, l.dependents_covered));
  }
  return m;
}
