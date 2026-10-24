import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  diaDoAtendimento,
  desfechoDe,
  minutosMarcados,
  montarQuadro,
} from "@/lib/horas-da-agenda";
import {
  diasDoPeriodo,
  lerAtendimentosDoPeriodo,
  lerBaseDasHoras,
} from "@/app/(app)/agenda/planejamento-anual/horas-dados";
import type { Fotografia, MedidaDe } from "./regras";

/**
 * A MEDIÇÃO FEITA NO CÓDIGO — ocupação e horas ociosas da cadeira (O2,
 * 24/10/2026).
 *
 * ⚠️ É A MESMA CONTA DO PLANEJAMENTO ANUAL, não uma parecida: o carregador
 * (`lerBaseDasHoras`, `lerAtendimentosDoPeriodo`) e a conta (`montarQuadro`)
 * são os da tela `/agenda/planejamento-anual`. Ocupação realizada =
 * horas trabalhadas ÷ horas de cadeira dos dias até hoje. Refazer isso no banco
 * daria números diferentes dos da tela — por isso o banco não mede estes dois
 * indicadores, e o resultado final é gravado pelo servidor
 * (`goal_record_app_final`).
 *
 * ⚠️ LÊ COM A CHAVE DE SERVIÇO, e isso é de propósito: a barra de uma meta da
 * rede precisa enxergar as agendas de todas as unidades da meta, e cada pessoa
 * enxerga só as suas — sem isso, o número mudaria conforme quem abre. Quem
 * chama TEM de ter conferido antes que a pessoa pode ver a meta (a leitura da
 * meta pela RLS). O que sai daqui é só o agregado em horas, sem dado de
 * paciente.
 *
 * Leitura que falha não vira zero: devolve `null` e a tela diz que não mediu.
 */
export async function medirCadeira(
  indicador: "chair_occupancy" | "chair_idle_hours",
  clinicIds: string[],
  de: string,
  ate: string,
  hoje: string
): Promise<Fotografia | null> {
  if (clinicIds.length === 0 || ate < de) return null;
  const db = createAdminClient() as unknown as Parameters<typeof lerBaseDasHoras>[0];
  const porUnidade = await Promise.all(
    clinicIds.map(async (id) => {
      const [base, atendimentos] = await Promise.all([
        lerBaseDasHoras(db, id, de, ate),
        lerAtendimentosDoPeriodo(db, id, de, ate),
      ]);
      if (!base.entrada || atendimentos === null) return null;
      const dias = diasDoPeriodo(base.entrada, de, ate);
      const quadro = montarQuadro(dias, atendimentos, hoje);
      if (!quadro.agenda) return null;

      // Por dia (para o gráfico das horas ociosas): cadeira do dia − trabalhado.
      const trabalhadoNoDia = new Map<string, number>();
      for (const a of atendimentos) {
        if (a.isOnline || desfechoDe(a) !== "concluido") continue;
        const d = diaDoAtendimento(a);
        trabalhadoNoDia.set(d, (trabalhadoNoDia.get(d) ?? 0) + minutosMarcados(a));
      }
      const porDia = dias
        .filter((d) => d.date <= hoje)
        .map((d) => ({ day: d.date, cadeira: d.cadeira, trabalhado: trabalhadoNoDia.get(d.date) ?? 0 }));

      return {
        id,
        trabalhado: quadro.agenda.trabalhadas,
        cadeira: quadro.ateHoje.cadeira,
        porDia,
      };
    })
  );
  if (porUnidade.some((u) => u === null)) return null;
  const unidades = porUnidade as NonNullable<(typeof porUnidade)[number]>[];

  const medida = (trabalhado: number, cadeira: number) =>
    indicador === "chair_occupancy"
      ? { num: 100 * trabalhado, den: cadeira }
      : { num: Math.max(0, cadeira - trabalhado), den: null };

  const dias = new Map<string, { cadeira: number; trabalhado: number }>();
  for (const u of unidades) {
    for (const d of u.porDia) {
      const t = dias.get(d.day) ?? { cadeira: 0, trabalhado: 0 };
      t.cadeira += d.cadeira;
      t.trabalhado += d.trabalhado;
      dias.set(d.day, t);
    }
  }
  const total = unidades.reduce((t, u) => ({ c: t.c + u.cadeira, w: t.w + u.trabalhado }), { c: 0, w: 0 });

  return {
    from: de,
    to: ate,
    kind: indicador === "chair_occupancy" ? "rate" : "sum",
    n_clinics: clinicIds.length,
    n_participants: 0,
    restricted: false,
    total: medida(total.w, total.c),
    by_clinic: unidades.map((u): MedidaDe => ({ id: u.id, ...medida(u.trabalhado, u.cadeira) })),
    by_user: [],
    by_day: [...dias.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, t]) => ({ day, ...medida(t.trabalhado, t.cadeira) })),
  };
}
