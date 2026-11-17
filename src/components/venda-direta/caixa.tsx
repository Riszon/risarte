"use client";

// Venda direta v3 (docs/comercial/VENDA-DIRETA-V3-PLANO.md) — o CAIXA.
// Uma janela só, do lançamento ao "venda concluída": o que vende, como paga,
// assinar e receber. Abre do Atendimento, do prontuário e da fila "Para
// receber"; lê os próprios dados ao abrir (só precisa do cliente).

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  CircleDot,
  FileSignature,
  Gift,
  Loader2,
  MessageCircle,
  PartyPopper,
  ShoppingCart,
  TriangleAlert,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ListaComBusca } from "@/components/ui/lista-com-busca";
import { PaymentScheduleEditor } from "@/components/payment-schedule-editor";
import { AcordosDaVenda } from "@/components/commercial/acordos-da-venda";
import { DistratoDaVenda } from "@/components/commercial/distrato-da-venda";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { buildSchedule, type ScheduleEntry } from "@/lib/payments";
import { formatBrDateTime, isoDateIn, todayInBrazil } from "@/lib/dates";
import { comConfirmacaoDeBoletos } from "@/lib/confirmar-boletos";
import { directSaleViolations } from "@/lib/direct-sale";
import type { CommercialRule, PaymentMethod } from "@/lib/commercial";
import {
  ROTULO_METODO_VENDA_NOVA,
  ehVendaNova,
  meioParaARegra,
  meiosDaVendaNova,
  type MetodoVendaNova,
} from "@/lib/venda-direta-meios";
import {
  ROTULO_DO_BOTAO,
  atalhosDoCaixa,
  atendidoAntesDaVenda,
  atendimentoPadrao,
  etapaDoCaixa,
  meioInicial,
  meiosDoCaixa,
  parcelasAoTrocarDeMeio,
  parcelasDoMeio,
  previaDoCaixa,
  recebidoNoBalcao,
} from "@/lib/venda-direta-caixa";
import {
  carregarCaixa,
  confirmarRecebimento,
  enviarTermo,
  finalizarVendaDireta,
  receberNoBalcao,
  salvarPagamentoDaVenda,
  type DadosDoCaixa,
  type PagamentoDoCaixa,
} from "@/app/(app)/comercial/venda-direta/caixa-actions";
import {
  cancelDirectSale,
  closeDirectSaleStep,
} from "@/app/(app)/comercial/venda-direta/actions";
import type { DirectSaleRow } from "@/app/(app)/comercial/venda-direta/direct-sale-item";
import { AcoesDoTermo, textoDoTermoAssinado } from "./termo";
import { PagamentoPeloAsaas } from "./pagamento";
import { AtenderAgora } from "./encaixe";
import { whatsappLink } from "@/lib/whatsapp";
import { comprovanteDaVenda } from "@/lib/venda-direta-caixa";

const TIPO_DO_ATENDIMENTO: Record<string, string> = {
  evaluation: "Avaliação",
  commercial_presentation: "Apresentação comercial",
  treatment_start: "Início de tratamento",
  treatment_session: "Sessão",
  return: "Retorno",
  urgency: "Urgência",
  emergency: "Emergência",
};

const diaDe = (d: Date) => isoDateIn(d);

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

type Linha = { procedureId: string; quantity: number };
type Ajuste = "none" | "desc_reais" | "desc_pct" | "acresc";

export type AlvoDoCaixa = {
  clientId: string;
  clientName?: string | null;
  /** Atendimento já sabido (porta do Atendimento e da agenda). */
  appointmentId?: string | null;
  /** Continuar uma venda aberta. */
  saleId?: string | null;
};

/**
 * A janela. Controlada: quem abre diz o cliente (e, se souber, o atendimento
 * ou a venda a continuar). `alvo` nulo = fechada.
 */
