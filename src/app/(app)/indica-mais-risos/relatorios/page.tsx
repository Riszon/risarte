import type { Metadata } from "next";
import { Download } from "lucide-react";
import { indicaDb } from "@/lib/indica/db";
import { mensagemDoBanco } from "@/lib/indica/erros";
import { retornoPct, type Indicadores } from "@/lib/indica/painel";
import { formatIsoDateBr, formatIsoMonthBr } from "@/lib/dates";
import { formatBRL } from "@/lib/pricing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FiltrosRecorte } from "../filtros-recorte";
import { lerRecorte, paramsDoRecorte } from "../recorte";

export const metadata: Metadata = { title: "Relatórios — Indica +Risos" };

type LinhaRoi = Indicadores & { grupo_id: string; grupo: string };
type Coorte = {
  mes: string;
  registradas: number;
  compareceram: number;
  fecharam: number;
  convertidas: number;
  perdidas: number;
  em_andamento: number;
  receita_centavos: number;
  taxa_conversao: number | null;
};

const reais = (c: number | null | undefined) => (c === null || c === undefined ? "—" : formatBRL(c));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${String(n).replace(".", ",")}%`);

function LinkCsv({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-muted">
      <Download className="size-3.5" /> {children}
    </a>
  );
}

function LinhaTabela({ l, destaque }: { l: Indicadores & { grupo: string }; destaque?: boolean }) {
  return (
    <TableRow className={destaque ? "bg-muted/50 font-medium" : ""}>
      <TableCell>{l.grupo}</TableCell>
      <TableCell className="text-right">{l.registradas}</TableCell>
      <TableCell className="text-right">{pct(l.taxa_comparecimento)}</TableCell>
      <TableCell className="text-right">{l.conversoes}</TableCell>
      <TableCell className="text-right whitespace-nowrap">{reais(l.receita_centavos)}</TableCell>
      <TableCell className="text-right whitespace-nowrap">{reais(l.custo_gerado_centavos)}</TableCell>
      <TableCell className="text-right whitespace-nowrap">{reais(l.custo_realizado_centavos)}</TableCell>
      <TableCell className="text-right whitespace-nowrap">{reais(l.cac_gerado_centavos)}</TableCell>
      <TableCell className="text-right whitespace-nowrap">{reais(l.cac_realizado_centavos)}</TableCell>
      <TableCell className="text-right">{retornoPct(l.roi_gerado)}</TableCell>
      <TableCell className="text-right">{retornoPct(l.roi_realizado)}</TableCell>
    </TableRow>
  );
}

export default async function RelatoriosPage({ searchParams }: PageProps<"/indica-mais-risos/relatorios">) {
  const sp = await searchParams;
  const r = await lerRecorte(sp);
  if (r.semAcesso) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
        <p className="mt-2 text-sm text-muted-foreground">Você não está em nenhuma unidade.</p>
      </div>
    );
  }
  const agrupar = sp.agrupar === "campanha" ? "campanha" : "unidade";
  const db = await indicaDb();
  const [roi, coortes] = await Promise.all([
    db.rpc("relatorio_roi", { p_de: r.de, p_ate: r.ate, p_agrupar: agrupar, p_unidade: r.unidadeId }),
    db.rpc("coortes", { p_de: r.de, p_ate: r.ate, p_unidade: r.unidadeId }),
  ]);
  const dadosRoi = roi.data as { linhas: LinhaRoi[]; total: Indicadores } | null;
  const dadosCoortes = (coortes.data ?? []) as Coorte[];
  const base = "/indica-mais-risos/relatorios/csv";

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
        <p className="text-sm text-muted-foreground">
          {r.unidadeNome} · {formatIsoDateBr(r.de)} a {formatIsoDateBr(r.ate)}. As planilhas saem sem telefone, CPF ou e-mail
          dos indicados.
        </p>
      </div>

      <FiltrosRecorte
        r={r}
        extra={
          <label className="grid gap-1 text-xs text-muted-foreground">
            Agrupar por
            <select name="agrupar" defaultValue={agrupar} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm">
              <option value="unidade">Unidade</option>
              <option value="campanha">Campanha</option>
            </select>
          </label>
        }
      />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">Retorno e custo por {agrupar === "campanha" ? "campanha" : "unidade"}</CardTitle>
          <LinkCsv href={`${base}?${paramsDoRecorte(r, { tipo: "roi", agrupar })}`}>Planilha</LinkCsv>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {roi.error || !dadosRoi ? (
            <p className="px-4 py-3 text-sm text-destructive">{roi.error ? mensagemDoBanco(roi.error) : "Relatório indisponível."}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{agrupar === "campanha" ? "Campanha" : "Unidade"}</TableHead>
                  <TableHead className="text-right">Indicações</TableHead>
                  <TableHead className="text-right">Comparec.</TableHead>
                  <TableHead className="text-right">Conversões</TableHead>
                  <TableHead className="text-right">Receita</TableHead>
                  <TableHead className="text-right">Custo gerado</TableHead>
                  <TableHead className="text-right">Custo realizado</TableHead>
                  <TableHead className="text-right">CAC gerado</TableHead>
                  <TableHead className="text-right">CAC realizado</TableHead>
                  <TableHead className="text-right">Retorno (gerado)</TableHead>
                  <TableHead className="text-right">Retorno (realizado)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dadosRoi.linhas.map((l) => (
                  <LinhaTabela key={l.grupo_id} l={l} />
                ))}
                <LinhaTabela l={{ ...dadosRoi.total, grupo: "Total" }} destaque />
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Por campanha, o custo realizado não se aplica (o resgate não pertence a uma campanha). Retorno = (receita − custo) ÷ custo,
        sobre a receita das vendas, não sobre a margem.
      </p>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">Coortes: das indicações de cada mês, até onde chegaram</CardTitle>
          <div className="flex gap-2">
            <LinkCsv href={`${base}?${paramsDoRecorte(r, { tipo: "coortes" })}`}>Planilha</LinkCsv>
            <LinkCsv href={`${base}?${paramsDoRecorte(r, { tipo: "indicacoes" })}`}>Indicações do período</LinkCsv>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {coortes.error ? (
            <p className="px-4 py-3 text-sm text-destructive">{mensagemDoBanco(coortes.error)}</p>
          ) : dadosCoortes.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma indicação registrada no período.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês do registro</TableHead>
                  <TableHead className="text-right">Registradas</TableHead>
                  <TableHead className="text-right">Compareceram</TableHead>
                  <TableHead className="text-right">Fecharam</TableHead>
                  <TableHead className="text-right">Convertidas</TableHead>
                  <TableHead className="text-right">Perdidas</TableHead>
                  <TableHead className="text-right">Em andamento</TableHead>
                  <TableHead className="text-right">Conversão</TableHead>
                  <TableHead className="text-right">Receita</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dadosCoortes.map((c) => (
                  <TableRow key={c.mes}>
                    <TableCell className="capitalize">{formatIsoMonthBr(`${c.mes}-01`)}</TableCell>
                    <TableCell className="text-right">{c.registradas}</TableCell>
                    <TableCell className="text-right">{c.compareceram}</TableCell>
                    <TableCell className="text-right">{c.fecharam}</TableCell>
                    <TableCell className="text-right">{c.convertidas}</TableCell>
                    <TableCell className="text-right">{c.perdidas}</TableCell>
                    <TableCell className="text-right">{c.em_andamento}</TableCell>
                    <TableCell className="text-right">{pct(c.taxa_conversao)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{reais(c.receita_centavos)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
