import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { indicaDb } from "@/lib/indica/db";
import { canViewIndica } from "@/lib/indica/access";
import { mensagemDoBanco } from "@/lib/indica/erros";
import { numeroCsv, paraCsv, reaisCsv, type Indicadores } from "@/lib/indica/painel";
import { INDICACAO_STATUS_LABEL, type IndicacaoStatus } from "@/lib/indica/status";
import { addDaysIso, formatBrDateTime, startOfDayInBrazil } from "@/lib/dates";
import { lerRecorte } from "../../recorte";

/**
 * Planilhas (CSV) do Indica +Risos. Decisão do dono (28/09/2026): NADA de
 * contato do indicado (telefone, CPF, e-mail) — a planilha circula por
 * e-mail e WhatsApp. A leitura passa pela RLS de quem pediu, e cada
 * exportação fica na auditoria.
 */
export async function GET(request: Request) {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return new NextResponse("Sem permissão.", { status: 403 });
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const r = await lerRecorte(sp);
  if (r.semAcesso) return new NextResponse("Sem unidade.", { status: 403 });
  const tipo = sp.tipo;
  const pctCsv = (roi: number | null) => (roi === null ? "" : String(Math.round(roi * 100)));
  const db = await indicaDb();
  let csv: string;

  if (tipo === "roi") {
    const agrupar = sp.agrupar === "campanha" ? "campanha" : "unidade";
    const { data, error } = await db.rpc("relatorio_roi", { p_de: r.de, p_ate: r.ate, p_agrupar: agrupar, p_unidade: r.unidadeId });
    if (error || !data) return new NextResponse(error ? mensagemDoBanco(error) : "Indisponível.", { status: 400 });
    const d = data as { linhas: (Indicadores & { grupo: string })[]; total: Indicadores };
    const linha = (l: Indicadores, grupo: string) => [
      grupo, l.registradas, l.compareceram, l.fecharam, l.conversoes, reaisCsv(l.receita_centavos),
      l.riso_coins_gerados, reaisCsv(l.premios_equipe_centavos), reaisCsv(l.custo_gerado_centavos),
      reaisCsv(l.custo_realizado_centavos), reaisCsv(l.cac_gerado_centavos), reaisCsv(l.cac_realizado_centavos),
      pctCsv(l.roi_gerado), pctCsv(l.roi_realizado),
    ];
    csv = paraCsv(
      [agrupar === "campanha" ? "Campanha" : "Unidade", "Indicações", "Compareceram", "Fecharam", "Conversões",
       "Receita (R$)", "Riso Coins gerados", "Prêmios equipe (R$)", "Custo gerado (R$)", "Custo realizado (R$)",
       "CAC gerado (R$)", "CAC realizado (R$)", "Retorno gerado (%)", "Retorno realizado (%)"],
      [...d.linhas.map((l) => linha(l, l.grupo)), linha(d.total, "Total")]
    );
  } else if (tipo === "coortes") {
    const { data, error } = await db.rpc("coortes", { p_de: r.de, p_ate: r.ate, p_unidade: r.unidadeId });
    if (error) return new NextResponse(mensagemDoBanco(error), { status: 400 });
    const linhas = (data ?? []) as Record<string, number | string | null>[];
    csv = paraCsv(
      ["Mês do registro", "Registradas", "Compareceram", "Fecharam", "Convertidas", "Perdidas", "Em andamento", "Conversão (%)", "Receita (R$)"],
      linhas.map((c) => [c.mes, c.registradas, c.compareceram, c.fecharam, c.convertidas, c.perdidas, c.em_andamento,
        numeroCsv(c.taxa_conversao as number | null), reaisCsv(c.receita_centavos as number)])
    );
  } else if (tipo === "indicacoes") {
    let consulta = db
      .from("indicacoes")
      // Sem indicado_nome, telefone, CPF e e-mail — de propósito.
      .select("codigo, status, canal, unidade_id, campanha_id, embaixador_id, registrada_em, compareceu_em, fechou_em, convertida_em, valor_fechado_centavos")
      .gte("registrada_em", startOfDayInBrazil(r.de).toISOString())
      .lt("registrada_em", startOfDayInBrazil(addDaysIso(r.ate, 1)).toISOString())
      .order("registrada_em")
      .limit(10000);
    if (r.unidadeId) consulta = consulta.eq("unidade_id", r.unidadeId);
    if (r.campanhaId) consulta = consulta.eq("campanha_id", r.campanhaId);
    const [{ data, error }, { data: camps }, { data: embs }] = await Promise.all([
      consulta.returns<{
        codigo: string; status: string; canal: string; unidade_id: string; campanha_id: string | null;
        embaixador_id: string | null; registrada_em: string; compareceu_em: string | null; fechou_em: string | null;
        convertida_em: string | null; valor_fechado_centavos: number | null;
      }[]>(),
      db.from("campanhas").select("id, nome").returns<{ id: string; nome: string }[]>(),
      db.from("embaixadores").select("id, codigo").returns<{ id: string; codigo: string }[]>(),
    ]);
    if (error) return new NextResponse(mensagemDoBanco(error), { status: 400 });
    const unidade = new Map(r.unidades.map((u) => [u.id, u.nome]));
    const campanha = new Map((camps ?? []).map((c) => [c.id, c.nome]));
    const embaixador = new Map((embs ?? []).map((e) => [e.id, e.codigo]));
    const quando = (s: string | null) => (s ? formatBrDateTime(s) : "");
    csv = paraCsv(
      ["Código", "Situação", "Canal", "Unidade", "Campanha", "Embaixador (código)", "Registrada em", "Compareceu em",
       "Fechou em", "Convertida em", "Valor fechado (R$)"],
      (data ?? []).map((i) => [
        i.codigo, INDICACAO_STATUS_LABEL[i.status as IndicacaoStatus] ?? i.status, i.canal,
        unidade.get(i.unidade_id) ?? "", i.campanha_id ? campanha.get(i.campanha_id) ?? "" : "",
        i.embaixador_id ? embaixador.get(i.embaixador_id) ?? "" : "", quando(i.registrada_em), quando(i.compareceu_em),
        quando(i.fechou_em), quando(i.convertida_em), reaisCsv(i.valor_fechado_centavos),
      ])
    );
  } else {
    return new NextResponse("Tipo de planilha inválido.", { status: 400 });
  }

  await logAudit({
    action: "export",
    entityType: "indica_relatorio",
    clinicId: r.unidadeId ?? undefined,
    details: { tipo, de: r.de, ate: r.ate },
  });
  const nome = `indica-${tipo}-${r.de}-a-${r.ate}.csv`;
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${nome}"`,
      "cache-control": "no-store",
    },
  });
}
