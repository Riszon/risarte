// Risarte Empresarial — a leitura das MEDIDAS da implantação (1046).
//
// Uma porta só para o quadro do funil e para a ficha: os dois mostram o mesmo
// %, e duas leituras da mesma coisa divergem no dia em que alguém mexe numa.
//
// ⚠️ AP11 — LEITURA QUE FALHA NÃO VIRA "ZERO". Sem a resposta do banco, o lead
// fica SEM medidas (`undefined` no mapa) e a conta volta a usar só as marcas
// à mão — nunca "0 de 11 titulares", que pareceria implantação parada.
//
// Não é "use server": não tem guarda. Quem chama já tem; e o banco só devolve
// lead que quem chama enxerga (`can_access_lead`).

import type { empresarialDb } from "./db";
import type { MedidasDaImplantacao } from "./implantacao";

type Db = Awaited<ReturnType<typeof empresarialDb>>;

type Linha = {
  lead_id: string;
  ganho_em: string | null;
  contratados: number | null;
  ativos: number;
  boas_vindas: number;
  com_agendamento: number;
  orientacoes_em: string | null;
  apresentacao_em: string | null;
};

export type ImplantacaoMedida = {
  /** Quando o lead entrou em Fechamento como ganho (o selo do cartão). */
  ganhoEm: string | null;
  medidas: MedidasDaImplantacao;
};

export async function medidasDaImplantacao(
  db: Db,
  leadIds: readonly string[]
): Promise<Map<string, ImplantacaoMedida>> {
  const mapa = new Map<string, ImplantacaoMedida>();
  if (leadIds.length === 0) return mapa;
  const { data, error } = await db.rpc("implantacao_dos_leads", {
    p_lead_ids: [...leadIds],
  });
  if (error) {
    console.error("implantacao_dos_leads failed:", error.message);
    return mapa;
  }
  for (const l of (data ?? []) as Linha[]) {
    mapa.set(l.lead_id, {
      ganhoEm: l.ganho_em,
      medidas: {
        contratados: l.contratados,
        ativos: Number(l.ativos ?? 0),
        boasVindas: Number(l.boas_vindas ?? 0),
        comAgendamento: Number(l.com_agendamento ?? 0),
        orientacoesEm: l.orientacoes_em,
        apresentacaoEm: l.apresentacao_em,
      },
    });
  }
  return mapa;
}
