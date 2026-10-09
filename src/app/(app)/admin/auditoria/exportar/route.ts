import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { relatorioDeAtividade } from "@/lib/auditoria-relatorio";
import { formatBrDateTime } from "@/lib/dates";
import { planilhaDoRelatorio } from "@/lib/finance/relatorio-xlsx";
import { carregarRelatorioDeAtividade } from "../relatorio-dados";

/**
 * A PLANILHA DO RELATÓRIO DE ATIVIDADE (0289) — gerada no servidor, sob
 * demanda, com o mesmo gerador que o Financeiro usa.
 *
 * ⚠️ Os dados vêm do MESMO carregador da aba Relatório: o que a planilha traz
 * é o que a tela mostrava, com o mesmo filtro.
 *
 * ⚠️ EXPORTAR É UMA AÇÃO, E FICA REGISTRADA. O relatório sai do sistema — é o
 * único momento em que o que está na Auditoria vira arquivo. Por isso a tela
 * chama esta rota por um link comum (`<a>`), nunca por `<Link>`: o Next
 * pré-carregaria a rota e registraria exportações que ninguém pediu.
 */
export async function GET(request: Request) {
  // Só o Admin Master passa daqui (quem não é, é mandado embora).
  const carga = await carregarRelatorioDeAtividade(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!carga.linhas) {
    return new NextResponse(
      "O relatório de atividade ainda não existe neste banco (falta rodar a migração 0289).",
      { status: 503 }
    );
  }

  const relatorio = relatorioDeAtividade({
    linhas: carga.linhas,
    modo: carga.modo,
    periodo: carga.periodo,
    quem: carga.quem,
    filtroPessoa: carga.colaborador
      ? carga.quem.nomes.get(carga.colaborador) ?? null
      : null,
    semAcesso: carga.semAcesso,
    geradoPor: carga.geradoPor,
    geradoEm: formatBrDateTime(new Date()),
  });

  await logAudit({
    action: "export",
    entityType: "audit_activity_report",
    entityId: carga.colaborador || undefined,
    details: { de: carga.periodo.de, ate: carga.periodo.ate, modo: carga.modo },
  });

  const buffer = await planilhaDoRelatorio(relatorio);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${relatorio.nomeDoArquivo}.xlsx"`,
      // Retrato de um instante: guardar em cache entregaria números velhos.
      "cache-control": "no-store",
    },
  });
}