export function CaixaVendaDireta({
  alvo,
  onClose,
}: {
  alvo: AlvoDoCaixa | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={alvo !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col sm:max-w-2xl">
        {alvo && (
          <Conteudo
            // Outro cliente ou outra venda = estado novo.
            key={`${alvo.clientId}|${alvo.saleId ?? ""}|${alvo.appointmentId ?? ""}`}
            alvo={alvo}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Abre o caixa numa venda pelo endereço (`?venda=<id>`) — é o destino do
 * "Continuar" do painel "Precisa de atenção". Ao fechar, tira o parâmetro.
 */
export function CaixaPeloEndereco({
  clientId,
  clientName,
  saleId,
}: {
  clientId: string;
  clientName?: string | null;
  saleId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [aberto, setAberto] = useState(true);
  return (
    <CaixaVendaDireta
      alvo={aberto ? { clientId, clientName, saleId } : null}
      onClose={() => {
        setAberto(false);
        router.replace(pathname, { scroll: false });
      }}
    />
  );
}

/** Botão "Venda direta" que abre o caixa (prontuário). */
export function BotaoVendaDireta({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName?: string | null;
}) {
  const [alvo, setAlvo] = useState<AlvoDoCaixa | null>(null);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setAlvo({ clientId, clientName })}
      >
        <ShoppingCart className="mr-1 size-3.5" />
        Venda Direta
      </Button>
      <CaixaVendaDireta alvo={alvo} onClose={() => setAlvo(null)} />
    </>
  );
}

/** Botão "Abrir"/"Continuar" de uma venda já lançada (listas). */
export function BotaoContinuarVenda({
  clientId,
  clientName,
  saleId,
  rotulo = "Continuar",
  destaque = false,
}: {
  clientId: string;
  clientName?: string | null;
  saleId: string;
  rotulo?: string;
  destaque?: boolean;
}) {
  const [alvo, setAlvo] = useState<AlvoDoCaixa | null>(null);
  return (
    <>
      <Button
        size="sm"
        variant={destaque ? "default" : "outline"}
        onClick={() => setAlvo({ clientId, clientName, saleId })}
      >
        {rotulo}
      </Button>
      <CaixaVendaDireta alvo={alvo} onClose={() => setAlvo(null)} />
    </>
  );
}

function Conteudo({ alvo, onClose }: { alvo: AlvoDoCaixa; onClose: () => void }) {
  const router = useRouter();
  const [dados, setDados] = useState<DadosDoCaixa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [saleId, setSaleId] = useState<string | null>(alvo.saleId ?? null);
  const [trocandoPagamento, setTrocandoPagamento] = useState(false);
  // VD3-2: o termo não saiu no Finalizar — o motivo aparece na caixa Termo.
  const [termoErro, setTermoErro] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const recarregar = useCallback(async () => {
    const r = await carregarCaixa(alvo.clientId);
    if (r.ok) {
      setDados(r.dados);
      setErro(null);
    } else setErro(r.error);
  }, [alvo.clientId]);

  useEffect(() => {
    let vivo = true;
    carregarCaixa(alvo.clientId)
      .then((r) => {
        if (!vivo) return;
        if (r.ok) setDados(r.dados);
        else setErro(r.error);
      })
      .catch(() => vivo && setErro("Não foi possível abrir a venda direta."));
    return () => {
      vivo = false;
    };
  }, [alvo.clientId]);

  /** Depois de cada passo: relê a venda e atualiza a tela de trás. */
  const depois = useCallback(async () => {
    await recarregar();
    router.refresh();
  }, [recarregar, router]);

  const venda = saleId ? (dados?.vendas.find((v) => v.id === saleId) ?? null) : null;
  const nome = dados?.clientName ?? alvo.clientName ?? "Cliente";

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          Venda direta — {nome}
          {venda?.code && (
            <span className="rounded border border-border bg-muted/60 px-1 font-mono text-[11px] font-normal text-muted-foreground">
              {venda.code}
            </span>
          )}
        </DialogTitle>
        <DialogDescription>
          Do procedimento ao pagamento, nesta janela. Só é venda com o termo
          assinado e o pagamento confirmado.
        </DialogDescription>
      </DialogHeader>

      <div className="-mx-1 min-h-40 space-y-4 overflow-y-auto px-1 pb-1">
        {erro ? (
          <p className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">
            {erro}
          </p>
        ) : !dados ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Abrindo o caixa…
          </p>
        ) : saleId && !venda ? (
          <p className="rounded-lg border bg-muted/40 p-3 text-sm">
            Esta venda não está mais disponível para você nesta unidade.
          </p>
        ) : venda ? (
          <VendaLancada
            venda={venda}
            dados={dados}
            termoErro={termoErro}
            atualizar={recarregar}
            trocandoPagamento={trocandoPagamento}
            setTrocandoPagamento={setTrocandoPagamento}
            isPending={isPending}
            startTransition={startTransition}
            depois={depois}
            onClose={onClose}
            novaVenda={() => {
              setSaleId(null);
              setTrocandoPagamento(false);
            }}
          />
        ) : (
          <VendaNova
            dados={dados}
            appointmentIdInicial={alvo.appointmentId ?? null}
            recarregar={recarregar}
            isPending={isPending}
            startTransition={startTransition}
            onLancada={async (id, fechar, erroDoTermo) => {
              setTermoErro(erroDoTermo ?? null);
              await depois();
              if (fechar) onClose();
              else setSaleId(id);
            }}
          />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// O bloco "COMO PAGA" — o mesmo na venda nova e na venda já lançada.
// ---------------------------------------------------------------------------

type BasesDoPagamento = {
  subtotalCents: number;
  programDiscountCents: number;
  coveredCents: number;
  rule: CommercialRule;
  plano: DirectSaleRow["programConditions"];
  isProgramMember: boolean;
  isManager: boolean;
  cardMachine: boolean;
};

type EstadoDoPagamento = {
  meio: MetodoVendaNova | "";
  parcelas: number;
  ajuste: Ajuste;
  ajusteValor: string;
  /** Parcelas mexidas à mão, com a "assinatura" das condições em que valiam. */
  custom: { sig: string; entries: ScheduleEntry[] } | null;
};

function usePagamento(bases: BasesDoPagamento, inicial?: Partial<EstadoDoPagamento>) {
  const quem = useMemo(
    () => ({ isManager: bases.isManager, cardMachine: bases.cardMachine }),
    [bases.isManager, bases.cardMachine]
  );
  const meios = useMemo(() => meiosDoCaixa(bases.rule, quem), [bases.rule, quem]);
  const [estado, setEstado] = useState<EstadoDoPagamento>(() => ({
    meio:
      inicial?.meio && meios.includes(inicial.meio as MetodoVendaNova)
        ? (inicial.meio as MetodoVendaNova)
        : meioInicial(meios),
    parcelas: inicial?.parcelas ?? 1,
    ajuste: inicial?.ajuste ?? "none",
    ajusteValor: inicial?.ajusteValor ?? "",
    custom: null,
  }));

  const aPagar = Math.max(0, bases.subtotalCents - bases.programDiscountCents);
  const baseDoDesconto = Math.max(0, aPagar - bases.coveredCents);
  const valor = Number((estado.ajusteValor || "0").replace(",", ".")) || 0;
  const descontoManualCents =
    estado.ajuste === "desc_reais"
      ? Math.round(valor * 100)
      : estado.ajuste === "desc_pct"
        ? Math.round((baseDoDesconto * valor) / 100)
        : 0;
  const acrescimoCents = estado.ajuste === "acresc" ? Math.round(valor * 100) : 0;

  const previaEm = useCallback(
    (parcelas: number, meio: string | null) =>
      previaDoCaixa({
        subtotalCents: bases.subtotalCents,
        programDiscountCents: bases.programDiscountCents,
        coveredCents: bases.coveredCents,
        rule: bases.rule,
        parcelas,
        meio,
        isProgramMember: bases.isProgramMember,
        plano: bases.plano ?? null,
        descontoManualCents,
        acrescimoCents,
      }),
    [bases, descontoManualCents, acrescimoCents]
  );

  const opcoes = useMemo(
    () =>
      estado.meio
        ? parcelasDoMeio(estado.meio, bases.rule, quem, (n) =>
            previaEm(n, estado.meio).finalCents
          )
        : [],
    [estado.meio, bases.rule, quem, previaEm]
  );
  // A quantidade escolhida sempre vale para o meio (se deixou de valer ao
  // mudar o total, cai na menor possível).
  const parcelas = parcelasAoTrocarDeMeio(estado.parcelas, opcoes);
  const previa = previaEm(parcelas, estado.meio || null);

  const violacoes = useMemo(
    () =>
      estado.meio
        ? directSaleViolations(
            {
              subtotalCents: bases.subtotalCents,
              programDiscountCents: bases.programDiscountCents,
              discountCents: previa.discountCents,
              surchargeCents: previa.surchargeCents,
              installments: parcelas,
              paymentMethod: meioParaARegra(estado.meio) as PaymentMethod | null,
            },
            bases.rule,
            { isManager: bases.isManager }
          )
        : [],
    [bases, estado.meio, parcelas, previa.discountCents, previa.surchargeCents]
  );

  const sig = `${estado.meio}|${parcelas}|${previa.finalCents}`;
  const automatico = useMemo(
    () =>
      previa.finalCents > 0
        ? buildSchedule({
            totalCents: previa.finalCents,
            downPaymentCents: 0,
            installments: parcelas,
            firstDueDate: todayInBrazil(),
          })
        : [],
    [previa.finalCents, parcelas]
  );
  const entries = estado.custom?.sig === sig ? estado.custom.entries : automatico;

  const paraEnviar: PagamentoDoCaixa = {
    paymentMethod: estado.meio,
    installments: parcelas,
    discountReais: previa.discountCents > 0 ? centsToInput(previa.discountCents) : "",
    surchargeReais: previa.surchargeCents > 0 ? centsToInput(previa.surchargeCents) : "",
    entries: estado.custom?.sig === sig ? estado.custom.entries : undefined,
  };

  return {
    estado,
    setEstado,
    meios,
    opcoes,
    parcelas,
    previa,
    violacoes,
    entries,
    sig,
    baseDoDesconto,
    aPagar,
    paraEnviar,
    pronto: Boolean(estado.meio) && violacoes.length === 0 && opcoes.length > 0,
  };
}

function BlocoPagamento({
  bases,
  p,
}: {
  bases: BasesDoPagamento;
  p: ReturnType<typeof usePagamento>;
}) {
  const [ajustando, setAjustando] = useState(p.estado.ajuste !== "none");
  const [parcelasAbertas, setParcelasAbertas] = useState(false);
  const [todasAsParcelas, setTodasAsParcelas] = useState(false);
  const { estado, setEstado } = p;

  if (p.aPagar <= 0) {
    return (
      <p className="rounded-lg border border-emerald-300 bg-emerald-50 p-2.5 text-sm text-emerald-900">
        Totalmente coberto pelo programa — não há valor a pagar.
      </p>
    );
  }
  if (p.meios.length === 0) {
    return (
      <p className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
        A regra comercial desta unidade não libera nenhum meio de pagamento
        para a venda direta. Fale com o Gerente.
      </p>
    );
  }

  const trocarMeio = (m: MetodoVendaNova) => {
    const opcoes = parcelasDoMeio(
      m,
      bases.rule,
      { isManager: bases.isManager, cardMachine: bases.cardMachine },
      () => p.previa.finalCents
    );
    setEstado((e) => ({
      ...e,
      meio: m,
      parcelas: parcelasAoTrocarDeMeio(e.parcelas, opcoes),
    }));
  };

  const meiosDaParcela = meiosDaVendaNova({
    installments: p.parcelas,
    isManager: bases.isManager,
    cardMachine: bases.cardMachine,
    allowed: bases.rule.allowedMethods ?? null,
  }).map((m) => ({ valor: m, rotulo: ROTULO_METODO_VENDA_NOVA[m] }));

  const maxDescontoCents =
    bases.rule.maxDiscountPercent != null
      ? Math.round((p.baseDoDesconto * bases.rule.maxDiscountPercent) / 100)
      : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Meio de pagamento">
        {p.meios.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={estado.meio === m}
            onClick={() => trocarMeio(m)}
            className={cn(
              "h-10 rounded-lg border px-3.5 text-sm font-medium transition-colors",
              estado.meio === m
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background hover:bg-muted"
            )}
          >
            {ROTULO_DO_BOTAO[m]}
          </button>
        ))}
      </div>

      {p.opcoes.length === 0 ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          {ROTULO_DO_BOTAO[estado.meio as MetodoVendaNova]} não cabe nesta
          venda (só parcelado, e a parcela ficaria abaixo do mínimo). Escolha
          outro meio.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Parcelas">
          {p.opcoes
            .filter(
              (o, i) => todasAsParcelas || i < 6 || o.parcelas === p.parcelas
            )
            .map((o) => (
            <button
              key={o.parcelas}
              type="button"
              role="radio"
              aria-checked={p.parcelas === o.parcelas}
              onClick={() => setEstado((e) => ({ ...e, parcelas: o.parcelas }))}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-left text-xs tabular-nums transition-colors",
                p.parcelas === o.parcelas
                  ? "border-primary bg-primary/10 font-semibold"
                  : "bg-background hover:bg-muted"
              )}
            >
              {o.parcelas === 1
                ? `À vista ${formatBRL(o.totalCents)}`
                : `${o.parcelas}× ${formatBRL(o.parcelaCents)}`}
            </button>
          ))}
          {p.opcoes.length > 6 && (
            <button
              type="button"
              className="px-1.5 text-xs text-primary hover:underline"
              onClick={() => setTodasAsParcelas((v) => !v)}
            >
              {todasAsParcelas
                ? "menos parcelas"
                : `mais parcelas (até ${p.opcoes[p.opcoes.length - 1].parcelas}×)`}
            </button>
          )}
        </div>
      )}
      {estado.meio && !p.opcoes.some((o) => o.parcelas === 1) && p.opcoes.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          À vista é só Pix, dinheiro ou permuta — {ROTULO_DO_BOTAO[estado.meio]} começa em 2×.
        </p>
      )}

      {/* O desconto automático se explica em uma linha. */}
      {p.previa.origem === "avista" && (
        <p className="text-xs text-emerald-800">
          À vista: −{p.previa.autoPercent}% da regra da unidade (
          {formatBRL(p.previa.discountCents)}).
        </p>
      )}
      {bases.plano && (
        <p className="text-xs text-gold-tinta">
          ★ PPR+ {bases.plano.planName}:{" "}
          {p.previa.discountCents > 0
            ? `−${p.previa.autoPercent}% nesta quantidade de parcelas (${formatBRL(p.previa.discountCents)}).`
            : "sem desconto nesta quantidade de parcelas."}
        </p>
      )}

      {/* O que é raro fica atrás de um link. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {!bases.plano && !bases.isProgramMember && (
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => {
              if (ajustando) setEstado((e) => ({ ...e, ajuste: "none", ajusteValor: "" }));
              else setEstado((e) => ({ ...e, ajuste: "desc_reais" }));
              setAjustando((v) => !v);
            }}
          >
            {ajustando ? "Tirar o ajuste" : bases.isManager ? "Dar desconto ou acréscimo" : "Dar desconto"}
          </button>
        )}
        {p.previa.finalCents > 0 && (
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => setParcelasAbertas((v) => !v)}
          >
            {parcelasAbertas ? "Fechar as parcelas" : "Ajustar parcelas (datas, valores, meio de cada uma)"}
          </button>
        )}
      </div>

      {ajustando && !bases.plano && !bases.isProgramMember && (
        <div>
          <div className="flex gap-2">
            <select
              aria-label="Tipo de ajuste"
              value={estado.ajuste}
              onChange={(e) => setEstado((s) => ({ ...s, ajuste: e.target.value as Ajuste }))}
              className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
            >
              <option value="desc_reais">Desconto (R$)</option>
              <option value="desc_pct">Desconto (%)</option>
              {bases.isManager && <option value="acresc">Acréscimo (R$)</option>}
            </select>
            <input
              aria-label="Valor do ajuste"
              value={estado.ajusteValor}
              onChange={(e) => setEstado((s) => ({ ...s, ajusteValor: e.target.value }))}
              inputMode="decimal"
              placeholder={estado.ajuste === "desc_pct" ? "%" : "R$"}
              className="h-9 w-32 rounded-lg border border-input bg-background px-2 text-sm"
            />
          </div>
          {estado.ajuste !== "acresc" &&
            (maxDescontoCents != null ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Desconto máximo: {formatBRL(maxDescontoCents)} (
                {bases.rule.maxDiscountPercent}% de {formatBRL(p.baseDoDesconto)}).
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-rose-700">
                A rede não configurou desconto — não é permitido nesta unidade.
              </p>
            ))}
        </div>
      )}

      {parcelasAbertas && p.previa.finalCents > 0 && (
        <PaymentScheduleEditor
          entries={p.entries}
          onChange={(next) => setEstado((e) => ({ ...e, custom: { sig: p.sig, entries: next } }))}
          totalCents={p.previa.finalCents}
          minInstallmentCents={null}
          meios={meiosDaParcela}
          meioPadrao={estado.meio || null}
        />
      )}

      {p.violacoes.length > 0 && (
        <ul className="rounded-lg border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800">
          {p.violacoes.map((v) => (
            <li key={v} className="flex items-start gap-1.5">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {v}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Total({ p, bases }: { p: ReturnType<typeof usePagamento>; bases: BasesDoPagamento }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
      <span className="text-xs text-muted-foreground">
        {bases.programDiscountCents > 0 && (
          <>programa −{formatBRL(bases.programDiscountCents)} · </>
        )}
        {p.previa.discountCents > 0 && <>desconto −{formatBRL(p.previa.discountCents)} · </>}
        {p.previa.surchargeCents > 0 && <>acréscimo +{formatBRL(p.previa.surchargeCents)} · </>}
        {p.estado.meio && p.previa.finalCents > 0
          ? p.parcelas > 1
            ? `${p.parcelas}× de ${formatBRL(Math.ceil(p.previa.finalCents / p.parcelas))} · ${ROTULO_DO_BOTAO[p.estado.meio]}`
            : `à vista · ${ROTULO_DO_BOTAO[p.estado.meio]}`
          : ""}
      </span>
      <span className="text-lg font-semibold tabular-nums">
        Total {formatBRL(p.previa.finalCents)}
      </span>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </h3>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// VENDA NOVA — o que vende + como paga + Finalizar.
// ---------------------------------------------------------------------------

function VendaNova({
  dados,
  appointmentIdInicial,
  isPending,
  startTransition,
  onLancada,
  recarregar,
}: {
  dados: DadosDoCaixa;
  /** VD3-4: relê o caixa (o encaixe recém-criado entra na lista). */
  recarregar: () => Promise<void>;
  appointmentIdInicial: string | null;
  isPending: boolean;
  startTransition: (fn: () => Promise<void>) => void;
  onLancada: (saleId: string, fechar: boolean, termoErro?: string) => Promise<void>;
}) {
  const ctx = dados.contexto;
  const [agora] = useState(() => new Date());
  const [appointmentId, setAppointmentId] = useState(
    () =>
      (appointmentIdInicial &&
      ctx.appointments.some((a) => a.id === appointmentIdInicial)
        ? appointmentIdInicial
        : "") || atendimentoPadrao(ctx.appointments, agora, diaDe)
  );
  const [trocandoAtendimento, setTrocandoAtendimento] = useState(false);
  // VD3-4: o bloco "Atender agora" (encaixe) aberto.
  const [encaixe, setEncaixe] = useState(false);
  const temAtendimentoHoje = ctx.appointments.some((a) => diaDe(new Date(a.startsAt)) === diaDe(agora));
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [notes, setNotes] = useState("");
  const [comObs, setComObs] = useState(false);

  const escolhido = ctx.appointments.find((a) => a.id === appointmentId) ?? null;
  const excecao = atendidoAntesDaVenda(escolhido, agora, diaDe);
  const atalhos = useMemo(
    () => atalhosDoCaixa(ctx.procedures, dados.vendidos, 6),
    [ctx.procedures, dados.vendidos]
  );

  const somar = (procedureId: string) => {
    if (!procedureId) return;
    setLinhas((prev) =>
      prev.some((l) => l.procedureId === procedureId)
        ? prev.map((l) =>
            l.procedureId === procedureId ? { ...l, quantity: l.quantity + 1 } : l
          )
        : [...prev, { procedureId, quantity: 1 }]
    );
  };

  const bases: BasesDoPagamento = useMemo(() => {
    let subtotal = 0;
    let programa = 0;
    let coberto = 0;
    for (const l of linhas) {
      const proc = ctx.procedures.find((x) => x.id === l.procedureId);
      if (!proc) continue;
      subtotal += proc.unitPriceCents * l.quantity;
      programa += proc.programDiscountCents * l.quantity;
      if (proc.programDiscountCents > 0)
        coberto += (proc.unitPriceCents - proc.programDiscountCents) * l.quantity;
    }
    return {
      subtotalCents: subtotal,
      programDiscountCents: programa,
      coveredCents: coberto,
      rule: ctx.rule,
      plano: ctx.programConditions ?? null,
      isProgramMember: ctx.programActive,
      isManager: ctx.isManager,
      cardMachine: ctx.cardMachine,
    };
  }, [linhas, ctx]);
  const p = usePagamento(bases);

  const semValor = p.aPagar <= 0;
  const podeFinalizar =
    Boolean(appointmentId) &&
    linhas.length > 0 &&
    (!ctx.canClose || semValor || p.pronto);

  function finalizar() {
    startTransition(async () => {
      const r = await finalizarVendaDireta(dados.clientId, {
        appointmentId,
        items: linhas,
        notes,
        pagamento: ctx.canClose && !semValor ? p.paraEnviar : undefined,
      });
      if (r.ok && r.saleId) {
        if (ctx.canClose) {
          if (r.termoErro) toast.warning(`Venda lançada, mas o termo não saiu: ${r.termoErro}`);
          else toast.success("Venda lançada e termo enviado. Agora: assinar e receber.");
          await onLancada(r.saleId, false, r.termoErro);
        } else {
          toast.success("Venda enviada para a recepção fechar.");
          await onLancada(r.saleId, true);
        }
      } else if (r.saleId) {
        // A venda existe; o pagamento é que não entrou — segue na janela.
        toast.error(r.error ?? "O pagamento não entrou.");
        await onLancada(r.saleId, false);
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  if (!ctx.canLaunch) {
    return (
      <p className="rounded-lg border bg-muted/40 p-3 text-sm">
        Nenhum procedimento está liberado para você lançar em venda direta. O
        Admin configura isso em Procedimentos.
      </p>
    );
  }

  return (
    <>
      <Secao titulo="Atendimento">
        {escolhido && !trocandoAtendimento ? (
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
            <span>
              {formatBrDateTime(escolhido.startsAt)} ·{" "}
              {TIPO_DO_ATENDIMENTO[escolhido.type] ?? escolhido.type}
              {escolhido.providerName ? ` · ${escolhido.providerName}` : ""}
            </span>
            {ctx.appointments.length > 1 && (
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => setTrocandoAtendimento(true)}
              >
                trocar
              </button>
            )}
          </p>
        ) : ctx.appointments.length === 0 ? (
          // VD3-4: sem atendimento, o encaixe nasce aqui mesmo.
          <AtenderAgora
            clientId={dados.clientId}
            aoCriar={async (id) => {
              await recarregar();
              setAppointmentId(id);
              setTrocandoAtendimento(false);
            }}
          />
        ) : (
          <select
            aria-label="Atendimento relacionado"
            value={appointmentId}
            onChange={(e) => {
              setAppointmentId(e.target.value);
              setTrocandoAtendimento(false);
            }}
            className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
          >
            <option value="">Escolher o atendimento…</option>
            {ctx.appointments.map((a) => (
              <option key={a.id} value={a.id}>
                {formatBrDateTime(a.startsAt)} · {TIPO_DO_ATENDIMENTO[a.type] ?? a.type}
                {a.providerName ? ` · ${a.providerName}` : ""}
              </option>
            ))}
          </select>
        )}
        {ctx.appointments.length > 0 && !temAtendimentoHoje && (
          encaixe ? (
            <AtenderAgora
              clientId={dados.clientId}
              aoFechar={() => setEncaixe(false)}
              aoCriar={async (id) => {
                await recarregar();
                setAppointmentId(id);
                setTrocandoAtendimento(false);
                setEncaixe(false);
              }}
            />
          ) : (
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => setEncaixe(true)}
            >
              Sem atendimento hoje? Atender agora (encaixe)
            </button>
          )
        )}
        {excecao && (
          <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Este atendimento já aconteceu. A venda entra como{" "}
              <strong>exceção</strong> (o certo é vender antes de atender) e o
              Gerente e o Franqueado são avisados.
            </span>
          </p>
        )}
      </Secao>

      <Secao titulo="O que">
        <div className="flex flex-wrap gap-1.5">
          {atalhos.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => somar(a.id)}
              className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              {a.name}
            </button>
          ))}
        </div>
        <ListaComBusca
          aria-label="Buscar outro procedimento"
          value=""
          onValueChange={somar}
          className="w-full"
          options={[
            { value: "", label: "Buscar outro procedimento…" },
            ...ctx.procedures.map((proc) => ({
              value: proc.id,
              label:
                `${proc.name} — ${formatBRL(proc.unitPriceCents)}` +
                (proc.programDiscountCents > 0
                  ? proc.programDiscountCents >= proc.unitPriceCents
                    ? " · SEM CUSTO pelo programa"
                    : ` · -${formatBRL(proc.programDiscountCents)} pelo programa`
                  : ""),
            })),
          ]}
        />
        {linhas.length > 0 && (
          <ul className="space-y-1">
            {linhas.map((l) => {
              const proc = ctx.procedures.find((x) => x.id === l.procedureId);
              if (!proc) return null;
              const cheio = proc.unitPriceCents * l.quantity;
              const desc = proc.programDiscountCents * l.quantity;
              return (
                <li
                  key={l.procedureId}
                  className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    {proc.name}
                    {proc.giftLabel && (
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-gold-foreground">
                        <Gift className="size-3" /> Entregar ao cliente: {proc.giftLabel}
                      </span>
                    )}
                    {proc.benefitBlockedReason && (
                      <span className="mt-0.5 flex items-start gap-1 text-[11px] text-amber-800">
                        <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                        Benefício não liberado: {proc.benefitBlockedReason} Paga o valor normal.
                      </span>
                    )}
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={l.quantity}
                    onChange={(e) =>
                      setLinhas((prev) =>
                        prev.map((x) =>
                          x.procedureId === l.procedureId
                            ? { ...x, quantity: Math.max(1, Number.parseInt(e.target.value, 10) || 1) }
                            : x
                        )
                      )
                    }
                    className="h-8 w-14 rounded-md border border-input bg-transparent px-1.5 text-sm"
                    aria-label={`Quantidade de ${proc.name}`}
                  />
                  <span className="text-xs tabular-nums">
                    {desc > 0 ? (
                      <>
                        <span className="line-through opacity-60">{formatBRL(cheio)}</span>{" "}
                        <span className="font-medium text-gold-tinta">{formatBRL(cheio - desc)}</span>
                      </>
                    ) : (
                      formatBRL(cheio)
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLinhas((prev) => prev.filter((x) => x.procedureId !== l.procedureId))}
                    aria-label={`Remover ${proc.name}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {comObs ? (
          <textarea
            aria-label="Observações"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Observações (opcional)"
            className="min-h-14 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
          />
        ) : (
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => setComObs(true)}
          >
            Adicionar observação
          </button>
        )}
      </Secao>

      {linhas.length > 0 && ctx.canClose && (
        <Secao titulo="Como paga">
          <BlocoPagamento bases={bases} p={p} />
        </Secao>
      )}

      {linhas.length > 0 && <Total p={p} bases={bases} />}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {!ctx.canClose && linhas.length > 0 && (
          <span className="mr-auto text-xs text-muted-foreground">
            A recepção ou o Gerente definem o pagamento e fecham a venda.
          </span>
        )}
        <Button disabled={isPending || !podeFinalizar} onClick={finalizar} className="h-10">
          {isPending ? (
            <Loader2 className="mr-1 size-4 animate-spin" />
          ) : null}
          {ctx.canClose ? "Finalizar: assinar e receber" : "Enviar para a recepção"}
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// VENDA JÁ LANÇADA — definir o pagamento (se falta) ou assinar e receber.
// ---------------------------------------------------------------------------

function VendaLancada({
  venda,
  dados,
  termoErro,
  atualizar,
  trocandoPagamento,
  setTrocandoPagamento,
  isPending,
  startTransition,
  depois,
  onClose,
  novaVenda,
}: {
  venda: DirectSaleRow;
  dados: DadosDoCaixa;
  termoErro: string | null;
  atualizar: () => Promise<void>;
  trocandoPagamento: boolean;
  setTrocandoPagamento: (v: boolean) => void;
  isPending: boolean;
  startTransition: (fn: () => Promise<void>) => void;
  depois: () => Promise<void>;
  onClose: () => void;
  novaVenda: () => void;
}) {
  const etapa = etapaDoCaixa({
    cancelled: venda.cancelled,
    closed: venda.status === "concluida",
    finalCents: venda.finalCents,
    paymentMethod: venda.paymentMethod,
    contractSigned: venda.contractSigned,
    paymentConfirmed: venda.paymentConfirmed,
  });
  const brindes = venda.items.filter((i) => i.giftLabel);

  const itens =
    venda.items.length === 0 ? (
      <p className="text-xs text-muted-foreground">
        Esta venda não tem procedimento registrado.
      </p>
    ) : (
    <ul className="space-y-0.5 text-sm">
      {venda.items.map((i, idx) => (
        <li key={idx} className="flex justify-between gap-2">
          <span className="min-w-0">
            {i.description}
            {i.quantity > 1 ? ` ×${i.quantity}` : ""}
            {i.programDiscountCents > 0 && (
              <span className="ml-1 text-xs text-gold-tinta">
                ★ −{formatBRL(i.programDiscountCents)}
              </span>
            )}
          </span>
          <span className="shrink-0 tabular-nums">{formatBRL(i.finalCents)}</span>
        </li>
      ))}
    </ul>
  );

  if (etapa === "cancelada") {
    return (
      <>
        <Secao titulo="O que">{itens}</Secao>
        <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          Venda cancelada — os procedimentos dela foram cancelados no prontuário.
        </p>
      </>
    );
  }

  if (etapa === "concluida") {
    return (
      <>
        <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-emerald-900">
          <PartyPopper className="size-5 shrink-0" />
          <span className="text-sm font-medium">
            Venda concluída — termo assinado e pagamento confirmado.
          </span>
        </div>
        {brindes.length > 0 && (
          <ul className="rounded-lg border border-gold/40 bg-gold/5 p-2.5 text-sm">
            {brindes.map((b, i) => (
              <li key={i} className="flex items-center gap-1.5 font-medium text-gold-foreground">
                <Gift className="size-4" /> Entregar ao cliente: {b.giftLabel}
              </li>
            ))}
          </ul>
        )}
        <Secao titulo="O que">{itens}</Secao>
        <ResumoFechado venda={venda} />
        <BotaoComprovante venda={venda} dados={dados} />
        {venda.clientId && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">⋯ Mais</summary>
            <div className="mt-2">
              {/* 4020: a venda concluída só se desfaz pelo distrato. */}
              <DistratoDaVenda clientId={venda.clientId} directSaleId={venda.id} />
            </div>
          </details>
        )}
        <div className="flex justify-end gap-2">
          {dados.contexto.canLaunch && (
            <Button variant="outline" onClick={novaVenda}>
              Nova venda
            </Button>
          )}
          <Button onClick={onClose}>Fechar</Button>
        </div>
      </>
    );
  }

  if (!venda.canClose) {
    return (
      <>
        <Secao titulo="O que">{itens}</Secao>
        <ResumoFechado venda={venda} />
        <p className="flex items-center gap-1.5 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Wallet className="size-4" />
          Aguardando a recepção ou o Gerente definir o pagamento e fechar.
        </p>
      </>
    );
  }

  if (etapa === "pagamento" || trocandoPagamento) {
    return (
      <DefinirPagamento
        venda={venda}
        itens={itens}
        isPending={isPending}
        startTransition={startTransition}
        podeVoltar={trocandoPagamento && etapa !== "pagamento"}
        voltar={() => setTrocandoPagamento(false)}
        depois={async () => {
          setTrocandoPagamento(false);
          await depois();
        }}
      />
    );
  }

  return (
    <>
      <Secao titulo="O que">{itens}</Secao>
      <ResumoFechado venda={venda} />
      <Fechamento
        venda={venda}
        clientName={dados.clientName}
        clientPhone={dados.clientPhone ?? null}
        termo={dados.termos?.[venda.id]}
        termoErro={termoErro}
        atualizar={atualizar}
        isPending={isPending}
        startTransition={startTransition}
        depois={depois}
        trocarPagamento={() => setTrocandoPagamento(true)}
      />
    </>
  );
}

function ResumoFechado({ venda }: { venda: DirectSaleRow }) {
  const meio = venda.paymentMethod
    ? (ROTULO_DO_BOTAO[venda.paymentMethod as MetodoVendaNova] ?? venda.paymentMethod)
    : null;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
      <span className="text-xs text-muted-foreground">
        {venda.programDiscountCents > 0 && <>programa −{formatBRL(venda.programDiscountCents)} · </>}
        {venda.discountCents > 0 && <>desconto −{formatBRL(venda.discountCents)} · </>}
        {venda.surchargeCents > 0 && <>acréscimo +{formatBRL(venda.surchargeCents)} · </>}
        {venda.finalCents > 0 && meio
          ? venda.installments > 1
            ? `${venda.installments}× de ${formatBRL(Math.ceil(venda.finalCents / venda.installments))} · ${meio}`
            : `à vista · ${meio}`
          : venda.finalCents <= 0
            ? "coberto pelo programa"
            : ""}
      </span>
      <span className="text-lg font-semibold tabular-nums">Total {formatBRL(venda.finalCents)}</span>
    </div>
  );
}

function DefinirPagamento({
  venda,
  itens,
  isPending,
  startTransition,
  podeVoltar,
  voltar,
  depois,
}: {
  venda: DirectSaleRow;
  itens: React.ReactNode;
  isPending: boolean;
  startTransition: (fn: () => Promise<void>) => void;
  podeVoltar: boolean;
  voltar: () => void;
  depois: () => Promise<void>;
}) {
  const bases: BasesDoPagamento = useMemo(
    () => ({
      subtotalCents: venda.subtotalCents,
      programDiscountCents: venda.programDiscountCents,
      coveredCents: venda.items
        .filter((i) => i.programDiscountCents > 0)
        .reduce((s, i) => s + i.finalCents, 0),
      rule: venda.rule,
      plano: venda.programConditions ?? null,
      isProgramMember: venda.isProgramMember,
      isManager: venda.isManager,
      cardMachine: venda.cardMachine ?? true,
    }),
    [venda]
  );
  const p = usePagamento(bases, {
    meio: (venda.paymentMethod as MetodoVendaNova | null) ?? undefined,
    parcelas: Math.max(1, venda.installments),
    ajuste: venda.surchargeCents > 0 ? "acresc" : "none",
    ajusteValor: venda.surchargeCents > 0 ? centsToInput(venda.surchargeCents) : "",
  });

  if (!ehVendaNova(venda.methodRule)) {
    return (
      <>
        <Secao titulo="O que">{itens}</Secao>
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Esta é uma venda direta antiga (anterior aos meios pelo Asaas). O
          pagamento dela se define em <strong>Comercial → Venda direta</strong>.
        </p>
      </>
    );
  }

  function salvar() {
    startTransition(async () => {
      const r = await comConfirmacaoDeBoletos((confirmar) =>
        salvarPagamentoDaVenda(venda.id, p.paraEnviar, confirmar)
      );
      if (r.ok) {
        // VD3-2: o termo sai junto, como no Finalizar (só sem termo assinado;
        // o banco recusa o 2º termo vivo da mesma venda).
        if (!venda.contractSigned) {
          const t = await enviarTermo(venda.id);
          if (t.ok || /já foi enviado/.test(t.error ?? "")) toast.success("Pagamento definido e termo enviado.");
          else toast.warning(`Pagamento definido, mas o termo não saiu: ${t.error ?? "erro"}`);
        } else toast.success("Pagamento definido.");
        await depois();
      } else toast.error(r.error ?? "Não foi possível salvar o pagamento.");
    });
  }

  return (
    <>
      <Secao titulo="O que">{itens}</Secao>
      <Secao titulo="Como paga">
        <BlocoPagamento bases={bases} p={p} />
      </Secao>
      <Total p={p} bases={bases} />
      <div className="flex justify-end gap-2">
        {podeVoltar && (
          <Button variant="outline" onClick={voltar} disabled={isPending}>
            Voltar
          </Button>
        )}
        <Button className="h-10" disabled={isPending || !p.pronto} onClick={salvar}>
          {isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
          Continuar: assinar e receber
        </Button>
      </div>
    </>
  );
}

function Caixa({
  icone,
  titulo,
  feito,
  feitoTexto,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  feito: boolean;
  feitoTexto: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex-1 space-y-2 rounded-xl border p-3",
        feito
          ? "border-emerald-300 bg-emerald-50/70 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200"
          : "bg-card"
      )}
    >
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        {feito ? (
          <CheckCircle2 className="size-4 text-emerald-600" />
        ) : (
          <CircleDot className="size-4 text-muted-foreground" />
        )}
        {icone}
        {titulo}
      </p>
      {feito ? <p className="text-sm">{feitoTexto}</p> : children}
    </div>
  );
}

function Fechamento({
  venda,
  clientName,
  clientPhone,
  termo,
  termoErro,
  atualizar,
  isPending,
  startTransition,
  depois,
  trocarPagamento,
}: {
  venda: DirectSaleRow;
  clientName: string;
  clientPhone: string | null;
  /** VD3-2: ausente quando o banco ainda não tem a 0415 (vale o jeito antigo). */
  termo: import("@/app/(app)/comercial/venda-direta/caixa-actions").TermoDaVenda | undefined;
  termoErro: string | null;
  atualizar: () => Promise<void>;
  isPending: boolean;
  startTransition: (fn: () => Promise<void>) => void;
  depois: () => Promise<void>;
  trocarPagamento: () => void;
}) {
  const zero = venda.finalCents <= 0;
  const proxima = venda.nextDue ?? null;
  const meioDaVez = proxima?.paymentMethod ?? venda.paymentMethod;
  const balcao = !zero && recebidoNoBalcao(meioDaVez);
  const permuta = meioDaVez === "permuta";
  const [permutaTexto, setPermutaTexto] = useState("");
  const [comAcordo, setComAcordo] = useState(false);
  // Um token por janela aberta: duplo clique não vira dois recebimentos.
  const [token] = useState(() => crypto.randomUUID());

  const agir = (
    fazer: () => Promise<{ ok: boolean; error?: string; closed?: boolean }>,
    okMsg: string
  ) =>
    startTransition(async () => {
      const r = await fazer();
      if (r.ok) {
        toast.success(r.closed ? "Venda direta CONCLUÍDA! 🎉" : okMsg);
        await depois();
      } else toast.error(r.error ?? "Algo deu errado.");
    });

  function cancelar() {
    startTransition(async () => {
      const r = await comConfirmacaoDeBoletos((confirmar) => cancelDirectSale(venda.id, confirmar));
      if (r.ok) {
        toast.success("Venda cancelada.");
        await depois();
      } else {
        if ("acordo" in r && r.acordo) setComAcordo(true);
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  const valorDaVez = proxima?.amountCents ?? venda.finalCents;

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Caixa
          icone={<FileSignature className="size-4" />}
          titulo="Termo"
          feito={venda.contractSigned}
          feitoTexto={textoDoTermoAssinado(termo, venda.contractSignedByName)}
        >
          {termo ? (
            <AcoesDoTermo
              saleId={venda.id}
              termo={termo}
              termoErro={termoErro}
              atualizar={atualizar}
            />
          ) : (
            <>
              {/* Banco sem a 0415: o jeito de antes, até a migração rodar. */}
              <p className="text-xs text-muted-foreground">
                O cliente assina o termo da venda. Marque aqui quando estiver
                assinado.
              </p>
              <Button
                className="h-10 w-full"
                disabled={isPending}
                onClick={() =>
                  agir(() => closeDirectSaleStep(venda.id, "contract", true), "Termo assinado.")
                }
              >
                Termo assinado
              </Button>
            </>
          )}
        </Caixa>

        <Caixa
          icone={<Wallet className="size-4" />}
          titulo="Pagamento"
          feito={venda.paymentConfirmed}
          feitoTexto={
            venda.paymentConfirmedByName
              ? `Confirmado por ${venda.paymentConfirmedByName}.`
              : "Confirmado."
          }
        >
          {zero ? (
            <>
              <p className="text-xs text-muted-foreground">
                Sem valor a pagar — coberto pelo programa.
              </p>
              <Button
                className="h-10 w-full"
                disabled={isPending}
                onClick={() => agir(() => confirmarRecebimento(venda.id), "Pagamento confirmado.")}
              >
                Confirmar (R$ 0,00)
              </Button>
            </>
          ) : balcao ? (
            <>
              {permuta && (
                <input
                  aria-label="Descrição da permuta"
                  value={permutaTexto}
                  onChange={(e) => setPermutaTexto(e.target.value)}
                  placeholder="Permuta: o que foi trocado e com quem"
                  className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                />
              )}
              <Button
                className="h-10 w-full"
                disabled={
                  isPending || !venda.contractSigned || (permuta && !permutaTexto.trim())
                }
                onClick={() =>
                  agir(
                    () =>
                      comConfirmacaoDeBoletos((confirmar) =>
                        receberNoBalcao({
                          saleId: venda.id,
                          clientToken: token,
                          notes: permutaTexto,
                          confirmarCancelamento: confirmar,
                        })
                      ),
                    "Recebimento registrado."
                  )
                }
              >
                Recebi {formatBRL(valorDaVez)}{" "}
                {permuta
                  ? "em permuta"
                  : meioDaVez === "cartao_parcelado"
                    ? "na maquininha"
                    : "em dinheiro"}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                {!venda.contractSigned
                  ? "Libera depois do termo assinado."
                  : venda.installments > 1
                    ? "É a baixa da 1ª cobrança: entra no Financeiro e conclui a venda. As demais ficam em Recebíveis."
                    : "Dá a baixa no Financeiro e conclui a venda."}
              </p>
            </>
          ) : !venda.contractSigned ? (
            <p className="text-xs text-muted-foreground">
              A cobrança ({ROTULO_DO_BOTAO[meioDaVez as MetodoVendaNova] ?? "Asaas"})
              aparece aqui depois do termo assinado.
            </p>
          ) : (
            <>
              {ehVendaNova(venda.methodRule) && (
                <PagamentoPeloAsaas
                  saleId={venda.id}
                  clientName={clientName}
                  clientPhone={clientPhone}
                  atualizar={atualizar}
                />
              )}
              <p className="text-[11px] text-muted-foreground">
                Pago pelo Asaas, a confirmação chega sozinha. Se a unidade
                ainda não usa o Asaas, confirme aqui quando receber.
              </p>
              <Button
                variant="outline"
                className="h-9 w-full"
                disabled={isPending}
                onClick={() => agir(() => confirmarRecebimento(venda.id), "Pagamento confirmado.")}
              >
                Confirmar que recebeu {formatBRL(valorDaVez)}
              </Button>
            </>
          )}
        </Caixa>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">⋯ Mais</summary>
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {!zero && (
              <button
                type="button"
                className="text-primary hover:underline"
                disabled={isPending}
                onClick={trocarPagamento}
              >
                Trocar a forma de pagamento
              </button>
            )}
            {/* D5: desfazer à mão é só do Gerente. */}
            {venda.isManager && venda.contractSigned && (
              <button
                type="button"
                className="text-muted-foreground hover:underline"
                disabled={isPending}
                onClick={() =>
                  agir(() => closeDirectSaleStep(venda.id, "contract", false), "Termo desmarcado.")
                }
              >
                Desmarcar o termo
              </button>
            )}
            <button
              type="button"
              className="text-muted-foreground hover:text-rose-600 hover:underline"
              disabled={isPending}
              onClick={cancelar}
            >
              Cancelar venda
            </button>
          </div>
          {comAcordo && venda.clientId && (
            <AcordosDaVenda clientId={venda.clientId} directSaleId={venda.id} />
          )}
          {/* 4020: com algo pago, o cancelamento é o distrato. */}
          {venda.clientId && <DistratoDaVenda clientId={venda.clientId} directSaleId={venda.id} />}
        </div>
      </details>
    </>
  );
}

/**
 * VD3-3 (D4/P2): o comprovante pelo WhatsApp, com o texto aprovado pelo dono.
 * Abre a conversa com o cliente (ou o WhatsApp sem número, se o cadastro não
 * tem telefone); quem está no balcão revisa e envia.
 */
function BotaoComprovante({ venda, dados }: { venda: DirectSaleRow; dados: DadosDoCaixa }) {
  const texto = comprovanteDaVenda({
    nome: dados.clientName,
    unidade: venda.clinicName ?? "nossa clínica",
    procedimentos: venda.items.map((i) => (i.quantity > 1 ? `${i.description} (×${i.quantity})` : i.description)),
    totalCents: venda.finalCents,
    meio: venda.paymentMethod,
    parcelas: venda.installments,
    // A data da conclusão (reabrir outro dia não muda o comprovante).
    data: venda.closedAt ? isoDateIn(new Date(venda.closedAt)) : todayInBrazil(),
    codigo: venda.code,
  });
  const url =
    whatsappLink(dados.clientPhone ?? null, texto) ??
    `https://wa.me/?text=${encodeURIComponent(texto)}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border bg-background text-sm font-medium hover:bg-muted"
    >
      <MessageCircle className="size-4" />
      Enviar comprovante por WhatsApp
    </a>
  );
}
