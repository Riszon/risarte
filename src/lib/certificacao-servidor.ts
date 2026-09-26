import "server-only";
import { acharNoTreino, clienteDoTreino } from "@/lib/treino";
import {
  contaDesde,
  missaoDoPapel,
  progressoDaMissao,
  type MetaDoTreino,
  type Medicao,
} from "@/lib/certificacao";
import { medirMissao, TEMPO_LIMITE_MS } from "@/lib/certificacao-contagem";
import type { UserRole } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  deveRegistrarConclusao,
  ehResultadoDaConclusao,
  retratoDaMedicao,
  type ResultadoDaConclusao,
} from "@/lib/certificacao-conclusao";

/**
 * MEDIR UMA MATRÍCULA — do banco da produção até o banco de treino e de volta.
 *
 * A matrícula (quem, qual função, desde quando) mora na PRODUÇÃO; o trabalho
 * que se conta mora no TREINO. A ponte entre os dois é o E-MAIL (`acharNoTreino`):
 * os logins novos nascem com o mesmo id nos dois bancos, mas os antigos não —
 * e contar pelo id da produção daria ZERO para essas pessoas, em silêncio.
 */
export type { Medicao };

export async function medirMatricula(entrada: {
  email: string;
  role: UserRole;
  started_at: string | null;
  metas: readonly MetaDoTreino[];
}): Promise<Medicao> {
  // A lei do marco (0273): sem o clique, não existe janela de contagem.
  const desde = contaDesde({ started_at: entrada.started_at });
  if (!desde) return { estado: "nao_comecou" };

  const missao = missaoDoPapel(entrada.metas, entrada.role).filter(
    (m) => m.minimo > 0
  );
  if (missao.length === 0) {
    return {
      estado: "sem_medicao",
      motivo: "a missão desta função ainda não tem critérios definidos",
    };
  }

  const treino = clienteDoTreino();
  if (!treino) {
    return {
      estado: "sem_medicao",
      motivo: "este servidor não tem acesso ao banco de treino",
    };
  }

  let pessoa: { id: string } | null;
  try {
    pessoa = await acharNoTreino(
      treino,
      entrada.email,
      AbortSignal.timeout(TEMPO_LIMITE_MS)
    );
  } catch {
    return {
      estado: "sem_medicao",
      motivo: "o banco de treino não respondeu a tempo",
    };
  }
  if (!pessoa) {
    return {
      estado: "sem_medicao",
      motivo:
        "não encontrei este e-mail no ambiente de treino — o login de lá pode estar com outro e-mail",
    };
  }

  const contagens = await medirMissao(
    treino,
    missao.map((m) => m.indicador),
    pessoa.id,
    desde
  );
  return { estado: "medido", progresso: progressoDaMissao(missao, contagens) };
}

/**
 * REGISTRA A CONCLUSÃO — só se a medição disser que foi cumprida (0281).
 *
 * ⚠️ É A ÚNICA PORTA para o certificado, e ela usa a CHAVE DE SERVIÇO de
 * propósito: `record_training_completion` não responde a usuário logado.
 * Quem decide "cumpriu" é esta medição, feita aqui no servidor contra o banco
 * de treino — nunca um valor vindo do navegador.
 *
 * Idempotente: o banco devolve o estado se a conclusão já foi registrada.
 * Falha ao registrar NÃO vira "cumprida": devolve nulo e grita no log — a
 * pessoa vê o progresso de sempre e a próxima abertura tenta de novo.
 */
export async function registrarSeCumprida(
  enrollmentId: string,
  medicao: Medicao | null
): Promise<ResultadoDaConclusao | null> {
  if (!deveRegistrarConclusao(medicao) || medicao?.estado !== "medido") return null;
  const { data, error } = await createAdminClient().rpc("record_training_completion", {
    p_enrollment_id: enrollmentId,
    p_snapshot: retratoDaMedicao(medicao.progresso, new Date()),
  });
  if (error) {
    console.error("registrarSeCumprida falhou:", error.message);
    return null;
  }
  if (!ehResultadoDaConclusao(data)) {
    console.error("registrarSeCumprida: resposta desconhecida do banco:", data);
    return null;
  }
  return data;
}

/**
 * Mede várias matrículas, poucas de cada vez.
 *
 * Uma turma de 20 pessoas com 5 critérios são 100 consultas ao treino. Todas
 * de uma vez poderiam estourar o limite de conexões do banco de treino e fazer
 * TODAS falharem — que a tela mostraria como "não deu para medir" para a turma
 * inteira. Em lotes pequenos, o pior caso é demorar um pouco mais.
 */
export async function medirVarias<T extends { chave: string }>(
  lista: readonly T[],
  medir: (item: T) => Promise<Medicao>,
  deUmaVez = 4
): Promise<Map<string, Medicao>> {
  const resultado = new Map<string, Medicao>();
  for (let i = 0; i < lista.length; i += deUmaVez) {
    const lote = lista.slice(i, i + deUmaVez);
    const medidas = await Promise.all(lote.map(medir));
    lote.forEach((item, j) => resultado.set(item.chave, medidas[j]));
  }
  return resultado;
}
