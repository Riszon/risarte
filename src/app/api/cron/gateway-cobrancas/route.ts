import { origemDaRotina } from "@/lib/cron-auth";
import { criarCobrancasAutomaticas } from "@/lib/asaas/cobrancas-automaticas";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";

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
  // 4018 (19.32.6): nas unidades que ligaram as mensalidades, a do mês que vem
  // nasce (dia 1 do mês anterior) e o atraso do PPR+ é conferido todo dia.
  const admin = createAdminClient();
  const geradas = await admin.rpc("_ppr_generate_run").then((x) => (x.error ? 0 : Number(x.data ?? 0)));
  const { data: unidades } = await admin.from("gateway_auto_charge_units").select("clinic_id").not("fees_enabled_from", "is", null);
  let atraso = 0;
  for (const u of unidades ?? []) {
    const x = await admin.rpc("_ppr_refresh_delinquency_raw", { p_clinic_id: u.clinic_id });
    if (!x.error) atraso += Number(x.data ?? 0);
  }
  const r = await criarCobrancasAutomaticas({ origem });
  // 4020 (19.35.3): o contrato em atraso e o distrato aberto avisam o Gerente
  // (a cada 7 dias; o distrato aberto há mais de 30, também o Financeiro).
  const distrato = await admin.rpc("_distrato_watch_run").then((x) => (x.error ? null : x.data));
  // 4021 (ASA6): a cobrança mensal da rede — abre a prévia do mês que fechou (só
  // das unidades com a configuração completa), o lembrete do prazo, a prévia
  // pronta para aprovação e os avisos de atraso. A EMISSÃO é sempre à mão.
  const cobrancaDaRede = await admin.rpc("_franchise_monthly_cron").then((x) => (x.error ? null : x.data));
  // 4021a: a conferência das taxas (só confere e mostra; o resumo ao Financeiro só com divergência nova).
  const conferencia = await admin.rpc("_franchise_reconcile_run").then((x) => (x.error ? null : x.data));
  return Response.json({
    ok: true,
    origem,
    criadas: r.criadas,
    falhas: r.falhas,
    puladas: r.puladas,
    motivo: r.motivo,
    mensalidadesGeradas: geradas,
    atraso,
    distrato,
    cobrancaDaRede,
    conferencia,
  });
}
