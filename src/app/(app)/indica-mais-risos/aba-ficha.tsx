import Link from "next/link";
import type { SessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { indicaDb } from "@/lib/indica/db";
import { canViewIndica } from "@/lib/indica/access";
import { INDICACAO_STATUS_LABEL, STATUS_COR, type IndicacaoStatus } from "@/lib/indica/status";
import {
  EMBAIXADOR_STATUS_LABEL,
  PEDIDO_MOMENTOS,
  PEDIDO_RESULTADOS,
  RESGATE_STATUS_LABEL,
  type EmbaixadorStatus,
  type ResgateStatus,
} from "@/lib/indica/rotulos";
import { formatBrDate } from "@/lib/dates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * A aba "Indica +Risos" da ficha do cliente: o cliente como EMBAIXADOR
 * (status, nível, saldo, todas as indicações que fez, resgates), como
 * INDICADO (por quem) e os pedidos de indicação feitos a ele.
 *
 * Mora no módulo; a ficha (núcleo) só ganha a linha que a chama. Quem vê o
 * quê, a RLS do schema `indica` decide.
 */

type Embaixador = {
  id: string;
  codigo: string;
  status: EmbaixadorStatus;
  nivel_nome: string;
  multiplicador: number;
  disponivel: number;
  pendente: number;
  em_carencia: number;
  a_vencer_30_dias: number;
  total_resgatado: number;
  indicacoes: number;
  conversoes_12_meses: number;
  aceite_regulamento_em: string;
};
type Indicacao = {
  id: string;
  codigo: string;
  status: IndicacaoStatus;
  indicado_nome: string;
  embaixador_rotulo: string | null;
  parceiro_nome: string | null;
  registrada_em: string;
};

const MOMENTO = new Map(PEDIDO_MOMENTOS.map((m) => [m.valor, m.rotulo]));
const RESULTADO = new Map(PEDIDO_RESULTADOS.map((r) => [r.valor, r.rotulo]));
const guia = (s: SessionContext) => (canViewIndica(s) ? "/indica-mais-risos/como-funciona" : "/guia-indica");

function Numero({ rotulo, valor, detalhe }: { rotulo: string; valor: number | string; detalhe?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-xl font-semibold">{valor}</p>
      {detalhe && <p className="text-xs text-muted-foreground">{detalhe}</p>}
    </div>
  );
}

/** Selo curto para o topo da ficha: Embaixador (nível, código) ou quem indicou. */
export async function SeloIndica({ session, clienteId }: { session: SessionContext; clienteId: string }) {
  const db = await indicaDb();
  const [{ data: emb }, { data: foiIndicado }] = await Promise.all([
    db.from("v_embaixadores").select("id, codigo, status, nivel_nome").eq("cliente_id", clienteId)
      .maybeSingle<{ id: string; codigo: string; status: EmbaixadorStatus; nivel_nome: string }>(),
    db.from("v_indicacoes").select("codigo, embaixador_rotulo, parceiro_nome").eq("cliente_indicado_id", clienteId)
      .order("registrada_em", { ascending: false }).limit(1)
      .maybeSingle<{ codigo: string; embaixador_rotulo: string | null; parceiro_nome: string | null }>(),
  ]);
  if (!emb && !foiIndicado) return null;
  const modulo = canViewIndica(session);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {emb && (
        <span
          title="Embaixador do Indica +Risos"
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            emb.status === "ativo"
              ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {modulo ? (
            <Link href={`/indica-mais-risos/embaixadores/${emb.id}`} className="hover:underline">
              {emb.nivel_nome} · {emb.codigo}
            </Link>
          ) : (
            <>{emb.nivel_nome} · {emb.codigo}</>
          )}
          {emb.status !== "ativo" && ` (${EMBAIXADOR_STATUS_LABEL[emb.status].toLowerCase()})`}
        </span>
      )}
      {foiIndicado && (
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
          Indicado por {foiIndicado.embaixador_rotulo ?? foiIndicado.parceiro_nome ?? "—"}
        </span>
      )}
    </span>
  );
}

