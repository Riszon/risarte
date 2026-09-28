import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { indicaDb } from "@/lib/indica/db";
import { ehFranqueadoraIndica, ehGestorIndica } from "@/lib/indica/access";
import {
  CAMPANHA_STATUS_COR,
  CAMPANHA_STATUS_LABEL,
  resumoPublico,
  resumoRegras,
  situacaoOrcamento,
} from "@/lib/indica/campanhas";
import { INDICACAO_STATUS_LABEL, type IndicacaoStatus } from "@/lib/indica/status";
import { formatBrDateTime } from "@/lib/dates";
import { formatBRL } from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CAMPOS_CAMPANHA, consumos, type Campanha } from "../dados";
import { opcoesDaCampanha, parametroDaRede } from "../opcoes";
import { AcoesCampanha } from "./acoes";

export const metadata: Metadata = { title: "Campanha — Indica +Risos" };

export default async function CampanhaPage({ params }: PageProps<"/indica-mais-risos/campanhas/[id]">) {
  const { id } = await params;
  const session = await getSessionContext();
  const db = await indicaDb();
  const { data: c } = await db.from("campanhas").select(CAMPOS_CAMPANHA).eq("id", id).maybeSingle<Campanha>();
  if (!c) notFound();

  const [opcoes, alerta, consumo, { data: indicacoes }] = await Promise.all([
    opcoesDaCampanha(),
    parametroDaRede<number>("campanha_alerta_orcamento_percentual"),
    consumos([c.id]),
    db.from("indicacoes").select("status").eq("campanha_id", c.id).returns<{ status: string }[]>(),
  ]);
  const k = consumo.get(c.id);
  const farol = situacaoOrcamento(k?.percentual, Number(alerta ?? 100));
  const podeMexer =
    ehFranqueadoraIndica(session) ||
    (c.escopo === "unidades" && c.unidades.length > 0 && c.unidades.every((u) => ehGestorIndica(session, u)));
  const nomeUnidade = new Map(opcoes.todasUnidades.map((u) => [u.id, u.nome]));
  const nomes = {
    niveis: new Map(opcoes.niveis.map((n) => [n.id, n.nome])),
    empresas: new Map(opcoes.empresas.map((e) => [e.id, e.nome])),
  };
  const porStatus = new Map<string, number>();
  for (const i of indicacoes ?? []) porStatus.set(i.status, (porStatus.get(i.status) ?? 0) + 1);
  const largura = Math.min(100, Number(k?.percentual ?? 0));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/indica-mais-risos/campanhas" className="text-xs text-muted-foreground hover:underline">
            ← Campanhas
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {c.nome}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CAMPANHA_STATUS_COR[c.status]}`}>
              {CAMPANHA_STATUS_LABEL[c.status]}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatBrDateTime(c.inicio)} a {formatBrDateTime(c.fim)} · versão {c.versao}
            {c.descricao ? ` · ${c.descricao}` : ""}
          </p>
        </div>
        {podeMexer && (
          <div className="flex flex-wrap items-center gap-2">
            {c.status !== "encerrada" && c.status !== "apurada" && (
              <Button size="sm" variant="outline" nativeButton={false}
                render={<Link href={`/indica-mais-risos/campanhas/${c.id}/editar`} />}>
                Editar
              </Button>
            )}
            <AcoesCampanha id={c.id} status={c.status} />
          </div>
        )}
      </div>

      {farol === "esgotado" && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Orçamento esgotado: a campanha não entra mais em indicações novas. Aumente o orçamento para
          reabrir ou encerre.
        </p>
      )}
      {farol === "alerta" && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          Atenção: a campanha já consumiu {String(k?.percentual ?? 0).replace(".", ",")}% do orçamento.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Vantagem e público</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ul className="list-disc pl-5">
              {resumoRegras(c.regras).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p>
              <span className="text-muted-foreground">Onde: </span>
              {c.escopo === "rede" ? "Rede toda" : c.unidades.map((u) => nomeUnidade.get(u) ?? "unidade").join(", ")}
            </p>
            <p>
              <span className="text-muted-foreground">Para quem: </span>
              {resumoPublico(c.publico, nomes)}
            </p>
            {c.especialidade && (
              <p>
                <span className="text-muted-foreground">Especialidade-alvo: </span>
                {c.especialidade} (a vantagem no fechamento só vale com venda dessa especialidade)
              </p>
            )}
            {c.beneficio_indicado?.descricao && (
              <p>
                <span className="text-muted-foreground">Benefício ao indicado: </span>
                {c.beneficio_indicado.descricao}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Consumo e resultado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {k ? (
              <p>
                <strong>{k.riso_coins}</strong> Riso Coins ({formatBRL(k.custo_centavos)}) em indicações da
                campanha e bônus de marco.
              </p>
            ) : (
              <p className="text-muted-foreground">Consumo indisponível.</p>
            )}
            {k?.orcamento_max_centavos ? (
              <div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${farol === "esgotado" ? "bg-destructive" : farol === "alerta" ? "bg-amber-500" : "bg-emerald-500"}`}
                    style={{ width: `${largura}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {String(k.percentual ?? 0).replace(".", ",")}% de {formatBRL(k.orcamento_max_centavos)} · alerta em{" "}
                  {alerta ?? "—"}%
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Sem teto de orçamento.</p>
            )}
            <div>
              <p className="text-muted-foreground">Indicações na campanha: {(indicacoes ?? []).length}</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {[...porStatus.entries()].map(([s, n]) => (
                  <li key={s} className="rounded-md border px-2 py-0.5 text-xs">
                    {INDICACAO_STATUS_LABEL[s as IndicacaoStatus] ?? s}: {n}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      {c.regulamento_md && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Regulamento</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap">{c.regulamento_md}</CardContent>
        </Card>
      )}
    </div>
  );
}
