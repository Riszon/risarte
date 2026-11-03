import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysIso, formatIsoMonthBr, monthRangeOf, todayInBrazil } from "@/lib/dates";
import { lerTodasAsPaginas } from "@/lib/paginar";
import { createAdminClient } from "@/lib/supabase/admin";
import { calcularIndicadores, textoDoTempo, type LinhaDoPainel } from "./indicadores";
import { pdfDoRelatorio } from "./relatorio";
import { BUCKET } from "./send";

/**
 * O RELATÓRIO MENSAL (ZS7) — `/api/cron/signatures-monthly`, dia 1º às 09:00
 * UTC (06:00 em Brasília). Decisão do dono: o relatório da REDE INTEIRA, com o
 * comparativo por unidade, igual para todos os destinatários de
 * Configurações → Relatório mensal.
 *
 * O PDF do mês anterior vai para o bucket (`_relatorios/AAAA-MM/`) e um e-mail
 * por destinatário entra na fila (`signature_outbox`, `monthly_report`); a
 * rotina de hora em hora manda (sem o Resend, espera). A planilha fica na
 * página de Relatórios — o e-mail leva o PDF e os números no corpo.
 *
 * Uma vez por mês: se já saiu sem erro, a rodada seguinte não repete.
 */

export type ResultadoMensal = { mes: string; destinatarios: number; pdf: boolean; pulado?: string };

export async function rodarRelatorioMensal(deps: { admin?: SupabaseClient; hoje?: string } = {}): Promise<ResultadoMensal> {
  const admin = deps.admin ?? createAdminClient();
  const hoje = deps.hoje ?? todayInBrazil();
  const anterior = monthRangeOf(addDaysIso(monthRangeOf(hoje).from, -1));
  const mes = anterior.from.slice(0, 7);
  const registrar = async (stats: Record<string, unknown>, erro: string | null = null) => {
    const { error } = await admin.rpc("signature_log_job_run", { p_job: "monthly", p_stats: stats, p_error: erro });
    if (error) console.error("signature monthly log:", error.message);
  };

  const { data: ja } = await admin
    .from("signature_job_runs")
    .select("id")
    .eq("job", "monthly")
    .is("error", null)
    .contains("stats", { mes, enviado: true })
    .limit(1);
  if (ja && ja.length > 0) return { mes, destinatarios: 0, pdf: false, pulado: "já enviado neste mês" };

  const { data: settings } = await admin.from("signature_settings").select("monthly_report_recipients, waiting_buckets_days").eq("id", true).maybeSingle();
  const destinatarios = (Array.isArray(settings?.monthly_report_recipients) ? settings!.monthly_report_recipients : [])
    .filter((d: unknown): d is { name?: string; email: string } => !!d && typeof (d as { email?: unknown }).email === "string" && /@/.test((d as { email: string }).email));
  if (destinatarios.length === 0) {
    await registrar({ mes, enviado: false, pulado: "sem destinatários" });
    return { mes, destinatarios: 0, pdf: false, pulado: "sem destinatários" };
  }

  const leitura = await lerTodasAsPaginas<LinhaDoPainel>((de, ate) =>
    admin.rpc("signature_report_rows", { p_from: anterior.from, p_to: anterior.to }).range(de, ate)
  );
  if (!leitura.ok) {
    await registrar({ mes, enviado: false }, `leitura: ${leitura.error.message}`);
    throw new Error("MONTHLY_READ_FAILED");
  }
  const linhas = leitura.linhas.map((l) => ({ ...l, items: Array.isArray(l.items) ? l.items : [] }));
  const faixas = (settings?.waiting_buckets_days as number[] | null) ?? [2, 5, 7];
  const periodo = { de: anterior.from, ate: anterior.to };
  const ind = calcularIndicadores(linhas, periodo, { hoje, faixas });
  const rotuloDoMes = formatIsoMonthBr(anterior.from);

  const bytes = await pdfDoRelatorio({
    titulo: `Relatório das assinaturas digitais — ${rotuloDoMes}`,
    periodo,
    filtros: "toda a rede",
    ind,
    linhas,
    hoje,
    faixas,
    porDocumento: false,
    geradoPor: null,
  });
  const caminho = `_relatorios/${mes}/relatorio-assinaturas-${mes}.pdf`;
  const up = await admin.storage.from(BUCKET).upload(caminho, new Blob([Buffer.from(bytes)], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
  if (up.error) {
    await registrar({ mes, enviado: false }, `pdf: ${up.error.message}`);
    throw new Error("MONTHLY_PDF_FAILED");
  }

  const corpo =
    `Olá!\n\nSegue o relatório das assinaturas digitais de ${rotuloDoMes} (toda a rede).\n\n` +
    `Enviados: ${ind.enviados}\n` +
    `Assinados: ${ind.assinados}${ind.taxaPercent == null ? "" : ` (${ind.taxaPercent.toLocaleString("pt-BR")}% dos enviados no mês)`}\n` +
    `Faltam assinar hoje: ${ind.faltam} (${ind.faltamCliente} esperando o cliente, ${ind.faltamEquipe} esperando a equipe)\n` +
    `Recusados: ${ind.recusados} · Vencidos: ${ind.vencidos} · Cancelados: ${ind.cancelados}\n` +
    `Tempo de resposta do cliente (mediana): ${textoDoTempo(ind.tempoCliente.medianaHoras)}\n\n` +
    `O PDF vai anexo. A planilha e os outros períodos ficam em Assinaturas → Relatórios.\n\nriSZon`;
  const { error: erroDaFila } = await admin.from("signature_outbox").insert(
    destinatarios.map((d) => ({
      kind: "monthly_report",
      to_email: d.email.trim(),
      to_name: d.name ?? null,
      subject: `riSZon — relatório das assinaturas de ${rotuloDoMes}`,
      body_text: corpo,
      attachment_path: caminho,
    }))
  );
  if (erroDaFila) {
    await registrar({ mes, enviado: false }, `fila: ${erroDaFila.message}`);
    throw new Error("MONTHLY_QUEUE_FAILED");
  }
  await registrar({ mes, enviado: true, destinatarios: destinatarios.length, enviados: ind.enviados, assinados: ind.assinados });
  return { mes, destinatarios: destinatarios.length, pdf: true };
}
