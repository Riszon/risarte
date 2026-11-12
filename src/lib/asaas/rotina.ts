import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { credencialDaConta, opcoesDaConta } from "./account";
import { listWebhooks } from "./api";
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

export type ResultadoDaRotina = {
  contas: number;
  verificadas: number;
  aprovadas: number;
  falharam: number;
  inconclusivas: number;
  /** ASA2: avisos pendentes processados, resumos de vencidas e filas pausadas. */
  avisosProcessados?: number;
  resumosDeVencidas?: number;
  filasPausadas?: number;
};

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

/**
 * ASA2 (4005), na mesma rotina diária:
 *   1. processa os avisos do Asaas que ficaram pendentes ou com erro;
 *   2. manda o resumo diário das cobranças vencidas ao Gerente de cada unidade;
 *   3. confere se o Asaas PAUSOU a fila de avisos de alguma conta (`interrupted`)
 *      e avisa o Admin Master.
 * Cada parte falha sozinha, sem derrubar as outras.
 */
export async function rodarRotinaDosAvisos(): Promise<Pick<ResultadoDaRotina, "avisosProcessados" | "resumosDeVencidas" | "filasPausadas">> {
  const admin = createAdminClient();
  const r = { avisosProcessados: 0, resumosDeVencidas: 0, filasPausadas: 0 };

  const pend = await admin.rpc("_gateway_process_pending", { p_account_id: null, p_limit: 500 });
  if (pend.error) console.error("gateway pending events failed:", pend.error.message);
  else r.avisosProcessados = Number(pend.data ?? 0);

  const res = await admin.rpc("_gateway_overdue_summary");
  if (res.error) console.error("gateway overdue summary failed:", res.error.message);
  else r.resumosDeVencidas = Number(res.data ?? 0);

  const { data: contas, error } = await admin
    .from("gateway_accounts")
    .select("id, webhook_id")
    .eq("status", "active")
    .not("api_key_secret_id", "is", null)
    .not("webhook_id", "is", null)
    .limit(200);
  if (error) {
    console.error("gateway accounts read failed:", error.message);
    return r;
  }
  for (const c of contas ?? []) {
    try {
      const cred = await credencialDaConta(c.id, "webhook_queue_check", null);
      const hooks = await listWebhooks(cred, opcoesDaConta(c.id, "webhook_queue_check"));
      const nosso = hooks.find((h) => h.id === c.webhook_id);
      if (nosso?.interrupted) {
        r.filasPausadas++;
        await admin.rpc("_gateway_notify_admins", {
          p_account_id: c.id,
          p_kind: "fila_pausada",
          p_key: new Date().toISOString().slice(0, 10),
          p_title: "Asaas: fila de avisos pausada",
          p_body: "O Asaas pausou a fila de avisos de pagamento desta conta. Reative a fila no painel do Asaas (Integrações › Webhooks); os avisos guardados lá serão reenviados.",
        });
      }
    } catch (e) {
      console.error("gateway webhook queue check failed:", e instanceof Error ? e.message : e);
    }
  }
  return r;
}
