import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HandCoins } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance, isFinanceFranchisor } from "@/lib/finance/access";
import { formatBRL } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { AGING_LABELS } from "@/lib/finance/aging";
import {
  acimaDoLimite,
  porAtencao,
  totaisDaRede,
  type UnidadeRecebivel,
} from "@/lib/finance/network-receivables";

export const metadata: Metadata = { title: "Recebíveis da rede" };

/**
 * RECEBÍVEIS E INADIMPLÊNCIA DA REDE (OC-00005, 2ª metade).
 *
 * A tela da unidade responde "quanto eu tenho a receber e o que cobrar". Esta
 * responde outra pergunta, que é a da Franqueadora: **atrás de qual unidade eu
 * vou primeiro**.
 *
 * ⚠️ E A RESPOSTA NÃO É "A DE MAIOR TAXA". Uma unidade com R$ 300 vencidos e
 * 100% de inadimplência aparece pior que uma com R$ 80 mil vencidos e 12% — e é
 * atrás dos R$ 80 mil que se vai. A taxa diz se a unidade está doente; o valor
 * diz o tamanho do problema. A ordem da tabela usa os dois, nessa ordem
 * (`porAtencao`, com teste).
 */

function Numero({
  rotulo,
  valor,
  detalhe,
  alerta,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  alerta?: boolean;
}) {
  return (
    <Card className={alerta ? "border-destructive/40" : undefined}>
      <CardContent className="p-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {rotulo}
        </p>
        <p
          className={cn(
            "mt-1 text-xl font-semibold tabular-nums",
            alerta && "text-destructive"
          )}
        >
          {valor}
        </p>
        {detalhe && <p className="text-xs text-muted-foreground">{detalhe}</p>}
      </CardContent>
    </Card>
  );
}

