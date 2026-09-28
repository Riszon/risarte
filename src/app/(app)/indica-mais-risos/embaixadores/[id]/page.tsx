import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { indicaDb } from "@/lib/indica/db";
import { ehGestorIndica } from "@/lib/indica/access";
import {
  EMBAIXADOR_STATUS_LABEL,
  RESGATE_STATUS_COR,
  RESGATE_STATUS_LABEL,
  SALDO_LABEL,
  TIPO_LANCAMENTO_LABEL,
  proximoNivel,
  type EmbaixadorStatus,
  type ResgateStatus,
} from "@/lib/indica/rotulos";
import type { IndicacaoStatus } from "@/lib/indica/status";
import { formatBrDate, formatBrDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "../../status-badge";
import { unidadesParaIndicar } from "../../dados";
import { AjusteDialog, ResgateDialog, SituacaoDialog, type ItemParaResgate } from "./acoes-embaixador";

export const metadata: Metadata = { title: "Embaixador — Indica +Risos" };

type Emb = {
  id: string;
  codigo: string;
  status: EmbaixadorStatus;
  cliente_id: string;
  clinic_id: string;
  nome: string;
  codigo_cliente: string | null;
  nivel_nome: string;
  nivel_ordem: number;
  multiplicador: number;
  disponivel: number;
  pendente: number;
  em_carencia: number;
  a_vencer_30_dias: number;
  total_resgatado: number;
  indicacoes: number;
  conversoes_12_meses: number;
  aceite_regulamento_em: string;
  versao_regulamento: string;
};

export default async function EmbaixadorPage(props: PageProps<"/indica-mais-risos/embaixadores/[id]">) {
  const session = await getSessionContext();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const db = await indicaDb();
  const { data: emb } = await db
    .from("v_embaixadores")
    .select(
      "id, codigo, status, cliente_id, clinic_id, nome, codigo_cliente, nivel_nome, nivel_ordem, multiplicador, disponivel, pendente, em_carencia, a_vencer_30_dias, total_resgatado, indicacoes, conversoes_12_meses, aceite_regulamento_em, versao_regulamento"
    )
    .eq("id", id)
    .maybeSingle<Emb>();
  if (!emb) notFound();

  await logAudit({ action: "view", entityType: "indica_embaixador", entityId: emb.id, clinicId: emb.clinic_id });

  const [
    { data: niveis },
    { data: lancamentos },
    { data: indicacoes },
    { data: resgates },
    { data: catalogo },
    unidades,
  ] = await Promise.all([
    db.from("niveis").select("id, codigo, nome, ordem, criterio_conversoes, ativo").order("ordem")
      .returns<{ id: string; codigo: string; nome: string; ordem: number; criterio_conversoes: number; ativo: boolean }[]>(),
    db.from("pontos_lancamentos")
      .select("id, tipo, saldo, riso_coins, motivo, libera_em, expira_em, criado_em, indicacao_id, resgate_id")
      .eq("embaixador_id", id)
      .order("id", { ascending: false })
      .limit(200)
      .returns<{
        id: number; tipo: string; saldo: string; riso_coins: number; motivo: string | null;
        libera_em: string | null; expira_em: string | null; criado_em: string;
        indicacao_id: string | null; resgate_id: string | null;
      }[]>(),
    db.from("v_indicacoes")
      .select("id, codigo, status, indicado_nome, registrada_em")
      .eq("embaixador_id", id)
      .order("registrada_em", { ascending: false })
      .returns<{ id: string; codigo: string; status: IndicacaoStatus; indicado_nome: string; registrada_em: string }[]>(),
    db.from("resgates")
      .select("id, codigo, status, item_nome, riso_coins, codigo_voucher, criado_em")
      .eq("embaixador_id", id)
      .order("criado_em", { ascending: false })
      .returns<{ id: string; codigo: string; status: ResgateStatus; item_nome: string | null; riso_coins: number; codigo_voucher: string | null; criado_em: string }[]>(),
    db.from("catalogo_itens")
      .select("id, nome, tipo, custo_riso_coins, valor_centavos, estoque, unidades, nivel_minimo_id")
      .eq("ativo", true)
      .order("custo_riso_coins")
      .returns<{ id: string; nome: string; tipo: string; custo_riso_coins: number; valor_centavos: number | null; estoque: number | null; unidades: string[]; nivel_minimo_id: string | null }[]>(),
    unidadesParaIndicar(session),
  ]);

  const unidadeUnica = unidades.length === 1 ? unidades[0].id : null;
  const { data: limite } = await db.rpc("config_numero", {
    p_chave: "resgate_aprovacao_acima",
    p_unidade_id: unidadeUnica,
  });

  const nivelPorId = new Map((niveis ?? []).map((n) => [n.id, n]));
  const idsDeUnidades = new Set(unidades.map((u) => u.id));
  const itens: ItemParaResgate[] = (catalogo ?? []).map((i) => {
    const minimo = i.nivel_minimo_id ? nivelPorId.get(i.nivel_minimo_id) : null;
    let bloqueio: string | null = null;
    if (i.estoque !== null && i.estoque <= 0) bloqueio = "acabou";
    else if (minimo && emb.nivel_ordem < minimo.ordem) bloqueio = `a partir do nível ${minimo.nome}`;
    else if (i.unidades.length > 0 && !i.unidades.some((u) => idsDeUnidades.has(u))) bloqueio = "não vale nas suas unidades";
    return {
      id: i.id,
      nome: i.nome,
      tipo: i.tipo,
      custo: i.custo_riso_coins,
      valorCentavos: i.valor_centavos,
      estoque: i.estoque,
      bloqueio,
    };
  });

  const codigoIndicacao = new Map((indicacoes ?? []).map((i) => [i.id, i.codigo]));
  const codigoResgate = new Map((resgates ?? []).map((r) => [r.id, r.codigo]));
  const proximo = proximoNivel(
    (niveis ?? []).filter((n) => n.ativo).map((n) => ({ codigo: n.codigo, nome: n.nome, ordem: n.ordem, criterio: n.criterio_conversoes })),
    emb.nivel_ordem,
    emb.conversoes_12_meses
  );
  const gestor = ehGestorIndica(session, emb.clinic_id);

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/indica-mais-risos/embaixadores" />}>
        <ArrowLeft className="mr-1 size-4" /> Embaixadores
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{emb.nome}</h1>
            <span className="rounded-full bg-gold px-2 py-0.5 text-xs text-gold-foreground">{emb.nivel_nome}</span>
            {emb.status !== "ativo" && (
              <span className="rounded-full border border-destructive/40 px-2 py-0.5 text-xs text-destructive">
                {EMBAIXADOR_STATUS_LABEL[emb.status]}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Código pessoal <span className="font-mono font-medium text-foreground">{emb.codigo}</span> ·{" "}
            <Link href={`/prontuarios/${emb.cliente_id}`} className="hover:underline">
              ficha {emb.codigo_cliente ?? ""}
            </Link>{" "}
            · regulamento {emb.versao_regulamento} aceito em {formatBrDate(emb.aceite_regulamento_em)}
          </p>
          <p className="text-xs text-muted-foreground">
            O link pessoal e o QR Code chegam com a página de convite (IND3).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {emb.status === "ativo" && (
            <ResgateDialog
              embaixadorId={emb.id}
              disponivel={emb.disponivel}
              itens={itens}
              unidades={unidades}
              limiteAprovacao={typeof limite === "number" ? limite : null}
            />
          )}
          {gestor && <AjusteDialog embaixadorId={emb.id} disponivel={emb.disponivel} />}
          {gestor && <SituacaoDialog embaixadorId={emb.id} atual={emb.status} />}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Disponível", emb.disponivel, emb.a_vencer_30_dias > 0 ? `${emb.a_vencer_30_dias} vencem em 30 dias` : "para resgatar"],
          ["Pendente", emb.pendente, "libera no comparecimento"],
          ["Em carência", emb.em_carencia, "libera na 1ª parcela ou no prazo"],
          ["Já resgatado", emb.total_resgatado, `${emb.indicacoes} indicação(ões)`],
        ].map(([rotulo, valor, dica]) => (
          <Card key={String(rotulo)}>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">{rotulo}</p>
              <p className="text-2xl font-semibold">{valor}</p>
              <p className="text-xs text-muted-foreground">{dica}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-4">
          {proximo ? (
            <>
              <div className="flex justify-between text-sm">
                <span>
                  Próximo nível: <strong>{proximo.nivel.nome}</strong>
                </span>
                <span className="text-muted-foreground">
                  {emb.conversoes_12_meses} de {proximo.nivel.criterio} fechamentos em 12 meses
                  {proximo.faltam > 0 ? ` · faltam ${proximo.faltam}` : " · sobe no próximo recálculo"}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-gold" style={{ width: `${Math.round(proximo.progresso * 100)}%` }} />
              </div>
            </>
          ) : (
            <p className="text-sm">Está no nível mais alto do programa.</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Multiplicador atual: {String(Number(emb.multiplicador)).replace(".", ",")}x (vale para os pontos novos).
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Indicações</CardTitle>
          </CardHeader>
          <CardContent>
            {(indicacoes ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma indicação.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {(indicacoes ?? []).map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2">
                    <Link href={`/indica-mais-risos/indicacoes/${i.id}`} className="hover:underline">
                      <span className="font-mono text-xs text-muted-foreground">{i.codigo}</span> {i.indicado_nome}
                    </Link>
                    <StatusBadge status={i.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Resgates</CardTitle>
          </CardHeader>
          <CardContent>
            {(resgates ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum resgate.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {(resgates ?? []).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span>
                      <span className="font-mono text-xs text-muted-foreground">{r.codigo}</span> {r.item_nome}
                      {r.codigo_voucher && <span className="ml-1 font-mono text-xs">{r.codigo_voucher}</span>}
                    </span>
                    <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", RESGATE_STATUS_COR[r.status])}>
                      {RESGATE_STATUS_LABEL[r.status]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Extrato de Riso Coins</CardTitle>
        </CardHeader>
        <CardContent>
          {(lancamentos ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum lançamento.</p>
          ) : (
            <ul className="divide-y text-sm">
              {(lancamentos ?? []).map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 py-1.5">
                  <span>
                    {TIPO_LANCAMENTO_LABEL[l.tipo] ?? l.tipo}{" "}
                    <span className="text-xs text-muted-foreground">({SALDO_LABEL[l.saldo] ?? l.saldo})</span>
                    {l.indicacao_id && codigoIndicacao.get(l.indicacao_id) && (
                      <span className="ml-1 font-mono text-xs text-muted-foreground">{codigoIndicacao.get(l.indicacao_id)}</span>
                    )}
                    {l.resgate_id && codigoResgate.get(l.resgate_id) && (
                      <span className="ml-1 font-mono text-xs text-muted-foreground">{codigoResgate.get(l.resgate_id)}</span>
                    )}
                    {l.motivo && <span className="block text-xs text-muted-foreground">{l.motivo}</span>}
                    <span className="block text-[11px] text-muted-foreground">
                      {formatBrDateTime(l.criado_em)}
                      {l.libera_em ? ` · libera ${formatBrDate(l.libera_em)}` : ""}
                      {l.expira_em ? ` · vence ${formatBrDate(l.expira_em)}` : ""}
                    </span>
                  </span>
                  <span className={cn("font-mono", l.riso_coins < 0 && "text-destructive")}>
                    {l.riso_coins > 0 ? "+" : ""}
                    {l.riso_coins}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
