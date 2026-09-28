import type { Metadata } from "next";
import Link from "next/link";
import { Clock, LayoutGrid, List } from "lucide-react";
import { getSessionContext, hasRoleInClinic, type SessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { indicaDb } from "@/lib/indica/db";
import { mensagemDoBanco } from "@/lib/indica/erros";
import { diasDesde, haQuantoTempo } from "@/lib/indica/formato";
import {
  COLUNAS_KANBAN,
  INDICACAO_STATUS,
  INDICACAO_STATUS_LABEL,
  STATUS_COR,
  type IndicacaoStatus,
} from "@/lib/indica/status";
import { formatBrDate, startOfDayInBrazil, addDaysIso } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterForm } from "@/components/filter-form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "../status-badge";
import { AcoesIndicacao } from "../acoes-indicacao";
import { NovaIndicacaoDialog } from "../nova-indicacao-dialog";
import { nomesDePessoas, regulamentoVigente, unidadesParaIndicar } from "../dados";

export const metadata: Metadata = { title: "Indicações — Indica +Risos" };

type Linha = {
  id: string;
  codigo: string;
  status: IndicacaoStatus;
  unidade_id: string;
  embaixador_rotulo: string | null;
  parceiro_nome: string | null;
  indicado_nome: string;
  cliente_indicado_id: string | null;
  risartano_origem_id: string | null;
  registrada_em: string;
  atualizado_em: string;
  trava_ate: string;
  trava_vencida: boolean;
};

/** "Parada há mais de 3 dias sem contato" (diretriz, Ações do dia). */
const DIAS_PARADA = 3;

function podeCancelarNa(session: SessionContext, unidadeId: string): boolean {
  return (
    session.isAdminMaster ||
    hasRoleInClinic(session, unidadeId, ["unit_manager", "franchisee"]) ||
    Object.values(session.rolesByClinic).some((r) => r.includes("franchisor_staff"))
  );
}