function Escada({
  titulo,
  explicacao,
  faixas,
  tom,
}: {
  titulo: string;
  explicacao: string;
  faixas: readonly number[];
  tom: "futuro" | "atraso";
}) {
  const maior = Math.max(...faixas, 1);
  const total = faixas.reduce((s, v) => s + v, 0);
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{titulo}</h3>
        <span className="text-sm font-semibold tabular-nums">
          {formatBRL(total)}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{explicacao}</p>
      <div className="mt-3 space-y-2">
        {faixas.map((v, i) => (
          <div
            key={AGING_LABELS[i]}
            className="grid grid-cols-[8rem_1fr_auto] items-center gap-2"
          >
            <span className="text-xs text-muted-foreground">
              {AGING_LABELS[i]}
            </span>
            <span className="h-2 overflow-hidden rounded-full bg-muted">
              <span
                className={cn(
                  "block h-full rounded-full",
                  tom === "atraso" ? "bg-destructive/70" : "bg-primary/70"
                )}
                style={{ width: `${Math.round((v / maior) * 100)}%` }}
              />
            </span>
            <span className="text-xs tabular-nums">{formatBRL(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type LinhaBruta = {
  clinic_id: string;
  clinic_name: string;
  ownership: string;
  open_cents: number;
  overdue_cents: number;
  overdue_count: number;
  open_count: number;
  overdue_percent: number | null;
  limit_percent: number | null;
  due_30_cents: number;
  due_60_cents: number;
  due_90_cents: number;
  due_more_cents: number;
  late_30_cents: number;
  late_60_cents: number;
  late_90_cents: number;
  late_more_cents: number;
};

export default async function RecebiveisDaRedePage() {
  const session = await getSessionContext();
  // ⚠️ `notFound()`, como o resto do módulo recusa acesso. A guarda de verdade
  // está no banco (`network_receivables` exige Admin ou Financeiro da
  // Franqueadora); isto é para o gerente não ver a porta.
  if (!canViewFinance(session)) notFound();
  if (!session.isAdminMaster && !isFinanceFranchisor(session)) notFound();

  const supabase = await createClient();
  // O mesmo formato que as outras telas da rede usam para ler um `rpc` que
  // devolve tabela (ver painel-da-rede): `.returns<T[]>()` aqui não compila.
  const { data } = await supabase.rpc("network_receivables");

  const unidades: UnidadeRecebivel[] = ((data ?? []) as LinhaBruta[]).map((r) => ({
    clinicId: r.clinic_id,
    nome: r.clinic_name,
    ownership: r.ownership === "own" ? "own" : "franchised",
    abertoCents: Number(r.open_cents ?? 0),
    vencidoCents: Number(r.overdue_cents ?? 0),
    vencidoQuantidade: Number(r.overdue_count ?? 0),
    abertoQuantidade: Number(r.open_count ?? 0),
    taxaPercent:
      r.overdue_percent === null || r.overdue_percent === undefined
        ? null
        : Number(r.overdue_percent),
    limitePercent:
      r.limit_percent === null || r.limit_percent === undefined
        ? null
        : Number(r.limit_percent),
    aVencer: [
      Number(r.due_30_cents ?? 0),
      Number(r.due_60_cents ?? 0),
      Number(r.due_90_cents ?? 0),
      Number(r.due_more_cents ?? 0),
    ],
    atrasadas: [
      Number(r.late_30_cents ?? 0),
      Number(r.late_60_cents ?? 0),
      Number(r.late_90_cents ?? 0),
      Number(r.late_more_cents ?? 0),
    ],
  }));

  const totais = totaisDaRede(unidades);
  const ordenadas = [...unidades].sort(porAtencao);

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <HandCoins className="size-6 text-primary" />
          Recebíveis da rede
        </h1>
        <p className="text-sm text-muted-foreground">
          O que as unidades têm a receber, o que já venceu e atrás de qual ir
          primeiro.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-4">
        <Numero
          rotulo="A receber na rede"
          valor={formatBRL(totais.abertoCents)}
          detalhe={`${totais.unidades} unidade(s)`}
        />
        <Numero
          rotulo="Vencido na rede"
          valor={formatBRL(totais.vencidoCents)}
          detalhe={`${totais.vencidoQuantidade} cobrança(s)`}
          alerta={totais.vencidoCents > 0}
        />
        <Numero
          rotulo="Inadimplência da rede"
          valor={
            totais.taxaPercent === null
              ? "—"
              : `${totais.taxaPercent.toLocaleString("pt-BR")}%`
          }
          detalhe={
            totais.taxaPercent === null
              ? "Nada a receber na rede."
              : "Vencido ÷ a receber, somados."
          }
        />
        <Numero
          rotulo="Acima do limite"
          valor={String(totais.acimaDoLimite)}
          detalhe={
            totais.semReceber > 0
              ? `${totais.semReceber} sem nada a receber`
              : "unidade(s) passaram do próprio teto"
          }
          alerta={totais.acimaDoLimite > 0}
        />
      </section>

      {/* ⚠️ A TAXA DA REDE NÃO É A MÉDIA DAS TAXAS, e isso precisa estar escrito:
          quem confere somando as colunas com o dedo vai tentar a média primeiro
          e achar que o número está errado. */}
      <p className="rounded-lg border bg-muted/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        A inadimplência da rede é{" "}
        <strong className="text-foreground">
          o vencido de todas as unidades dividido pelo que todas têm a receber
        </strong>{" "}
        — não a média das taxas. Na média, uma unidade pequena com tudo vencido
        pesaria igual a uma grande em dia, e a rede pareceria muito pior do que
        é. O limite de cada unidade vem da cascata rede → unidade, em{" "}
        <strong className="text-foreground">Financeiro → Configuração</strong>,
        e é decisão da rede, não índice de mercado.
      </p>

      <section className="grid gap-3 lg:grid-cols-2">
        <Escada
          titulo="A rede tem a vencer"
          explicacao="Por prazo. É o que existe para antecipar — o desconto do banco é negociado por unidade e não está no sistema."
          faixas={totais.aVencer}
          tom="futuro"
        />
        <Escada
          titulo="A rede tem vencido"
          explicacao="Por tempo de atraso. Quanto mais velho, menor a chance de receber."
          faixas={totais.atrasadas}
          tom="atraso"
        />
      </section>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-medium">Unidade</th>
              <th className="px-2 py-2 text-right font-medium">A receber</th>
              <th className="px-2 py-2 text-right font-medium">Vencido</th>
              <th className="px-2 py-2 text-right font-medium">Taxa</th>
              <th className="px-2 py-2 text-right font-medium">Limite</th>
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((u) => {
              const estourou = acimaDoLimite(u);
              return (
                <tr key={u.clinicId} className="border-b last:border-0">
                  <td className="px-2 py-2">
                    {u.nome}
                    {u.ownership === "own" && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (própria)
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatBRL(u.abertoCents)}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2 text-right tabular-nums",
                      u.vencidoCents > 0 && "text-destructive"
                    )}
                  >
                    {formatBRL(u.vencidoCents)}
                    {u.vencidoQuantidade > 0 && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({u.vencidoQuantidade})
                      </span>
                    )}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2 text-right font-semibold tabular-nums",
                      estourou && "text-destructive"
                    )}
                  >
                    {/* Sem nada a receber não há taxa — e isso não é 0%, que se
                        leria como "em dia". A unidade continua na lista: sumir
                        faria a ausência parecer saúde. */}
                    {u.taxaPercent === null
                      ? "—"
                      : `${u.taxaPercent.toLocaleString("pt-BR")}%`}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                    {u.limitePercent === null
                      ? "—"
                      : `${u.limitePercent.toLocaleString("pt-BR")}%`}
                  </td>
                </tr>
              );
            })}
            {ordenadas.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted-foreground">
                  Nenhuma unidade ativa na rede.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        A ordem é <strong>quem pede atenção primeiro</strong>: acima do limite na
        frente e, entre essas, quem tem mais dinheiro vencido — não quem tem a
        maior taxa. A taxa diz se a unidade está doente; o valor diz o tamanho do
        problema. Para ver cliente a cliente, entre na unidade e abra{" "}
        <strong>Financeiro → Recebíveis</strong>.
      </p>
    </div>
  );
}
