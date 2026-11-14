import { origemDaRotina } from "@/lib/cron-auth";
import { criarCobrancasAutomaticas } from "@/lib/asaas/cobrancas-automaticas";
import { isAdminClientConfigured } from "@/lib/supabase/admin";

/**
 * 4012 (ASA4, entrega 1; spec 19.4 e 19.10 item 5): A CRIAÇÃO DIÁRIA DAS
 * COBRANÇAS — a proposta A. Cria no Asaas as parcelas que entraram no prazo
 * (padrão 15 dias antes do vencimento), começando pelo vencimento mais próximo.
 *
 * Dois agendadores independentes chamam esta mesma rota: o cron da Vercel
 * (07:00 em Brasília) e o banco (`pg_cron` + `pg_net`, 09:30), com a senha que o
 * banco gerou no Vault. A segunda rodada só cria o que a primeira não criou
 * (idempotente). O vigia do banco (11:00) avisa se nenhuma das duas rodou.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const origem = await origemDaRotina(request);
  if (!origem) return new Response(null, { status: 401 });
  if (!isAdminClientConfigured()) return Response.json({ ok: false, error: "not_configured" }, { status: 500 });
  const r = await criarCobrancasAutomaticas({ origem });
  return Response.json({ ok: true, origem, criadas: r.criadas, falhas: r.falhas, puladas: r.puladas, motivo: r.motivo });
}
