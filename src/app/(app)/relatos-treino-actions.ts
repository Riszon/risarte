"use server";

import { getSessionContext } from "@/lib/auth";
import { pendentesNoTreino } from "@/lib/relatos-do-treino";

/**
 * O NÚMERO DA BOIA TAMBÉM CONTA O TREINO (19/09/2026, decisão do dono).
 *
 * A consulta do número roda no navegador, com a sessão da pessoa — e o
 * navegador não tem (nem pode ter) a chave do treino. Por isso esta porta: ela
 * roda no servidor da produção, que tem a chave, e devolve só um número.
 *
 * Dentro do treino devolve 0: lá o número é o de casa, e o treino não alcança
 * a produção. Falha (rede, migração) devolve `null` — "não consegui contar"
 * (AP11), que a boia mostra como "—" em vez de zero. Continua sem derrubar a
 * barra de cima de todas as telas: nada aqui lança.
 */
export async function contarPendentesDoTreino(): Promise<number | null> {
  try {
    const session = await getSessionContext();
    return await pendentesNoTreino({
      prodUserId: session.userId,
      isAdminMaster: session.isAdminMaster,
    });
  } catch {
    return null;
  }
}
