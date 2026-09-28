import type { Metadata } from "next";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { indicaDb } from "@/lib/indica/db";
import { ehFranqueadoraIndica, ehGestorIndica } from "@/lib/indica/access";
import { mensagemDoBanco } from "@/lib/indica/erros";
import {
  APURACAO_STATUS_LABEL,
  METRICA_LABEL,
  proximaFaixa,
  type Faixa,
  type Metrica,
} from "@/lib/indica/metas";
import { formatBrDateTime, formatIsoDateBr, monthRangeOf, todayInBrazil } from "@/lib/dates";
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
import { parametroVigente } from "../campanhas/opcoes";
import { AprovarApuracao, BotoesMeta, NovaMetaDialog } from "./formularios";

export const metadata: Metadata = { title: "Equipe — Indica +Risos" };

type Meta = {
  id: string;
  unidade_id: string;
  campanha_id: string | null;
  periodo_tipo: string;
  periodo_inicio: string;
  periodo_fim: string;
  metrica: Metrica;
  faixas: Faixa[];
  trava_qualidade_comparecimento: number | null;
  status: "rascunho" | "ativa" | "encerrada";
};
type Apuracao = {
  id: string;
  meta_id: string;
  tipo: "provisoria" | "final";
  valor_apurado: number;
  faixa_atingida: string | null;
  taxa_comparecimento: number | null;
  comparecimento_ok: boolean | null;
  status: string;
  motivo: string | null;
  criado_em: string;
};
type LinhaRanking = {
  usuario_id: string;
  nome: string;
  pedidos: number;
  registradas: number;
  embaixadores_ativados: number;
  conversoes_origem: number;
  conversoes_fechamento: number;
  taxa_conversao: number | null;
};

const valorDaMetrica = (m: Metrica, v: number) =>
  m === "receita_indicados" ? formatBRL(Number(v)) : String(Number(v)).replace(".", ",");

