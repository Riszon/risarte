import type { Metadata } from "next";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { indicaDb } from "@/lib/indica/db";
import { mensagemDoBanco } from "@/lib/indica/erros";
import { EMBAIXADOR_STATUS_LABEL, type EmbaixadorStatus } from "@/lib/indica/rotulos";
import { haQuantoTempo } from "@/lib/indica/formato";
import { formatBrDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FilterForm } from "@/components/filter-form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = { title: "Embaixadores — Indica +Risos" };

type Linha = {
  id: string;
  codigo: string;
  status: EmbaixadorStatus;
  nome: string;
  codigo_cliente: string | null;
  clinic_id: string;
  nivel_nome: string;
  disponivel: number;
  pendente: number;
  em_carencia: number;
  a_vencer_30_dias: number;
  indicacoes: number;
  conversoes_12_meses: number;
  ultima_atividade: string | null;
};

const ORDENS = {
  conversoes: { coluna: "conversoes_12_meses", rotulo: "Mais conversões" },
  saldo: { coluna: "disponivel", rotulo: "Maior saldo" },
  indicacoes: { coluna: "indicacoes", rotulo: "Mais indicações" },
  nome: { coluna: "nome", rotulo: "Nome" },
} as const;
type Ordem = keyof typeof ORDENS;

export default async function EmbaixadoresPage(props: PageProps<"/indica-mais-risos/embaixadores">) {
  const session = await getSessionContext();
  const sp = await props.searchParams;
  const texto = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const busca = texto("q").trim();
  const status = (["ativo", "suspenso", "encerrado"] as const).find((s) => s === texto("situacao")) ?? "";
  const ordem: Ordem = (Object.keys(ORDENS) as Ordem[]).find((o) => o === texto("ordem")) ?? "conversoes";

  const ativa = session.activeClinic;
  const naRede = !ativa || ativa.type === "franchisor";

  const db = await indicaDb();
  let consulta = db
    .from("v_embaixadores")
    .select(
      "id, codigo, status, nome, codigo_cliente, clinic_id, nivel_nome, disponivel, pendente, em_carencia, a_vencer_30_dias, indicacoes, conversoes_12_meses, ultima_atividade"
    )
    .order(ORDENS[ordem].coluna, { ascending: ordem === "nome" })
    .limit(300);
  if (!naRede && ativa) consulta = consulta.eq("clinic_id", ativa.id);
  if (status) consulta = consulta.eq("status", status);
  if (busca) {
    const limpo = busca.replace(/[%,()]/g, " ").trim();
    consulta = consulta.or(`nome.ilike.%${limpo}%,codigo.ilike.%${limpo}%`);
  }
  const { data, error } = await consulta.returns<Linha[]>();
  const linhas = data ?? [];
  const agora = new Date();

  // "Quem pedir hoje": fechou tratamento nos últimos 30 dias na unidade e ainda
  // não é Embaixador — o momento em que o pedido mais funciona (diretrizes).
  let quemPedir: { id: string; nome: string; fechouEm: string }[] = [];
  if (!naRede && ativa) {
    const supabase = await createClient();
    const desde = new Date(agora.getTime() - 30 * 86_400_000).toISOString();
    const { data: vendas } = await supabase
      .from("commercial_sales")
      .select("client_id, closed_at, clients!commercial_sales_client_id_fkey ( full_name )")
      .eq("clinic_id", ativa.id)
      .gte("closed_at", desde)
      .is("cancelled_at", null)
      .order("closed_at", { ascending: false })
      .limit(60)
      .returns<{ client_id: string; closed_at: string; clients: { full_name: string } | null }[]>();
    const ids = [...new Set((vendas ?? []).map((v) => v.client_id))];
    if (ids.length > 0) {
      const { data: jaSao } = await db
        .from("embaixadores")
        .select("cliente_id")
        .in("cliente_id", ids)
        .returns<{ cliente_id: string }[]>();
      const sao = new Set((jaSao ?? []).map((e) => e.cliente_id));
      const vistos = new Set<string>();
      quemPedir = (vendas ?? [])
        .filter((v) => !sao.has(v.client_id) && !vistos.has(v.client_id) && vistos.add(v.client_id))
        .slice(0, 12)
        .map((v) => ({ id: v.client_id, nome: v.clients?.full_name ?? "—", fechouEm: v.closed_at }));
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Embaixadores</h1>
        <p className="text-sm text-muted-foreground">
          {naRede ? "Visão da rede" : ativa?.name} · {linhas.length} Embaixador(es). O saldo é sempre
          a soma do extrato.
        </p>
      </div>

      {!naRede && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Quem pedir hoje</CardTitle>
          </CardHeader>
          <CardContent>
            {quemPedir.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ninguém fechou tratamento nos últimos 30 dias sem já ser Embaixador.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {quemPedir.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/prontuarios/${c.id}`}
                      className="inline-flex flex-col rounded-lg border px-3 py-1.5 text-sm hover:border-primary/40"
                    >
                      <span className="font-medium">{c.nome}</span>
                      <span className="text-xs text-muted-foreground">fechou em {formatBrDate(c.fechouEm)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Quem acabou de fechar é quem mais indica. Abra a ficha e use “Pedi indicação” /
              “Nova indicação”.
            </p>
          </CardContent>
        </Card>
      )}

      <FilterForm className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
        <select name="ordem" defaultValue={ordem} className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm">
          {(Object.keys(ORDENS) as Ordem[]).map((o) => (
            <option key={o} value={o}>
              {ORDENS[o].rotulo}
            </option>
          ))}
        </select>
        <select name="situacao" defaultValue={status} className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm">
          <option value="">Todas as situações</option>
          {(["ativo", "suspenso", "encerrado"] as const).map((s) => (
            <option key={s} value={s}>
              {EMBAIXADOR_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <input
          name="q"
          defaultValue={busca}
          placeholder="Nome ou código pessoal — Enter"
          className="h-8 min-w-56 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        />
      </FilterForm>

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {mensagemDoBanco(error)}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Embaixador</TableHead>
                <TableHead>Nível</TableHead>
                <TableHead className="text-right">Disponível</TableHead>
                <TableHead className="text-right">Pendente</TableHead>
                <TableHead className="text-right">Carência</TableHead>
                <TableHead className="text-right">Indicações</TableHead>
                <TableHead className="text-right">Conversões 12m</TableHead>
                <TableHead>Última atividade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l, i) => (
                <TableRow key={l.id}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    <Link href={`/indica-mais-risos/embaixadores/${l.id}`} className="font-medium hover:underline">
                      {l.nome}
                    </Link>
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">{l.codigo}</span>
                    {l.status !== "ativo" && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        {EMBAIXADOR_STATUS_LABEL[l.status]}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="rounded-full bg-gold px-2 py-0.5 text-[11px] text-gold-foreground">{l.nivel_nome}</span>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {l.disponivel}
                    {l.a_vencer_30_dias > 0 && (
                      <span className="block text-[10px] font-normal text-amber-700 dark:text-amber-300">
                        {l.a_vencer_30_dias} vencem em 30 dias
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{l.pendente}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{l.em_carencia}</TableCell>
                  <TableCell className="text-right">{l.indicacoes}</TableCell>
                  <TableCell className={cn("text-right", l.conversoes_12_meses > 0 && "font-medium")}>
                    {l.conversoes_12_meses}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {l.ultima_atividade ? haQuantoTempo(l.ultima_atividade, agora) : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {linhas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    Nenhum Embaixador ainda. Ele nasce na janela “Nova indicação”, com o aceite do
                    regulamento.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
