import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { HandCoins } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance } from "@/lib/finance/access";
import { formatBRL } from "@/lib/pricing";
import { todayInBrazil, formatBrDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FilterForm } from "@/components/filter-form";
import type { AgingBand } from "@/lib/finance/aging";
import { carregarRecebiveis, type LinhaRecebivel } from "./dados";

export const metadata: Metadata = { title: "Recebíveis e inadimplência" };

/**
 * RECEBÍVEIS E INADIMPLÊNCIA DA UNIDADE (relato OC-00005).
 *
 * O Financeiro tinha *Contas a pagar* e não tinha contas a RECEBER. A régua da
 * inadimplência existia desde o FIN1 e vivia dentro da ficha de um paciente:
 * dava para ver a inadimplência do Fulano, nunca a da unidade.
 *
 * A tela responde três perguntas, nesta ordem:
 *   1. quanto tenho a receber, e quanto disso já venceu;
 *   2. a taxa de inadimplência está acima do que a rede considera aceitável;
 *   3. o que dá para antecipar (a vencer, por prazo) e o que dá para cobrar
 *      (vencido, por tempo de atraso).
 */

/**
 * A ESCADA DESENHADA — barras em CSS, sem biblioteca nova.
 *
 * ⚠️ O SISTEMA NÃO TEM NENHUMA BIBLIOTECA DE GRÁFICO, e quatro barras
 * proporcionais não justificam a primeira: seria peso novo em toda tela do
 * sistema para desenhar o que uma div com largura percentual desenha.
 *
 * ⚠️ E A BARRA MOSTRA O VALOR ESCRITO DO LADO, sempre. Barra sozinha comunica
 * proporção e esconde grandeza — quem olha não sabe se a maior é mil reais ou
 * cem mil, que é exatamente o que se precisa saber para decidir antecipar.
 */
