import "server-only";

import type { SessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { todayInBrazil } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { calcularIndicadores } from "./indicadores";
import { alcanceDoPainel, lerFiltros, lerLinhasDoPainel, lerOpcoes, type FiltrosDoPainel, type OpcoesDosFiltros } from "./painel-dados";
import type { DadosDoRelatorio } from "./relatorio";

/**
 * O PEDIDO DE RELATÓRIO (ZS7): os filtros da URL viram os dados do PDF e da
 * planilha — a mesma leitura e a mesma conta do painel, com a guarda de quem
 * pode ver o painel e o registro na Auditoria (só ids e filtros, sem dado
 * pessoal).
 */

export function textoDosFiltros(f: FiltrosDoPainel, o: OpcoesDosFiltros, alcance: "rede" | "unidade"): string {
  const partes = [
    f.clinicId ? (o.unidades.find((u) => u.id === f.clinicId)?.nome ?? "uma unidade") : alcance === "rede" ? "toda a rede" : "as suas unidades",
    f.audience === "patient" ? "pacientes" : f.audience === "company" ? "empresas" : "pacientes e empresas",
  ];
  if (f.templateId) partes.push(`documento: ${o.modelos.find((m) => m.id === f.templateId)?.nome ?? "um modelo"}`);
  if (f.sentBy) partes.push(`enviados por ${o.remetentes.find((r) => r.id === f.sentBy)?.nome ?? "uma pessoa"}`);
  return partes.join(" · ");
}

export async function montarRelatorio(
  session: SessionContext,
  sp: Record<string, string | undefined>,
  formato: "pdf" | "planilha"
): Promise<{ ok: true; dados: DadosDoRelatorio } | { ok: false; status: number; erro: string }> {
  const alcance = alcanceDoPainel(session);
  if (!alcance) return { ok: false, status: 403, erro: "Sem permissão para os relatórios das assinaturas." };
  const hoje = todayInBrazil();
  const f = lerFiltros(sp, hoje);
  const supabase = await createClient();
  const leitura = await lerLinhasDoPainel(supabase, f);
  if (!leitura.ok) return { ok: false, status: 503, erro: leitura.erro };
  const opcoes = await lerOpcoes(supabase, session, alcance, leitura.linhas);
  const ind = calcularIndicadores(leitura.linhas, f.periodo, { hoje, faixas: opcoes.faixas });
  await logAudit({
    action: "export",
    entityType: "signature_report",
    details: { formato, de: f.periodo.de, ate: f.periodo.ate, unidade: f.clinicId, publico: f.audience, modelo: f.templateId, por: f.porDocumento ? "documento" : "pacote" },
  });
  return {
    ok: true,
    dados: {
      titulo: "Relatório das assinaturas digitais",
      periodo: f.periodo,
      filtros: textoDosFiltros(f, opcoes, alcance),
      ind,
      linhas: leitura.linhas,
      hoje,
      faixas: opcoes.faixas,
      porDocumento: f.porDocumento,
      geradoPor: session.fullName,
    },
  };
}

export function nomeDoArquivo(dados: DadosDoRelatorio, extensao: "pdf" | "xlsx"): string {
  return `assinaturas-${dados.periodo.de}-a-${dados.periodo.ate}${dados.porDocumento ? "-por-documento" : ""}.${extensao}`;
}
