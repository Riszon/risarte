"use client";

import { TrendingDown, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { computeMargin } from "@/lib/finance/margin";

/**
 * FIN5 — a MARGEM da venda, ao vivo enquanto o consultor negocia.
 *
 * Existe por causa do repasse FIXO: o dentista recebe o mesmo valor
 * independente do preço fechado, então **cada real de desconto sai inteiro da
 * margem da clínica**. Um desconto que parece pequeno pode comer um terço do
 * resultado — e ninguém faz essa conta de cabeça no meio da conversa com o
 * paciente.
 *
 * NÃO bloqueia nada. O teto de desconto já é a trava; isto é informação para
 * decidir. Travar duas vezes a mesma coisa só ensina a ignorar o aviso.
 */
export function MarginAlert({
  priceCents,
  payoutCents,
  acquirerFeeCents = 0,
  custos = null,
  minimumPercent = null,
  className,
}: {
  priceCents: number;
  /** Repasse estimado dos procedimentos da venda. */
  payoutCents: number;
  acquirerFeeCents?: number;
  /**
   * Pedido do dono (27/10/2026): a mesma conta da Precificação — cadeira,
   * material, laboratório e imposto + taxa média sobre o preço. Nulo = não
   * deu para ler os custos (a tela diz que a margem está incompleta).
   */
  custos?: {
    chairCents: number;
    materialCents: number;
    labCents: number;
    /** Imposto + taxa média do pagamento (%). */
    proportionalPercent: number;
  } | null;
  minimumPercent?: number | null;
  className?: string;
}) {
  // Sem repasse cadastrado não há conta a mostrar — melhor calar que mentir.
  if (payoutCents <= 0 || priceCents <= 0) return null;

  const m = computeMargin(
    {
      priceCents,
      payoutCents,
      acquirerFeeCents,
      chairCents: custos?.chairCents ?? 0,
      materialCents: custos?.materialCents ?? 0,
      labCents: custos?.labCents ?? 0,
      proportionalPercent: custos?.proportionalPercent ?? 0,
    },
    minimumPercent
  );

  const tone = m.negative
    ? "border-destructive bg-destructive/10 text-destructive"
    : m.belowMinimum
      ? "border-amber-400 bg-amber-50 text-amber-900"
      : "border-border bg-muted/30";

  return (
    <div className={cn("rounded-lg border p-2 text-xs", tone, className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">
          {m.negative ? (
            <>
              <TrendingDown className="mr-1 inline size-3.5" />
              Margem NEGATIVA
            </>
          ) : m.belowMinimum ? (
            <>
              <TriangleAlert className="mr-1 inline size-3.5" />
              Margem abaixo do mínimo
            </>
          ) : (
            "Margem da venda"
          )}
        </span>
        <span className="text-sm font-semibold tabular-nums">
          {formatBRL(m.marginCents)}{" "}
          <span className="text-xs font-normal">({pct(m.marginPercent)})</span>
        </span>
      </div>

      <dl className="mt-1 space-y-0.5">
        <Row label="Preço negociado" cents={m.priceCents} />
        <Row
          label="Repasse do dentista"
          cents={-m.payoutCents}
          note="fixo — não cai com o desconto"
        />
        {m.chairCents > 0 && <Row label="Hora de cadeira" cents={-m.chairCents} />}
        {m.materialCents + m.labCents > 0 && (
          <Row label="Material e laboratório" cents={-(m.materialCents + m.labCents)} />
        )}
        {m.proportionalCents > 0 && (
          <Row
            label={`Imposto + taxa média (${pct(custos?.proportionalPercent ?? 0)})`}
            cents={-m.proportionalCents}
            note="sobre o preço"
          />
        )}
        {m.acquirerFeeCents > 0 && (
          <Row label="Taxa do meio de pagamento" cents={-m.acquirerFeeCents} />
        )}
      </dl>

      {custos === null ? (
        <p className="mt-1 text-[11px] opacity-80">
          Não consegui ler os custos da unidade (cadeira, material, imposto): esta
          margem conta só o repasse — a real é menor.
        </p>
      ) : (
        m.materialsPending && (
          <p className="mt-1 text-[11px] opacity-80">
            Nenhum procedimento desta venda tem kit de material: o material não
            entra — a margem real é menor.
          </p>
        )
      )}
      <p className="mt-1 text-[10px] opacity-70">
        A mesma conta da Precificação: repasse, cadeira, material e laboratório,
        e imposto + taxa média sobre o preço.
      </p>
      {m.negative && (
        <p className="mt-1 text-[11px] font-medium">
          Neste preço a venda dá prejuízo: o repasse e as taxas custam mais que
          o que o paciente paga.
        </p>
      )}
      {!m.negative && m.belowMinimum && minimumPercent !== null && (
        <p className="mt-1 text-[11px]">
          A unidade trabalha com mínimo de {pct(minimumPercent)}. Isto é um aviso,
          não um bloqueio — quem decide é você.
        </p>
      )}
    </div>
  );
}

/** "33,33%" — o percentual como se lê no Brasil. */
function pct(n: number): string {
  return `${String(n).replace(".", ",")}%`;
}

function Row({
  label,
  cents,
  note,
}: {
  label: string;
  cents: number;
  note?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="opacity-80">
        {label}
        {note && <span className="ml-1 text-[10px] opacity-70">({note})</span>}
      </dt>
      <dd className="tabular-nums">
        {cents < 0 ? "− " : ""}
        {formatBRL(Math.abs(cents))}
      </dd>
    </div>
  );
}