function Escada({
  titulo,
  explicacao,
  faixas,
  tom,
}: {
  titulo: string;
  explicacao: string;
  faixas: AgingBand[];
  tom: "futuro" | "atraso";
}) {
  const maior = Math.max(...faixas.map((f) => f.cents), 1);
  const total = faixas.reduce((s, f) => s + f.cents, 0);

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
        {faixas.map((f) => (
          <div key={f.rotulo} className="grid grid-cols-[8rem_1fr_auto] items-center gap-2">
            <span className="text-xs text-muted-foreground">{f.rotulo}</span>
            <span className="h-2 overflow-hidden rounded-full bg-muted">
              <span
                className={cn(
                  "block h-full rounded-full",
                  tom === "atraso" ? "bg-destructive/70" : "bg-primary/70"
                )}
                style={{ width: `${Math.round((f.cents / maior) * 100)}%` }}
              />
            </span>
            <span className="text-xs tabular-nums">
              {formatBRL(f.cents)}
              <span className="ml-1 text-muted-foreground">({f.quantidade})</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** O que a lista mostra. Vazio = tudo o que ainda deve alguma coisa. */
type Filtro = "" | "vencidas" | "a_vencer";

export default async function RecebiveisPage(
  props: PageProps<"/financeiro/recebiveis">
) {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");

  const clinicId = session.activeClinic?.id ?? null;
  if (!clinicId) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Selecione uma unidade no menu lateral.
        </p>
      </div>
    );
  }

  const params = await props.searchParams;
  const pick = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const filtro = (pick("mostrar") ?? "") as Filtro;
  const busca = (pick("cliente") ?? "").trim();

  const supabase = await createClient();
  const { linhas, resumo } = await carregarRecebiveis(supabase, clinicId);
  const hoje = todayInBrazil();

  const visiveis = linhas
    .filter((l) =>
      filtro === "vencidas"
        ? l.dataEfetiva < hoje
        : filtro === "a_vencer"
          ? l.dataEfetiva >= hoje
          : true
    )
    .filter((l) =>
      busca ? l.cliente.toLowerCase().includes(busca.toLowerCase()) : true
    );

  const acimaDoLimite =
    resumo.taxaPercent !== null &&
    resumo.limitePercent !== null &&
    resumo.taxaPercent > resumo.limitePercent;

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <HandCoins className="size-6 text-primary" />
          Recebíveis e inadimplência
        </h1>
        <p className="text-sm text-muted-foreground">
          {session.activeClinic?.name} · o que a unidade tem a receber, o que já
          venceu e quanto isso representa.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              A receber
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatBRL(resumo.abertoCents)}
            </p>
            <p className="text-xs text-muted-foreground">
              {resumo.abertoQuantidade} cobrança(s) em aberto
            </p>
          </CardContent>
        </Card>

        <Card className={acimaDoLimite ? "border-destructive/40" : undefined}>
          <CardContent className="p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Vencido
            </p>
            <p
              className={cn(
                "mt-1 text-xl font-semibold tabular-nums",
                resumo.vencidoCents > 0 && "text-destructive"
              )}
            >
              {formatBRL(resumo.vencidoCents)}
            </p>
            <p className="text-xs text-muted-foreground">
              {resumo.vencidoQuantidade} cobrança(s) · já com multa e juros
            </p>
          </CardContent>
        </Card>

        <Card className={acimaDoLimite ? "border-destructive/40" : undefined}>
          <CardContent className="p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Inadimplência
            </p>
            <p
              className={cn(
                "mt-1 text-xl font-semibold tabular-nums",
                acimaDoLimite && "text-destructive"
              )}
            >
              {/* ⚠️ SEM NADA A RECEBER NÃO EXISTE TAXA. "0%" se leria como
                  "está ótimo", quando a verdade é "não há o que medir" — e as
                  duas pedem decisões opostas. */}
              {resumo.taxaPercent === null
                ? "—"
                : `${resumo.taxaPercent.toLocaleString("pt-BR")}%`}
            </p>
            <p className="text-xs text-muted-foreground">
              {resumo.taxaPercent === null
                ? "Nada a receber nesta unidade."
                : resumo.limitePercent === null
                  ? "Sem limite definido pela rede."
                  : `Limite da rede: ${resumo.limitePercent.toLocaleString("pt-BR")}%`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Recebido no mês
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatBRL(resumo.recebidoNoMesCents)}
            </p>
            <p className="text-xs text-muted-foreground">
              Baixas do mês, sem os estornos.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* ⚠️ O LIMITE É DECISÃO DA REDE, NÃO VERDADE DE MERCADO — e a tela diz
          isso ao lado do número. O Admin Master perguntou "qual a taxa saudável
          para uma empresa"; nenhum sistema sabe responder isso por uma clínica,
          e um percentual apresentado como referência de mercado viraria
          "o sistema disse que 5% é normal". */}
      <p className="rounded-lg border bg-muted/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        A inadimplência é <strong className="text-foreground">o vencido dividido pelo que há a receber</strong> — não
        sobre o faturamento, senão a taxa cairia em todo mês de venda forte
        mesmo com a cobrança piorando. O limite de comparação é{" "}
        <strong className="text-foreground">definido pela rede</strong> em
        Financeiro → Configuração, e não é um índice de mercado: o que é
        saudável depende do ticket, do meio de pagamento e da praça de cada
        unidade.
      </p>

      <section className="grid gap-3 lg:grid-cols-2">
        <Escada
          titulo="A vencer, por prazo"
          explicacao="É o que existe para antecipar. O desconto da antecipação depende da negociação com o banco — o sistema não calcula isso."
          faixas={resumo.aVencer}
          tom="futuro"
        />
        <Escada
          titulo="Vencido, por tempo de atraso"
          explicacao="É o que existe para cobrar. Quanto mais velho o atraso, menor a chance de receber — por isso separado por idade."
          faixas={resumo.atrasadas}
          tom="atraso"
        />
      </section>

      <FilterForm className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Mostrar</span>
          <select
            name="mostrar"
            defaultValue={filtro}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          >
            <option value="">Tudo em aberto</option>
            <option value="vencidas">Só as vencidas</option>
            <option value="a_vencer">Só as a vencer</option>
          </select>
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-muted-foreground">Cliente</span>
          <Input name="cliente" defaultValue={busca} placeholder="Nome do cliente" />
        </label>
      </FilterForm>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-medium">Cliente</th>
              <th className="px-2 py-2 font-medium">Vencimento</th>
              <th className="px-2 py-2 text-right font-medium">Falta</th>
              <th className="px-2 py-2 text-right font-medium">Com multa e juros</th>
              <th className="px-2 py-2 font-medium">Situação</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l: LinhaRecebivel) => (
              <tr key={l.id} className="border-b last:border-0">
                <td className="px-2 py-2">
                  {l.clientId ? (
                    <Link
                      href={`/prontuarios/${l.clientId}`}
                      className="hover:underline"
                    >
                      {l.cliente}
                    </Link>
                  ) : (
                    l.cliente
                  )}
                </td>
                <td
                  className={cn(
                    "px-2 py-2 tabular-nums",
                    l.isLate && "font-semibold text-destructive"
                  )}
                >
                  {formatBrDate(`${l.dataEfetiva}T12:00:00`)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {formatBRL(l.balanceCents)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {/* Só faz sentido para a vencida: é o valor de cobrança de
                      hoje. Na que está em dia, repetir o principal sugeriria
                      que já há encargo correndo. */}
                  {l.isLate ? formatBRL(l.updatedBalanceCents) : "—"}
                </td>
                <td className="px-2 py-2 text-xs text-muted-foreground">
                  {l.isLate
                    ? `${l.daysLate} dia(s) em atraso`
                    : "Em dia"}
                </td>
              </tr>
            ))}
            {visiveis.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted-foreground">
                  {linhas.length === 0
                    ? "Nenhuma cobrança em aberto nesta unidade."
                    : "Nenhuma cobrança com esse filtro."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        A lista traz <strong>só o que ainda deve alguma coisa</strong>. Cobrança
        paga, cancelada ou substituída por renegociação fica na ficha do
        cliente — aqui ela inflaria o total sem ser dívida.
      </p>
    </div>
  );
}
