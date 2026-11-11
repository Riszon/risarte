import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { verificarConta } from "./link";

/**
 * A VERIFICAÇÃO SEMANAL DAS CONTAS ASAAS (decisão do dono, 10/11/2026).
 *
 * A rota roda TODO DIA, mas cada conta só é verificada quando a última
 * verificação tem 7 dias ou mais — ou quando a última falhou ou não terminou
 * (essa volta a ser tentada no dia seguinte, em vez de esperar uma semana).
 *
 * O que a verificação faz: valida a chave, atualiza a situação da conta, as
 * tarifas, a chave Pix e a antecipação. De quebra, mantém a chave EM USO — o
 * Asaas desativa a chave parada há 3 meses. Recusa da chave derruba a
 * prontidão da unidade e avisa o Admin Master (`_gateway_record_check`, 4002).
 */

export const DIAS_ENTRE_VERIFICACOES = 7;

type ContaDaRotina = { id: string; last_check_at: string | null; last_check_ok: boolean | null };

/** Esta conta está na vez? Pura, para o teste. */
export function estaNaVez(c: Pick<ContaDaRotina, "last_check_at" | "last_check_ok">, agora: Date): boolean {
  if (!c.last_check_at) return true;
  if (c.last_check_ok === false) return true;
  const t = new Date(c.last_check_at).getTime();
  if (!Number.isFinite(t)) return true;
  return agora.getTime() - t >= DIAS_ENTRE_VERIFICACOES * 86_400_000;
}

export type ResultadoDaRotina = { contas: number; verificadas: number; aprovadas: number; falharam: number; inconclusivas: number };

export async function rodarVerificacaoDasContas(agora: Date = new Date()): Promise<ResultadoDaRotina> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("gateway_accounts")
    .select("id, last_check_at, last_check_ok")
    .neq("status", "disabled")
    .not("api_key_secret_id", "is", null)
    .order("last_check_at", { ascending: true, nullsFirst: true })
    .limit(200);
  if (error) throw new Error(`gateway accounts read failed: ${error.message}`);

  const contas = (data ?? []) as ContaDaRotina[];
  const r: ResultadoDaRotina = { contas: contas.length, verificadas: 0, aprovadas: 0, falharam: 0, inconclusivas: 0 };
  // Uma por vez: são poucas contas, e o limite de chamadas do Asaas é por conta.
  for (const c of contas.filter((x) => estaNaVez(x, agora)).slice(0, 40)) {
    const v = await verificarConta({ accountId: c.id, actorId: null, purpose: "weekly_check" });
    r.verificadas++;
    if (v.status === "ok") r.aprovadas++;
    else if (v.status === "failed") r.falharam++;
    else r.inconclusivas++;
  }
  return r;
}
