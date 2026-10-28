import "server-only";

import type { createClient } from "@/lib/supabase/server";
import {
  diasDoPeriodo,
  lerAtendimentosDoPeriodo,
  lerBaseDasHoras,
} from "@/app/(app)/agenda/planejamento-anual/horas-dados";
import { horasDosAtendimentos } from "@/lib/horas-da-agenda";
import {
  calcularHoraClinica,
  periodoDaHoraClinica,
  type HoraClinica,
  type MesDaHoraClinica,
} from "./hora-clinica";
import { monthRangeOf } from "@/lib/dates";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * A HORA CLÍNICA DA UNIDADE, lida de UM lugar só — a Precificação, a margem da
 * negociação, a venda direta e o Painel da rede chamam esta função, e por isso
 * a hora é a mesma nas quatro telas.
 *
 * - Custo fixo de cada mês: `clinic_fixed_costs_by_month` (0330, a regra do
 *   Ponto de equilíbrio).
 * - Horas de cadeira: a conta do Planejamento Anual (`lerBaseDasHoras` +
 *   `horasPossiveis`).
 * - Ocupação esperada e valor provisório: `clinic_cost_settings`, unidade →
 *   rede. A ocupação é lida À PARTE: sem a 0330 a coluna não existe, e o resto
 *   não pode cair junto.
 * - Horas trabalhadas (só com `comTrabalhadas`): para a hora REAL, que é
 *   comparação — a margem da venda não precisa delas.
 *
 * Leitura que falha não vira zero: entra em `naoLido`, a hora calculada fica
 * nula e vale o valor provisório, com o motivo escrito.
 */
export async function carregarHoraClinica(
  supabase: Supabase,
  clinicId: string,
  opts: { hoje: string; ateMes?: string | null; comTrabalhadas?: boolean }
): Promise<HoraClinica> {
  const periodo = periodoDaHoraClinica(opts.hoje, opts.ateMes);
  const naoLido: string[] = [];

  const [config, ocupacao, custos, base, atendimentos] = await Promise.all([
    supabase
      .from("clinic_cost_settings")
      .select("clinic_id, chair_cost_per_hour_cents")
      .or(`clinic_id.eq.${clinicId},clinic_id.is.null`),
    supabase
      .from("clinic_cost_settings")
      .select("clinic_id, expected_occupancy_percent")
      .or(`clinic_id.eq.${clinicId},clinic_id.is.null`),
    supabase.rpc("clinic_fixed_costs_by_month", {
      p_clinic: clinicId,
      p_from: periodo.de,
      p_to: periodo.ate,
    }),
    lerBaseDasHoras(supabase, clinicId, periodo.de, periodo.ate),
    opts.comTrabalhadas
      ? lerAtendimentosDoPeriodo(supabase, clinicId, periodo.de, periodo.ate)
      : Promise.resolve(null),
  ]);

  // A cascata: a linha da unidade, senão a da rede.
  const daUnidade = <T extends { clinic_id: string | null }>(rows: T[] | null, campo: keyof T) => {
    const u = (rows ?? []).find((r) => r.clinic_id === clinicId && r[campo] != null);
    const n = (rows ?? []).find((r) => r.clinic_id === null && r[campo] != null);
    const v = (u ?? n)?.[campo];
    return v == null ? null : Number(v);
  };

  if (config.error) {
    console.error("hora clínica — configuração:", config.error.message);
  }
  const manualCents = config.error
    ? 0
    : (daUnidade(config.data as { clinic_id: string | null; chair_cost_per_hour_cents: number | null }[], "chair_cost_per_hour_cents") ?? 0);

  // Sem a 0330 a coluna não existe: vale a ocupação padrão, sem derrubar nada.
  if (ocupacao.error) console.error("hora clínica — ocupação esperada:", ocupacao.error.message);
  const ocupacaoEsperada = ocupacao.error
    ? null
    : daUnidade(
        ocupacao.data as { clinic_id: string | null; expected_occupancy_percent: number | null }[],
        "expected_occupancy_percent"
      );

  const custoDoMes = new Map<string, { fixo: number; depreciacao: number }>();
  if (custos.error) {
    console.error("hora clínica — custo fixo:", custos.error.message);
    naoLido.push(
      /clinic_fixed_costs_by_month|schema cache|does not exist/i.test(custos.error.message)
        ? "o custo fixo (falta aplicar a atualização 0330 no banco)"
        : "o custo fixo do Financeiro"
    );
  } else {
    for (const r of (custos.data ?? []) as { month: string; fixed_cents: number; depreciation_cents: number }[]) {
      custoDoMes.set(String(r.month).slice(0, 7), {
        fixo: Number(r.fixed_cents ?? 0),
        depreciacao: Number(r.depreciation_cents ?? 0),
      });
    }
  }

  const minutosCadeira = new Map<string, number>();
  if (!base.entrada) {
    naoLido.push(...base.naoLido.map((x) => `${x} (agenda)`));
  } else {
    for (const d of diasDoPeriodo(base.entrada, periodo.de, periodo.ate)) {
      const m = d.date.slice(0, 7);
      minutosCadeira.set(m, (minutosCadeira.get(m) ?? 0) + d.cadeira);
    }
  }

  const meses: MesDaHoraClinica[] = periodo.meses.map((mes) => {
    const { from, to } = monthRangeOf(`${mes}-01`);
    return {
      mes,
      fixoCents: custoDoMes.get(mes)?.fixo ?? 0,
      depreciacaoCents: custoDoMes.get(mes)?.depreciacao ?? 0,
      minutosCadeira: minutosCadeira.get(mes) ?? 0,
      minutosTrabalhados:
        atendimentos === null
          ? null
          : horasDosAtendimentos(atendimentos, { de: from, ate: to, hoje: opts.hoje }).trabalhadas,
    };
  });

  return calcularHoraClinica({
    periodo,
    meses,
    ocupacaoEsperadaPercent: ocupacaoEsperada,
    manualCents,
    naoLido,
  });
}
