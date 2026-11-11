import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BarChart3, FileDown, Sheet } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { formatIsoDateBr, todayInBrazil } from "@/lib/dates";
import { canViewSignatures } from "@/lib/signatures/access";
import { calcularIndicadores } from "@/lib/signatures/indicadores";
import { alcanceDoPainel, lerFiltros, lerLinhasDoPainel, lerOpcoes, urlDoPainel } from "@/lib/signatures/painel-dados";
import { linhasDoRelatorio } from "@/lib/signatures/relatorio";
import { textoDosFiltros } from "@/lib/signatures/relatorio-pedido";
import { createClient } from "@/lib/supabase/server";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { Button } from "@/components/ui/button";
import { Filtros } from "../filtros-do-painel";

export const metadata: Metadata = { title: "Assinaturas — Relatórios" };
export const dynamic = "force-dynamic";

/**
 * OS RELATÓRIOS DAS ASSINATURAS (ZS7): os mesmos filtros do painel e dois
 * botões — PDF (com a identidade da Risarte) e planilha Excel —, por pacote ou
 * por documento. Os arquivos saem das rotas `./pdf` e `./planilha`, que leem
 * a mesma URL; cada download fica na Auditoria.
 */
export default async function RelatoriosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await getSessionContext();
  if (!canViewSignatures(session)) redirect("/");
  const alcance = alcanceDoPainel(session);
  if (!alcance) redirect("/assinaturas");
  const sp = await searchParams;
  const hoje = todayInBrazil();
  const f = lerFiltros(sp, hoje);
  const supabase = await createClient();
  const leitura = await lerLinhasDoPainel(supabase, f, alcance);
  const linhas = leitura.ok ? leitura.linhas : [];
  const opcoes = await lerOpcoes(supabase, session, alcance, linhas);
  const ind = calcularIndicadores(linhas, f.periodo, { hoje, faixas: opcoes.faixas });
  const quantas = linhasDoRelatorio({
    titulo: "",
    periodo: f.periodo,
    filtros: "",
    ind,
    linhas,
    hoje,
    faixas: opcoes.faixas,
    porDocumento: f.porDocumento,
    geradoPor: null,
  }).length;

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Assinaturas digitais"
        icone={BarChart3}
        titulo="Relatórios"
        descricao="O mesmo que o painel mostra, para baixar: os números do período e a lista de cada um (assinados, faltam assinar, recusados, vencidos e cancelados)."
        voltar={{ href: urlDoPainel("/assinaturas", { ...f, lista: null, faixa: null }), rotulo: "Painel" }}
      />

      <Filtros
        f={f}
        opcoes={opcoes}
        alcance={alcance}
        extra={
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Uma linha por</span>
            <select name="por" defaultValue={f.porDocumento ? "documento" : ""} className="rounded-md border bg-background px-2 py-1.5">
              <option value="">Pacote</option>
              <option value="documento">Documento</option>
            </select>
          </label>
        }
      />

      {!leitura.ok ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{leitura.erro}</p>
      ) : (
        <div className="space-y-3 rounded-xl border p-4">
          <p className="text-sm">
            <span className="font-medium">
              {formatIsoDateBr(f.periodo.de)} a {formatIsoDateBr(f.periodo.ate)}
            </span>{" "}
            · {textoDosFiltros(f, opcoes, alcance)}
          </p>
          <p className="text-sm text-muted-foreground">
            {ind.enviados} enviado(s) · {ind.assinados} assinado(s) · {ind.faltam} faltando · {ind.recusados} recusado(s) · {ind.vencidos} vencido(s) ·{" "}
            {ind.cancelados} cancelado(s). O relatório terá {quantas} linha(s) {f.porDocumento ? "(uma por documento)" : "(uma por pacote)"}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button render={<a href={urlDoPainel("/assinaturas/relatorios/pdf", f)} />} nativeButton={false}>
              <FileDown className="size-4" />
              Baixar em PDF
            </Button>
            <Button render={<a href={urlDoPainel("/assinaturas/relatorios/planilha", f)} />} nativeButton={false} variant="outline">
              <Sheet className="size-4" />
              Baixar planilha (Excel)
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Cada download fica registrado na Auditoria. O relatório do mês anterior também chega por e-mail no dia 1º para quem está em
            Assinaturas → Configurações → Relatório mensal.
          </p>
        </div>
      )}
    </div>
  );
}