export default async function IndicacoesPage(props: PageProps<"/indica-mais-risos/indicacoes">) {
  const session = await getSessionContext();
  const sp = await props.searchParams;
  const texto = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

  const ver = texto("ver") === "lista" ? "lista" : "kanban";
  const etapa = INDICACAO_STATUS.includes(texto("etapa") as IndicacaoStatus)
    ? (texto("etapa") as IndicacaoStatus)
    : "";
  const busca = texto("q").trim();
  const de = /^\d{4}-\d{2}-\d{2}$/.test(texto("de")) ? texto("de") : "";
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(texto("ate")) ? texto("ate") : "";
  const unidadeFiltro = texto("unidade");

  const ativa = session.activeClinic;
  const naRede = !ativa || ativa.type === "franchisor";

  const db = await indicaDb();
  let consulta = db
    .from("v_indicacoes")
    .select(
      "id, codigo, status, unidade_id, embaixador_rotulo, parceiro_nome, indicado_nome, cliente_indicado_id, risartano_origem_id, registrada_em, atualizado_em, trava_ate, trava_vencida"
    )
    .order("registrada_em", { ascending: false })
    .limit(500);

  if (!naRede && ativa) consulta = consulta.eq("unidade_id", ativa.id);
  else if (unidadeFiltro) consulta = consulta.eq("unidade_id", unidadeFiltro);
  if (etapa) consulta = consulta.eq("status", etapa);
  if (busca) {
    const limpo = busca.replace(/[%,()]/g, " ").trim();
    consulta = consulta.or(`codigo.ilike.%${limpo}%,indicado_nome.ilike.%${limpo}%`);
  }
  if (de) consulta = consulta.gte("registrada_em", startOfDayInBrazil(de).toISOString());
  if (ate) consulta = consulta.lt("registrada_em", startOfDayInBrazil(addDaysIso(ate, 1)).toISOString());
  // No kanban, encerradas saem (moram na lista); a coluna "Convertida" mostra
  // só o último mês, para não virar arquivo morto.
  if (ver === "kanban" && !etapa) {
    consulta = consulta.not("status", "in", "(recusada,cancelada,expirada)");
  }

  const supabase = await createClient();
  const [{ data, error }, unidades, regulamento, { data: nomesUnidades }] = await Promise.all([
    consulta.returns<Linha[]>(),
    unidadesParaIndicar(session),
    regulamentoVigente(),
    supabase
      .from("clinics")
      .select("id, name")
      .eq("type", "franchise_unit")
      .order("name")
      .returns<{ id: string; name: string }[]>(),
  ]);

  const agora = new Date();
  const linhas = (data ?? []).filter(
    (l) => !(ver === "kanban" && l.status === "convertida" && diasDesde(l.atualizado_em, agora) > 30)
  );
  const pessoas = await nomesDePessoas(linhas.map((l) => l.risartano_origem_id));
  const nomeUnidade = new Map((nomesUnidades ?? []).map((u) => [u.id, u.name]));

  const alternar = (para: "kanban" | "lista") => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "ver") q.set(k, v);
    if (para === "lista") q.set("ver", "lista");
    const s = q.toString();
    return s ? `?${s}` : "?";
  };

  return (
    <div className="space-y-4 px-4 py-8">
      <div className="mx-auto flex max-w-7xl flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Indicações</h1>
          <p className="text-sm text-muted-foreground">
            Indica +Risos · {naRede ? "visão da rede" : ativa?.name} · {linhas.length} indicação(ões)
            {ver === "kanban" ? " em andamento" : ""}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border p-0.5">
            <Button
              size="sm"
              variant={ver === "kanban" ? "secondary" : "ghost"}
              className="h-7"
              nativeButton={false}
              render={<Link href={alternar("kanban")} />}
            >
              <LayoutGrid className="mr-1 size-3.5" /> Quadro
            </Button>
            <Button
              size="sm"
              variant={ver === "lista" ? "secondary" : "ghost"}
              className="h-7"
              nativeButton={false}
              render={<Link href={alternar("lista")} />}
            >
              <List className="mr-1 size-3.5" /> Lista
            </Button>
          </div>
          <NovaIndicacaoDialog unidades={unidades} regulamento={regulamento} />
        </div>
      </div>

      <FilterForm className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
        {ver === "lista" && <input type="hidden" name="ver" value="lista" />}
        {naRede && (
          <select
            name="unidade"
            defaultValue={unidadeFiltro}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            <option value="">Todas as unidades</option>
            {(nomesUnidades ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
        <select
          name="etapa"
          defaultValue={etapa}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">Todas as etapas</option>
          {INDICACAO_STATUS.map((s) => (
            <option key={s} value={s}>
              {INDICACAO_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          de
          <input type="date" name="de" defaultValue={de} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm" />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          até
          <input type="date" name="ate" defaultValue={ate} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm" />
        </label>
        <input
          name="q"
          defaultValue={busca}
          placeholder="Código ou nome do indicado — Enter"
          className="h-8 min-w-56 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        />
      </FilterForm>

      {error ? (
        <p className="mx-auto max-w-7xl rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {mensagemDoBanco(error)}
        </p>
      ) : ver === "kanban" ? (
        <div className="mx-auto h-[calc(100vh-15rem)] min-h-[24rem] max-w-7xl overflow-x-auto pb-2">
          <div className="flex h-full min-w-max gap-3">
            {(etapa ? [etapa] : COLUNAS_KANBAN).map((coluna) => {
              const cartoes = linhas.filter((l) => l.status === coluna);
              return (
                <div key={coluna} className="flex h-full w-64 shrink-0 flex-col overflow-hidden rounded-xl border bg-muted/40">
                  <div className="flex items-center justify-between gap-2 border-b bg-background/50 px-3 py-2.5">
                    <StatusBadge status={coluna} />
                    <Badge variant="secondary">{cartoes.length}</Badge>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                    {cartoes.map((l) => {
                      const parada =
                        !["convertida", "fechou"].includes(l.status) &&
                        diasDesde(l.atualizado_em, agora) > DIAS_PARADA;
                      return (
                        <div
                          key={l.id}
                          className={cn(
                            "rounded-lg border bg-card p-3 shadow-sm transition-colors hover:border-primary/40",
                            l.trava_vencida && "border-dashed border-muted-foreground/50"
                          )}
                        >
                          <Link
                            href={`/indica-mais-risos/indicacoes/${l.id}`}
                            className="block text-sm font-medium hover:underline"
                          >
                            {l.indicado_nome}
                          </Link>
                          <p className="font-mono text-[10px] text-muted-foreground">{l.codigo}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            por {l.embaixador_rotulo ?? l.parceiro_nome ?? "—"}
                          </p>
                          {naRede && (
                            <p className="truncate text-[10px] text-muted-foreground">
                              {nomeUnidade.get(l.unidade_id) ?? ""}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 text-xs",
                                parada ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground"
                              )}
                            >
                              <Clock className="size-3" />
                              {haQuantoTempo(l.atualizado_em, agora)}
                            </span>
                            {parada && (
                              <Badge variant="outline" className={cn("text-[10px]", STATUS_COR.faltou)}>
                                parada
                              </Badge>
                            )}
                            {l.trava_vencida && (
                              <Badge variant="outline" className="text-[10px]">
                                trava vencida
                              </Badge>
                            )}
                          </div>
                          <div className="mt-2">
                            <AcoesIndicacao
                              compacto
                              podeCancelar={podeCancelarNa(session, l.unidade_id)}
                              indicacao={{
                                id: l.id,
                                codigo: l.codigo,
                                status: l.status,
                                clienteIndicadoId: l.cliente_indicado_id,
                                indicadoNome: l.indicado_nome,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                    {cartoes.length === 0 && (
                      <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                        {coluna === "registrada"
                          ? "Nenhuma indicação nova. Quem você atendeu hoje e saiu feliz?"
                          : "Nada nesta etapa."}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-7xl overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Indicado</TableHead>
                <TableHead>Quem indicou</TableHead>
                <TableHead>Etapa</TableHead>
                {naRede && <TableHead>Unidade</TableHead>}
                <TableHead>Pedido por</TableHead>
                <TableHead>Registrada</TableHead>
                <TableHead>Trava até</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/indica-mais-risos/indicacoes/${l.id}`} className="hover:underline">
                      {l.codigo}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link href={`/indica-mais-risos/indicacoes/${l.id}`} className="hover:underline">
                      {l.indicado_nome}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{l.embaixador_rotulo ?? l.parceiro_nome ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={l.status} />
                  </TableCell>
                  {naRede && <TableCell className="text-sm">{nomeUnidade.get(l.unidade_id) ?? ""}</TableCell>}
                  <TableCell className="text-sm">
                    {l.risartano_origem_id ? (pessoas.get(l.risartano_origem_id) ?? "—") : "—"}
                  </TableCell>
                  <TableCell className="text-sm">{formatBrDate(l.registrada_em)}</TableCell>
                  <TableCell className={cn("text-sm", l.trava_vencida && "text-destructive")}>
                    {formatBrDate(l.trava_ate)}
                  </TableCell>
                </TableRow>
              ))}
              {linhas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={naRede ? 8 : 7} className="py-8 text-center text-sm text-muted-foreground">
                    Nenhuma indicação com estes filtros.
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
