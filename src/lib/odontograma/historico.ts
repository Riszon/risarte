// OD6 (J2): a boca como estava NUM DIA — o diagnóstico definido até ali + o que
// tinha sido feito até ali (H1/H2 da OD5, com a mesma conta). Puro.

import type { MarcaNoDente } from "@/lib/odontograma/desenho";
import { marcasDoDesenho, type Achado, type SituacaoDoDente } from "@/lib/odontograma/diagnostico";
import {
  achadosAte,
  procedimentosFeitos,
  sessoesNoDia,
  type SessaoComHistorico,
} from "@/lib/odontograma/execucao";
import type { RegraDoPlano } from "@/lib/odontograma/plano";
import { addDaysIso, startOfDayInBrazil } from "@/lib/dates";

/** O fim do dia (do Brasil) de "AAAA-MM-DD", como instante. */
export function fimDoDia(isoDia: string): string {
  return new Date(startOfDayInBrazil(addDaysIso(isoDia, 1)).getTime() - 1).toISOString();
}

export function marcasNoDia(
  isoDia: string,
  achados: Achado[],
  situacoes: SituacaoDoDente[],
  historico: SessaoComHistorico[],
  regras: Record<string, RegraDoPlano>
): MarcaNoDente[] {
  const ate = fimDoDia(isoDia);
  const definidos = achadosAte(achados, ate);
  const feitos = procedimentosFeitos(sessoesNoDia(historico, ate), regras, definidos);
  return marcasDoDesenho(definidos, situacoes, "definidos", feitos);
}
