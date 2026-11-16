"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Circle, MinusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/pricing";
import { marcarItemDoDistrato, type DistratoLido } from "@/app/(app)/financeiro/cobrancas-automaticas/distrato-actions";

const ORIGEM_DA_MULTA: Record<string, string> = {
  unidade: "configuração comercial da unidade",
  rede: "configuração comercial da rede",
  zero: "sem multa configurada",
  sem_multa: "venda direta: sem multa",
};

/**
 * 4020 (D12, 19.35.4): a CHECKLIST do distrato. Cada item fica "Feito" ou
 * "Não se aplica", com o motivo. O 9º é o termo assinado. Sem os 8 itens, o
 * "Efetivar" fica bloqueado (e o banco recusa).
 */
export function ChecklistDoDistrato({ d }: { d: DistratoLido }) {
  const router = useRouter();
  const [ocupado, start] = useTransition();
  const [motivo, setMotivo] = useState<Record<number, string>>({});
  const [naoSeAplica, setNaoSeAplica] = useState<number | null>(null);
  const a = d.acerto;

  const itens: { n: number; titulo: string; detalhe: React.ReactNode }[] = [
    {
      n: 1,
      titulo: "Pendências do tratamento",
      detalhe: (
        <>
          {d.pendencias.sessoes_a_cancelar} sessão(ões) não feita(s) serão canceladas
          {d.pendencias.consultas_futuras > 0 ? `, ${d.pendencias.consultas_futuras} com consulta marcada` : ""}. Confira
          procedimentos em andamento e peças em laboratório.
          {d.ortodontia && d.ortodontia.casos_ativos > 0 && (
            <>
              {" "}
              Ortodontia: o caso fica <strong>interrompido</strong>; {d.ortodontia.futuras} mensalidade(s) futura(s) (
              {formatBRL(d.ortodontia.futuras_valor)}) caem, com o boleto cancelado no Asaas.
              {d.ortodontia.vencidas > 0 && ` ${d.ortodontia.vencidas} vencida(s) (${formatBRL(d.ortodontia.vencidas_valor)}) continuam como dívida.`}
            </>
          )}
        </>
      ),
    },
    {
      n: 2,
      titulo: "Feitos × pagos",
      detalhe: (
        <>
          Feito {formatBRL(a.feito)} · pago {formatBRL(a.pago)}
          {a.pago_no_acordo > 0 && ` (inclui ${formatBRL(a.pago_no_acordo)} da parte desta venda nos acordos)`} ·{" "}
          {a.cliente_deve > 0
            ? `o cliente deve ${formatBRL(a.cliente_deve)}`
            : a.unidade_devolve > 0
              ? `a unidade devolve ${formatBRL(a.unidade_devolve)}`
              : "nada a acertar"}
          .
          {a.pago_agora !== a.pago && (
            <strong className="text-rose-700">
              {" "}
              Entrou pagamento depois do termo ({formatBRL(a.pago_agora)} pagos agora): descarte e abra o distrato de novo.
            </strong>
          )}
        </>
      ),
    },
    {
      n: 3,
      titulo: "Multa contratual",
      detalhe: (
        <>
          {a.multa_pct}% sobre o não realizado = {formatBRL(a.multa)} ({ORIGEM_DA_MULTA[d.multa.origem] ?? d.multa.origem}). O %
          só é mudado pelo Admin Master, na Central. Depois de efetivado, a parcela do acerto aceita a quitação por valor
          menor (Gerente ou Admin Master, com motivo, na auditoria).
        </>
      ),
    },
    {
      n: 4,
      titulo: "Acordos de renegociação",
      detalhe:
        d.acordos.length === 0 ? (
          "Esta venda não tem acordo de renegociação."
        ) : (
          <>
            {d.acordos.map((x) => (
              <span key={x.id} className="block">
                {x.codigo}: parte desta venda {x.parte}% · pago {formatBRL(x.pago_parte)} · aberto {formatBRL(x.aberto_parte)}
                {x.multi_venda ? " — junta outras vendas: as parcelas abertas são reduzidas (o termo mostra antes e depois)" : " — as parcelas abertas caem"}
                {x.pendente ? " — AINDA NÃO VALE: cancele o acordo pendente antes" : ""}
              </span>
            ))}
          </>
        ),
    },
    {
      n: 5,
      titulo: "Cobranças no Asaas",
      detalhe:
        d.cobrancas_vivas.length === 0 && d.listas_forma2 === 0 ? (
          "Nenhuma cobrança viva no Asaas."
        ) : (
          <>
            {d.cobrancas_vivas.length} cobrança(s) viva(s) serão cancelada(s) no Asaas ao efetivar (
            {formatBRL(d.cobrancas_vivas.reduce((t, c) => t + c.valor, 0))}).
            {d.listas_forma2 > 0 && " A lista dos boletos (forma 2) continua no ar e passa a mostrar cada boleto como \"Cancelado — não pague este boleto\"."}
          </>
        ),
    },
    {
      n: 6,
      titulo: "Devolução ao paciente",
      detalhe:
        a.unidade_devolve > 0 ? (
          <>
            {formatBRL(a.unidade_devolve)} a devolver. Depois de efetivar, peça a devolução por Pix da conta da unidade, com o
            termo assinado anexado; o Financeiro da Franqueadora ou o Admin Master autorizam.
          </>
        ) : (
          "Nada a devolver."
        ),
    },
    {
      n: 7,
      titulo: "Taxa da rede",
      detalhe: (
        <>
          Sobre o que o cliente pagou ({d.taxa_da_rede?.recebimentos ?? 0} recebimento(s)), a taxa continua devida
          {d.taxa_da_rede && d.taxa_da_rede.taxa > 0 ? `: ${formatBRL(d.taxa_da_rede.taxa)}` : ""}. A retida continua retida; a
          a reter do cartão parcelado já aprovado continua a reter; só a de parcela em aberto cai. A dispensa é à mão, do
          Financeiro da Franqueadora ou do Admin Master.
        </>
      ),
    },
    {
      n: 8,
      titulo: "Pontos",
      detalhe: (
        <>
          Indica +Risos: só os pontos em carência são estornados (a regra do programa).
          {d.indica?.situacao === "convertida" && " Esta venda indicada já virou pontos disponíveis: eles ficam, e o Financeiro é avisado."}
          {d.indica?.situacao === "fechou" && " Esta venda indicada ainda está em carência: os pontos voltam."}
          {!d.indica && " Esta venda não veio de indicação."}
        </>
      ),
    },
  ];

  const feitos = Object.keys(d.checklist).length;

  function marcar(n: number, state: "feito" | "nao_se_aplica" | null) {
    if (state === "nao_se_aplica" && (motivo[n] ?? "").trim().length < 5) {
      toast.error("Escreva por que não se aplica (pelo menos 5 letras).");
      return;
    }
    start(async () => {
      const r = await marcarItemDoDistrato({ id: d.id, item: n, state, reason: state === "nao_se_aplica" ? motivo[n] : undefined });
      if (!r.ok) toast.error(r.error);
      setNaoSeAplica(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div>
        <p className="text-sm font-semibold">Checklist do distrato ({feitos} de 8)</p>
        <p className="text-xs text-muted-foreground">
          Nada é cancelado no Asaas nem no riSZon antes dos 8 itens e do termo assinado. Aberto há {d.dias_aberto} dia(s): o
          Gerente é avisado a cada 7 dias e, depois de 30, o Financeiro da Franqueadora também.
        </p>
      </div>
      <ol className="space-y-2">
        {itens.map((it) => {
          const m = d.checklist[String(it.n)];
          return (
            <li key={it.n} className="rounded-md border p-2 text-xs">
              <div className="flex items-start gap-2">
                {m?.situacao === "feito" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : m?.situacao === "nao_se_aplica" ? (
                  <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="flex-1 space-y-1">
                  <p className="font-medium">
                    {it.n}. {it.titulo}
                  </p>
                  <p className="text-muted-foreground">{it.detalhe}</p>
                  {m && (
                    <p className="text-[11px]">
                      {m.situacao === "feito" ? "Feito" : `Não se aplica: ${m.motivo}`}
                      {m.quem ? ` — ${m.quem}` : ""}
                    </p>
                  )}
                  {d.pode_operar && (
                    <div className="flex flex-wrap gap-1.5">
                      {!m && (
                        <>
                          <Button size="sm" variant="outline" className="h-6 text-[11px]" disabled={ocupado} onClick={() => marcar(it.n, "feito")}>
                            Feito
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 text-[11px]" disabled={ocupado} onClick={() => setNaoSeAplica(it.n)}>
                            Não se aplica
                          </Button>
                        </>
                      )}
                      {m && (
                        <Button size="sm" variant="ghost" className="h-6 text-[11px]" disabled={ocupado} onClick={() => marcar(it.n, null)}>
                          Desfazer
                        </Button>
                      )}
                    </div>
                  )}
                  {naoSeAplica === it.n && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <input
                        value={motivo[it.n] ?? ""}
                        onChange={(e) => setMotivo((x) => ({ ...x, [it.n]: e.target.value }))}
                        placeholder="Por que não se aplica"
                        className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                      />
                      <Button size="sm" className="h-7 text-[11px]" disabled={ocupado} onClick={() => marcar(it.n, "nao_se_aplica")}>
                        Salvar
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
        <li className="rounded-md border p-2 text-xs">
          <p className="font-medium">9. Termo de distrato assinado</p>
          <p className="text-muted-foreground">
            {d.situacao === "assinado" || d.situacao === "efetivado"
              ? "Assinado."
              : "Imprima o termo acima, colha a assinatura e marque nos passos abaixo."}
          </p>
        </li>
      </ol>
    </div>
  );
}
