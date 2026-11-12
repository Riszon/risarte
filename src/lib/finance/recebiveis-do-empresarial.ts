/**
 * AS COBRANÇAS DO EMPRESARIAL NOS RECEBÍVEIS (AP147, relato OC-00166).
 *
 * As cobranças das empresas moram em `empresarial.adhesion_billing`, e os
 * Recebíveis só liam as parcelas dos pacientes (`payment_installments`). A
 * cobrança PAGA já entrava no razão da Franqueadora (1040); a EM ABERTO não
 * aparecia em lugar nenhum do Financeiro.
 *
 * Decisões do dono (12/11/2026):
 *   - as cobranças são da FRANQUEADORA (nenhuma empresa tem unidade, e é lá
 *     que a paga já entra);
 *   - BLOCO PRÓPRIO: o atraso das empresas não entra no % de inadimplência dos
 *     pacientes nem nas metas que leem esse %.
 *
 * ⚠️ VENCIDO É PELA DATA, NÃO PELA SITUAÇÃO "OVERDUE". Ela só aparece depois que
 * alguém roda a checagem de inadimplência do Empresarial; contar por ela
 * mostraria menos atraso do que existe (a mesma regra da tela de Cobranças).
 *
 * ⚠️ SEM MULTA NEM JUROS: a cobrança da empresa não tem esses termos gravados.
 * O valor é o da cobrança.
 */

import { daysApart } from "./aging";

export type SituacaoDaCobranca = "PENDING" | "OVERDUE" | "PAID" | "CANCELLED";

export type CobrancaDaEmpresa = {
  id: string;
  companyId: string;
  empresa: string;
  tipo: "IMPLANTATION" | "MONTHLY";
  mesReferencia: string | null;
  valorCents: number;
  situacao: SituacaoDaCobranca;
  /** Vencimento; nulo quando a cobrança foi gravada sem data. */
  vencimento: string | null;
};

export type LinhaDoEmpresarial = CobrancaDaEmpresa & {
  vencida: boolean;
  diasDeAtraso: number;
};

export type ResumoDoEmpresarial = {
  abertoCents: number;
  abertoQuantidade: number;
  vencidoCents: number;
  vencidoQuantidade: number;
  /** Vencido ÷ a receber, com uma casa. `null` quando não há nada a receber. */
  taxaPercent: number | null;
  /** Em aberto sem vencimento gravado: entram no "a receber", nunca no vencido. */
  semVencimento: number;
};

/** Só PENDENTE e EM ATRASO são dívida; paga e cancelada não entram. */
export function emAberto(c: Pick<CobrancaDaEmpresa, "situacao">): boolean {
  return c.situacao === "PENDING" || c.situacao === "OVERDUE";
}

export function recebiveisDoEmpresarial(
  cobrancas: CobrancaDaEmpresa[],
  hoje: string
): { linhas: LinhaDoEmpresarial[]; resumo: ResumoDoEmpresarial } {
  const linhas: LinhaDoEmpresarial[] = cobrancas
    .filter(emAberto)
    .map((c) => {
      const vencida = c.vencimento !== null && c.vencimento < hoje;
      return {
        ...c,
        vencida,
        diasDeAtraso: vencida ? daysApart(c.vencimento as string, hoje) : 0,
      };
    })
    .sort((a, b) => (a.vencimento ?? "9999").localeCompare(b.vencimento ?? "9999"));

  const soma = (ls: LinhaDoEmpresarial[]) => ls.reduce((s, l) => s + l.valorCents, 0);
  const vencidas = linhas.filter((l) => l.vencida);

  const abertoCents = soma(linhas);
  const vencidoCents = soma(vencidas);

  return {
    linhas,
    resumo: {
      abertoCents,
      abertoQuantidade: linhas.length,
      vencidoCents,
      vencidoQuantidade: vencidas.length,
      taxaPercent:
        abertoCents > 0 ? Math.round((vencidoCents / abertoCents) * 1000) / 10 : null,
      semVencimento: linhas.filter((l) => l.vencimento === null).length,
    },
  };
}