export async function AbaIndicaNaFicha({ session, clienteId }: { session: SessionContext; clienteId: string }) {
  const db = await indicaDb();
  const supabase = await createClient();
  const modulo = canViewIndica(session);
  const [{ data: emb, error }, { data: recebidas }, { data: pedidos }] = await Promise.all([
    db.from("v_embaixadores")
      .select("id, codigo, status, nivel_nome, multiplicador, disponivel, pendente, em_carencia, a_vencer_30_dias, total_resgatado, indicacoes, conversoes_12_meses, aceite_regulamento_em")
      .eq("cliente_id", clienteId).maybeSingle<Embaixador>(),
    db.from("v_indicacoes").select("id, codigo, status, indicado_nome, embaixador_rotulo, parceiro_nome, registrada_em")
      .eq("cliente_indicado_id", clienteId).order("registrada_em", { ascending: false }).returns<Indicacao[]>(),
    db.from("pedidos_indicacao").select("id, momento, resultado, observacao, risartano_id, criado_em")
      .eq("cliente_id", clienteId).order("criado_em", { ascending: false }).limit(20)
      .returns<{ id: string; momento: string; resultado: string; observacao: string | null; risartano_id: string; criado_em: string }[]>(),
  ]);
  if (error) {
    console.error("aba indica:", error.message);
    return <p className="text-sm text-muted-foreground">O Indica +Risos não respondeu agora. Tente de novo em instantes.</p>;
  }
  const [{ data: feitas }, { data: resgates }, { data: pessoas }] = await Promise.all([
    emb
      ? db.from("v_indicacoes").select("id, codigo, status, indicado_nome, embaixador_rotulo, parceiro_nome, registrada_em")
          .eq("embaixador_id", emb.id).order("registrada_em", { ascending: false }).limit(200).returns<Indicacao[]>()
      : Promise.resolve({ data: [] as Indicacao[] }),
    emb
      ? db.from("resgates").select("id, codigo, item_nome, riso_coins, status, criado_em").eq("embaixador_id", emb.id)
          .order("criado_em", { ascending: false }).limit(20)
          .returns<{ id: string; codigo: string; item_nome: string | null; riso_coins: number; status: ResgateStatus; criado_em: string }[]>()
      : Promise.resolve({ data: [] }),
    (pedidos ?? []).length
      ? supabase.from("profiles").select("id, full_name").in("id", [...new Set((pedidos ?? []).map((p) => p.risartano_id))])
          .returns<{ id: string; full_name: string }[]>()
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);
  const nome = new Map((pessoas ?? []).map((p) => [p.id, p.full_name]));
  const linkInd = (i: Indicacao) =>
    modulo ? (
      <Link href={`/indica-mais-risos/indicacoes/${i.id}`} className="font-medium text-primary hover:underline">{i.codigo}</Link>
    ) : (
      <span className="font-medium">{i.codigo}</span>
    );
  const selo = (s: IndicacaoStatus) => (
    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COR[s] ?? ""}`}>{INDICACAO_STATUS_LABEL[s] ?? s}</span>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Como Embaixador</CardTitle>
          <Link href={guia(session)} className="text-xs text-primary hover:underline">Como funciona o programa?</Link>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {!emb ? (
            <p className="text-muted-foreground">
              Este cliente ainda não é Embaixador. Ele passa a ser quando aceita o regulamento — pelo botão{" "}
              <strong>Nova indicação</strong> no topo da ficha, na primeira indicação que fizer.
            </p>
          ) : (
            <>
              <p>
                <strong>{emb.nivel_nome}</strong> · código <strong>{emb.codigo}</strong> ·{" "}
                {EMBAIXADOR_STATUS_LABEL[emb.status]} · multiplicador {String(Number(emb.multiplicador)).replace(".", ",")}× ·
                no programa desde {formatBrDate(emb.aceite_regulamento_em)}
                {modulo && (
                  <>
                    {" · "}
                    <Link href={`/indica-mais-risos/embaixadores/${emb.id}`} className="text-primary hover:underline">
                      abrir extrato e ficha do Embaixador
                    </Link>
                  </>
                )}
              </p>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Numero rotulo="Riso Coins disponíveis" valor={emb.disponivel} detalhe={emb.a_vencer_30_dias > 0 ? `${emb.a_vencer_30_dias} vencem em 30 dias` : undefined} />
                <Numero rotulo="Pendentes" valor={emb.pendente} detalhe="liberam no comparecimento" />
                <Numero rotulo="Em carência" valor={emb.em_carencia} detalhe="liberam na 1ª parcela" />
                <Numero rotulo="Já resgatados" valor={emb.total_resgatado} />
                <Numero rotulo="Indicações feitas" valor={emb.indicacoes} />
                <Numero rotulo="Conversões (12 meses)" valor={emb.conversoes_12_meses} />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Indicações que ele fez ({(feitas ?? []).length})</p>
                {(feitas ?? []).length === 0 ? (
                  <p className="text-muted-foreground">Nenhuma ainda.</p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {(feitas ?? []).map((i) => (
                      <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <span>{linkInd(i)} · {i.indicado_nome}</span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          {formatBrDate(i.registrada_em)} {selo(i.status)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {(resgates ?? []).length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Resgates</p>
                  <ul className="divide-y rounded-lg border">
                    {(resgates ?? []).map((r) => (
                      <li key={r.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                        <span>{r.codigo} · {r.item_nome ?? "Prêmio"}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatBrDate(r.criado_em)} · {r.riso_coins} Riso Coins · {RESGATE_STATUS_LABEL[r.status] ?? r.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Como indicado</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {(recebidas ?? []).length === 0 ? (
            <p className="text-muted-foreground">Este cliente não chegou por indicação.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {(recebidas ?? []).map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>{linkInd(i)} · indicado por <strong>{i.embaixador_rotulo ?? i.parceiro_nome ?? "—"}</strong></span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {formatBrDate(i.registrada_em)} {selo(i.status)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pedidos de indicação feitos a este cliente</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {(pedidos ?? []).length === 0 ? (
            <p className="text-muted-foreground">
              Ninguém registrou um pedido ainda. Use <strong>Pedi indicação</strong> no topo da ficha depois de um bom momento
              (fechamento, entrega de etapa, elogio).
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {(pedidos ?? []).map((p) => (
                <li key={p.id} className="px-3 py-2">
                  <span className="font-medium">{RESULTADO.get(p.resultado) ?? p.resultado}</span>{" "}
                  <span className="text-muted-foreground">
                    · {MOMENTO.get(p.momento) ?? p.momento} · {nome.get(p.risartano_id) ?? "equipe"} · {formatBrDate(p.criado_em)}
                  </span>
                  {p.observacao && <span className="block text-xs text-muted-foreground">{p.observacao}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