export default async function EquipePage({ searchParams }: PageProps<"/indica-mais-risos/equipe">) {
  const sp = await searchParams;
  const session = await getSessionContext();
  const franqueadora = ehFranqueadoraIndica(session);
  const supabase = await createClient();
  const { data: todas } = await supabase
    .from("clinics").select("id, name").eq("type", "franchise_unit").eq("is_active", true).order("name")
    .returns<{ id: string; name: string }[]>();
  const ativa = session.activeClinic?.type === "franchise_unit" ? session.activeClinic : null;
  const pedida = typeof sp.unidade === "string" ? sp.unidade : null;
  const unidade =
    (franqueadora && pedida ? (todas ?? []).find((u) => u.id === pedida) : null) ??
    (ativa ? { id: ativa.id, name: ativa.name } : franqueadora ? (todas ?? [])[0] ?? null : null);

  const hoje = todayInBrazil();
  const mes = typeof sp.mes === "string" && /^\d{4}-\d{2}$/.test(sp.mes) ? `${sp.mes}-01` : hoje;
  const { from: mesDe, to: mesAte } = monthRangeOf(mes);

  if (!unidade) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Equipe</h1>
        <p className="mt-2 text-sm text-muted-foreground">Escolha uma unidade no topo para ver as metas da equipe.</p>
      </div>
    );
  }
  const gestor = ehGestorIndica(session, unidade.id);
  const db = await indicaDb();
  const [{ data: metas, error }, ranking, faixasPadrao, travaPadrao, { data: campanhas }] = await Promise.all([
    db.from("metas_equipe")
      .select("id, unidade_id, campanha_id, periodo_tipo, periodo_inicio, periodo_fim, metrica, faixas, trava_qualidade_comparecimento, status")
      .eq("unidade_id", unidade.id)
      .order("periodo_inicio", { ascending: false })
      .returns<Meta[]>(),
    db.rpc("ranking_equipe", { p_unidade_id: unidade.id, p_de: mesDe, p_ate: mesAte }),
    parametroVigente<Faixa[]>("metas_faixas_padrao", unidade.id),
    parametroVigente<number>("metas_trava_qualidade_padrao", unidade.id),
    db.from("campanhas").select("id, nome").in("status", ["ativa", "pausada", "encerrada", "apurada"]).order("inicio", { ascending: false })
      .returns<{ id: string; nome: string }[]>(),
  ]);
  const ids = (metas ?? []).map((m) => m.id);
  const { data: apuracoes } = ids.length
    ? await db.from("apuracoes")
        .select("id, meta_id, tipo, valor_apurado, faixa_atingida, taxa_comparecimento, comparecimento_ok, status, motivo, criado_em")
        .in("meta_id", ids)
        .order("criado_em", { ascending: false })
        .returns<Apuracao[]>()
    : { data: [] as Apuracao[] };
  const nomeCampanha = new Map((campanhas ?? []).map((c) => [c.id, c.nome]));
  const linhasRanking = (ranking.data ?? []) as LinhaRanking[];

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Equipe — {unidade.name}</h1>
          <p className="text-sm text-muted-foreground">
            Meta coletiva da unidade, com trava de qualidade. A provisória mostra o andamento; a final
            sai depois do período e da carência, e o gestor aprova.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {franqueadora && (
            <form className="flex items-center gap-1.5">
              <select name="unidade" defaultValue={unidade.id} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm" aria-label="Unidade">
                {(todas ?? []).map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              <button className="h-8 rounded-lg border px-2 text-sm">Ver</button>
            </form>
          )}
          {gestor && (
            <NovaMetaDialog
              unidadeId={unidade.id}
              unidadeNome={unidade.name}
              faixasPadrao={faixasPadrao ?? []}
              travaPadrao={travaPadrao ?? null}
              mesInicio={monthRangeOf(hoje).from}
              mesFim={monthRangeOf(hoje).to}
              campanhas={campanhas ?? []}
            />
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {mensagemDoBanco(error)}
        </p>
      )}

      {(metas ?? []).length === 0 ? (
        <p className="rounded-xl border px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhuma meta nesta unidade.{gestor ? " Crie a primeira em “Nova meta” — as faixas já vêm com o modelo da rede." : ""}
        </p>
      ) : (
        (metas ?? []).map((m) => {
          const lista = (apuracoes ?? []).filter((a) => a.meta_id === m.id);
          const ultima = lista[0];
          const temFinal = lista.some((a) => a.tipo === "final" && a.status !== "reprovada");
          const prox = ultima ? proximaFaixa(m.faixas, Number(ultima.valor_apurado)) : null;
          return (
            <Card key={m.id}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                <CardTitle className="text-sm">
                  {METRICA_LABEL[m.metrica]} · {formatIsoDateBr(m.periodo_inicio)} a {formatIsoDateBr(m.periodo_fim)}
                  {m.campanha_id ? ` · campanha ${nomeCampanha.get(m.campanha_id) ?? ""}` : ""}
                  <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal">
                    {m.status === "ativa" ? "Ativa" : m.status === "encerrada" ? "Encerrada" : "Rascunho"}
                  </span>
                </CardTitle>
                {gestor && <BotoesMeta id={m.id} podeFinal={hoje > m.periodo_fim && !temFinal} ativa={m.status === "ativa"} />}
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <ul className="flex flex-wrap gap-1.5">
                  {m.faixas.map((f) => (
                    <li key={f.nome} className={`rounded-md border px-2 py-1 text-xs ${ultima?.faixa_atingida === f.nome ? "border-emerald-500 bg-emerald-500/10" : ""}`}>
                      <strong>{f.nome}</strong>: {valorDaMetrica(m.metrica, f.gatilho)} · recepção/CRC{" "}
                      {f.premios.recepcao_crc.tipo === "voucher" ? "voucher " : ""}{formatBRL(f.premios.recepcao_crc.valor_centavos)}
                      {f.premios.recepcao_crc.descricao ? ` (${f.premios.recepcao_crc.descricao})` : ""} · demais{" "}
                      {f.premios.demais.tipo === "voucher" ? "voucher " : ""}{formatBRL(f.premios.demais.valor_centavos)}
                      {f.premios.demais.descricao ? ` (${f.premios.demais.descricao})` : ""}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Trava de qualidade:{" "}
                  {m.trava_qualidade_comparecimento === null ? "sem trava" : `comparecimento ≥ ${String(m.trava_qualidade_comparecimento).replace(".", ",")}%`}
                </p>
                {ultima && (
                  <p>
                    Última apuração: <strong>{valorDaMetrica(m.metrica, ultima.valor_apurado)}</strong>
                    {ultima.faixa_atingida ? ` — faixa ${ultima.faixa_atingida}` : " — nenhuma faixa"}
                    {ultima.comparecimento_ok === false ? " (trava de qualidade não atingida)" : ""}
                    {prox ? ` · faltam ${valorDaMetrica(m.metrica, prox.falta)} para ${prox.faixa.nome}` : ""}
                  </p>
                )}
                {lista.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Quando</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead className="text-right">Apurado</TableHead>
                          <TableHead className="text-right">Comparec.</TableHead>
                          <TableHead>Faixa</TableHead>
                          <TableHead>Situação</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lista.map((a) => (
                          <TableRow key={a.id}>
                            <TableCell className="text-xs whitespace-nowrap">{formatBrDateTime(a.criado_em)}</TableCell>
                            <TableCell className="text-xs">{a.tipo === "final" ? "Final" : "Provisória"}</TableCell>
                            <TableCell className="text-right">{valorDaMetrica(m.metrica, a.valor_apurado)}</TableCell>
                            <TableCell className={`text-right ${a.comparecimento_ok === false ? "text-destructive" : ""}`}>
                              {a.taxa_comparecimento === null ? "—" : `${String(a.taxa_comparecimento).replace(".", ",")}%`}
                            </TableCell>
                            <TableCell className="text-xs">{a.faixa_atingida ?? "—"}</TableCell>
                            <TableCell className="text-xs">
                              {a.tipo === "final" ? APURACAO_STATUS_LABEL[a.status] ?? a.status : "—"}
                              {a.motivo ? <span className="block text-muted-foreground">{a.motivo}</span> : null}
                            </TableCell>
                            <TableCell className="text-right">
                              {a.tipo === "final" && a.status === "aguardando_aprovacao" && gestor && <AprovarApuracao id={a.id} />}
                              {a.tipo === "final" && (a.status === "aprovada" || a.status === "paga") && (
                                <Link href={`/indica-mais-risos/equipe/apuracao/${a.id}`} className="text-xs font-medium text-primary hover:underline">
                                  Relatório para a folha
                                </Link>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">Ranking individual — {formatIsoDateBr(mesDe)} a {formatIsoDateBr(mesAte)}</CardTitle>
          <form className="flex items-center gap-1.5">
            {franqueadora && <input type="hidden" name="unidade" value={unidade.id} />}
            <input type="month" name="mes" defaultValue={mes.slice(0, 7)} aria-label="Mês" className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm" />
            <button className="h-8 rounded-lg border px-2 text-sm">Ver</button>
          </form>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {ranking.error ? (
            <p className="px-4 py-3 text-sm text-destructive">{mensagemDoBanco(ranking.error)}</p>
          ) : linhasRanking.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Ninguém da equipe indicou neste mês ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Pessoa</TableHead>
                  <TableHead className="text-right">Pedidos</TableHead>
                  <TableHead className="text-right">Indicações</TableHead>
                  <TableHead className="text-right">Embaixadores ativados</TableHead>
                  <TableHead className="text-right">Conversões (origem)</TableHead>
                  <TableHead className="text-right">Conversões (fechamento)</TableHead>
                  <TableHead className="text-right">Taxa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhasRanking.map((r, i) => (
                  <TableRow key={r.usuario_id}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell className="font-medium">{r.nome || "—"}</TableCell>
                    <TableCell className="text-right">{r.pedidos}</TableCell>
                    <TableCell className="text-right">{r.registradas}</TableCell>
                    <TableCell className="text-right">{r.embaixadores_ativados}</TableCell>
                    <TableCell className="text-right">{r.conversoes_origem}</TableCell>
                    <TableCell className="text-right">{r.conversoes_fechamento}</TableCell>
                    <TableCell className="text-right">{r.taxa_conversao === null ? "—" : `${String(r.taxa_conversao).replace(".", ",")}%`}</TableCell>
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
