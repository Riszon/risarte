"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatBRL } from "@/lib/pricing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  BILLING_STATUS_LABELS,
  BILLING_TYPE_LABELS,
  type BillingStatus,
  type BillingType,
} from "@/lib/empresarial/constants";
import { Trash2 } from "lucide-react";
import type { CobrancaDoAsaasNaTela } from "@/lib/asaas/empresarial";
import {
  cancelBilling,
  deleteBilling,
  emitirNoAsaas,
  generateBilling,
  markBillingPaid,
  previewBilling,
  runOverdueCheck,
  tentarDeNovoNoAsaas,
  updateBilling,
  type BillingPreview,
} from "./billing-actions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import {
  formatIsoDateBr,
  formatIsoMonthBr,
} from "@/lib/dates";

export type BillingView = {
  id: string;
  billingType: BillingType;
  referenceMonth: string | null;
  totalCents: number;
  status: BillingStatus;
  dueDate: string | null;
  paidAt: string | null;
  splitRisarteCents: number | null;
  splitRislifeCents: number | null;
  description?: string | null;
  payerLabel?: string | null;
  cancelReason?: string | null;
};

const STATUS_VARIANT: Record<string, "secondary" | "destructive" | "outline"> = {
  PENDING: "outline",
  PAID: "secondary",
  OVERDUE: "destructive",
  CANCELLED: "outline",
};

const STATUS_LABEL: Record<string, string> = {
  ...BILLING_STATUS_LABELS,
  CANCELLED: "Cancelada",
};

/** ASA5 (4023): a situação da cobrança no Asaas. */
const ASAAS_LABEL: Record<string, string> = {
  emitindo: "Saindo no Asaas…",
  emitida: "No Asaas",
  vencida: "Vencida no Asaas",
  paga: "Paga no Asaas",
  liquidada: "Paga no Asaas",
  em_contestacao: "Em contestação",
  erro_emissao: "Não saiu no Asaas",
  cancelada: "Cancelada no Asaas",
  estornada: "Estornada no Asaas",
};
const VIVA = new Set(["emitindo", "emitida", "vencida", "erro_emissao"]);

function AsaasDaLinha({
  companyId,
  billing,
  c,
  ligado,
  podeCobrar,
  isPending,
  run,
}: {
  companyId: string;
  billing: BillingView;
  c: CobrancaDoAsaasNaTela | undefined;
  ligado: boolean;
  podeCobrar: boolean;
  isPending: boolean;
  run: (action: () => Promise<{ ok: boolean; error?: string; aviso?: string }>, msg: string) => void;
}) {
  const aberta = billing.status === "PENDING" || billing.status === "OVERDUE";
  const copiar = (texto: string, msg: string) => {
    void navigator.clipboard.writeText(texto).then(
      () => toast.success(msg),
      () => toast.error("Não foi possível copiar.")
    );
  };
  if (!c || c.status === "cancelada") {
    if (!ligado || !aberta || !podeCobrar) return null;
    return (
      <Button
        variant="outline"
        size="sm"
        className="mt-1 h-6 px-2 text-[10px]"
        disabled={isPending}
        onClick={() => run(async () => emitirNoAsaas(companyId, billing.id), "Cobrança emitida no Asaas.")}
      >
        Emitir no Asaas
      </Button>
    );
  }
  const viva = VIVA.has(c.status);
  return (
    <span className="mt-1 block space-y-0.5 text-[10px] text-muted-foreground">
      <span className="block">
        <strong className={c.status === "erro_emissao" ? "text-destructive" : undefined}>
          {ASAAS_LABEL[c.status] ?? c.status}
        </strong>
        {" · "}emitida pela {c.emissor}
      </span>
      {c.invoice_url && viva && (
        <a href={c.invoice_url} target="_blank" rel="noreferrer" className="mr-2 underline">
          Abrir a fatura
        </a>
      )}
      {c.bank_slip_url && viva && (
        <a href={c.bank_slip_url} target="_blank" rel="noreferrer" className="mr-2 underline">
          Boleto (PDF)
        </a>
      )}
      {c.identification_field && viva && (
        <button type="button" className="mr-2 underline" onClick={() => copiar(c.identification_field ?? "", "Linha digitável copiada.")}>
          Copiar a linha
        </button>
      )}
      {c.pix_copy_paste && viva && (
        <button type="button" className="mr-2 underline" onClick={() => copiar(c.pix_copy_paste ?? "", "Pix copiado.")}>
          Copiar o Pix
        </button>
      )}
      {c.report_code && (
        <a href={`/relatorio-do-mes/${c.report_code}`} target="_blank" rel="noreferrer" className="mr-2 underline">
          Relatório do mês
        </a>
      )}
      {c.status === "erro_emissao" && podeCobrar && (
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[10px]"
          disabled={isPending}
          onClick={() => run(async () => tentarDeNovoNoAsaas(companyId, c.charge_id), "Cobrança emitida no Asaas.")}
        >
          Tentar de novo
        </Button>
      )}
    </span>
  );
}

function dateBR(iso: string | null): string {
  return iso ? formatIsoDateBr(iso) : "—";
}

export function BillingTab({
  companyId,
  companyStatus,
  billings,
  asaas,
  isAdminMaster = false,
  podeCobrar = false,
}: {
  companyId: string;
  companyStatus: string;
  billings: BillingView[];
  /** ASA5 (4023): se a rede cobra pelo Asaas e a cobrança do Asaas de cada linha. */
  asaas: { ligado: boolean; porLinha: Record<string, CobrancaDoAsaasNaTela> };
  /** Só o Admin Master pode EXCLUIR uma cobrança (limpeza de teste). */
  isAdminMaster?: boolean;
  /**
   * OC-00105: quem pode cobrar (gestor do programa OU Financeiro da
   * Franqueadora). Sem isso, os botões apareciam para todo mundo que abre a
   * ficha e respondiam "Sem permissão" no clique.
   */
  podeCobrar?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Confirmação antes de gerar: mostra valor, vencimento, pagador e a que se refere.
  const [preview, setPreview] = useState<BillingPreview | null>(null);
  const [previewType, setPreviewType] =
    useState<"MONTHLY" | "IMPLANTATION">("MONTHLY");
  const [loadingPreview, setLoadingPreview] = useState(false);
  // Valor digitado quando não há como calcular a implantação (OC-00055).
  const [valorImplantacao, setValorImplantacao] = useState("");

  function openPreview(type: "MONTHLY" | "IMPLANTATION") {
    setPreviewType(type);
    setLoadingPreview(true);
    startTransition(async () => {
      const p = await previewBilling(companyId, type);
      setLoadingPreview(false);
      if (!p.ok) {
        toast.error(p.error ?? "Não foi possível calcular a cobrança.");
        return;
      }
      setPreview(p);
    });
  }

  function run(action: () => Promise<{ ok: boolean; error?: string; aviso?: string }>, msg: string) {
    startTransition(async () => {
      const r = await action();
      if (r.ok) {
        toast.success(msg);
        // ASA5: gravou no Empresarial, mas algo do Asaas não saiu — dito, não engolido.
        if (r.aviso) toast.warning(r.aviso, { duration: 12000 });
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <div className="space-y-4">
      {companyStatus === "SUSPENDED" && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Empresa <strong>suspensa</strong> por inadimplência. Os benefícios do
          programa estão bloqueados para novos orçamentos até a regularização.
        </div>
      )}

      {podeCobrar && (
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          <Button
            size="sm"
            disabled={isPending || loadingPreview}
            onClick={() => openPreview("MONTHLY")}
          >
            {loadingPreview ? "Calculando..." : "Gerar cobrança mensal"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending || loadingPreview}
            onClick={() => openPreview("IMPLANTATION")}
          >
            Gerar implantação
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() =>
              run(
                async () => runOverdueCheck(companyId),
                "Inadimplência verificada."
              )
            }
          >
            Checar inadimplência
          </Button>
          {/* ASA5 (4023): o aviso lê a integração nova (Central › Empresarial),
              e não mais uma variável de ambiente. Cada linha diz se saiu no Asaas. */}
          <span className="ml-auto text-xs text-muted-foreground">
            {asaas.ligado
              ? "Asaas ligado: a cobrança gerada sai no Asaas na hora (a implantação pela RisLife, a mensalidade pela franqueadora), e a baixa vem do Asaas."
              : "Asaas desligado — a cobrança fica registrada aqui e a baixa é manual."}
          </span>
        </CardContent>
      </Card>
      )}

      {billings.length === 0 ? (
        <p className="rounded-lg border py-8 text-center text-sm text-muted-foreground">
          Nenhuma cobrança gerada ainda.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Pagador</th>
                <th className="px-3 py-2 font-medium">Referência</th>
                <th className="px-3 py-2 font-medium">Valor</th>
                <th className="px-3 py-2 font-medium">Vencimento</th>
                <th className="px-3 py-2 font-medium">Situação</th>
                <th className="px-3 py-2 font-medium">Split (R/RL)</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {billings.map((b) => (
                <tr key={b.id} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    {BILLING_TYPE_LABELS[b.billingType]}
                    {b.description && (
                      <span className="block text-[10px] text-muted-foreground">
                        {b.description}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {b.payerLabel ?? "Empresa (consolidado)"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatIsoMonthBr(b.referenceMonth) || "—"}
                  </td>
                  <td className="px-3 py-2 font-medium">{formatBRL(b.totalCents)}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatIsoDateBr(b.dueDate) || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={STATUS_VARIANT[b.status] ?? "outline"}>
                      {STATUS_LABEL[b.status] ?? b.status}
                    </Badge>
                    <AsaasDaLinha
                      companyId={companyId}
                      billing={b}
                      c={asaas.porLinha[b.id]}
                      ligado={asaas.ligado}
                      podeCobrar={podeCobrar}
                      isPending={isPending}
                      run={run}
                    />
                    {b.status === "CANCELLED" && b.cancelReason && (
                      <span
                        className="block text-[10px] text-muted-foreground"
                        title={b.cancelReason}
                      >
                        {b.cancelReason}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {b.status === "PAID" && b.splitRisarteCents != null
                      ? `${formatBRL(b.splitRisarteCents)} / ${formatBRL(b.splitRislifeCents ?? 0)}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap items-center justify-end gap-1">
                    {podeCobrar && b.status !== "PAID" && b.status !== "CANCELLED" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={isPending}
                          onClick={() => {
                            // ASA5: com a cobrança no Asaas, "marcar pago" é
                            // "recebeu por fora" — a do Asaas é cancelada antes.
                            const noAsaas = VIVA.has(asaas.porLinha[b.id]?.status ?? "");
                            if (
                              noAsaas &&
                              !window.confirm(
                                "Esta cobrança está no Asaas. Recebeu por fora? A cobrança do Asaas será cancelada e a baixa feita aqui."
                              )
                            )
                              return;
                            run(
                              async () => markBillingPaid(companyId, b.id),
                              "Pagamento registrado (split gravado)."
                            );
                          }}
                        >
                          {VIVA.has(asaas.porLinha[b.id]?.status ?? "") ? "Recebeu por fora" : "Marcar pago"}
                        </Button>
                        <EditBillingDialog companyId={companyId} billing={b} />
                        <CancelBillingDialog companyId={companyId} billing={b} />
                      </>
                    )}
                    {isAdminMaster && (
                      <DeleteBillingDialog companyId={companyId} billing={b} />
                    )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirmação antes de gerar: o que será cobrado, de quem e quando. */}
      <Dialog open={preview !== null} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirmar a cobrança</DialogTitle>
          </DialogHeader>
          {preview?.items && (
            <div className="space-y-3">
              <div className="rounded-lg border p-3 text-sm">
                <p className="mb-1.5 text-xs uppercase text-muted-foreground">
                  Refere-se a
                </p>
                <p className="font-medium">{preview.description}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <p>
                    <span className="text-muted-foreground">Vencimento: </span>
                    <strong>{dateBR(preview.dueDate ?? null)}</strong>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Beneficiário: </span>
                    <strong>{preview.beneficiary}</strong>
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs uppercase text-muted-foreground">
                  {preview.items.length > 1
                    ? preview.items.some((i) => i.employeeId)
                      ? `${preview.items.length} cobranças (a da empresa e as dos dependentes pagos à parte)`
                      : `${preview.items.length} boletos (um por documento)`
                    : "Pagador"}
                </p>
                {preview.items.map((i, idx) => (
                  <div
                    key={idx}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-sm"
                  >
                    <div>
                      <p className="font-medium">{i.payerName}</p>
                      <p className="text-xs text-muted-foreground">
                        {i.payerDoc} ·{" "}
                        {i.employeeId
                          ? `${i.dependentes ?? 0} dependente(s) pagos à parte`
                          : `${i.employees} titular(es)`}
                      </p>
                      {i.employeeId && i.description && (
                        <p className="text-xs text-muted-foreground">{i.description}</p>
                      )}
                    </div>
                    <p className="text-lg font-semibold text-gold-tinta">
                      {formatBRL(i.totalCents)}
                    </p>
                  </div>
                ))}
              </div>

              {preview.items.length > 1 && (
                <p className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
                  <span className="font-medium">Total</span>
                  <span className="font-semibold">
                    {formatBRL(
                      preview.items.reduce((a, i) => a + i.totalCents, 0)
                    )}
                  </span>
                </p>
              )}

              {/* A CONTA VEIO DA QUANTIDADE CONTRATADA (OC-00055/OC-00057).
                  Dizer isso faz parte do número: sem a frase, quem vê o valor
                  procura os titulares na lista e não os encontra. */}
              {preview.baseContratada != null && (
                <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                  Calculado pela <strong>quantidade contratada</strong> (
                  {preview.baseContratada} titular(es)), e não pelos{" "}
                  {preview.titularesCadastrados ?? 0} já cadastrados — é o que
                  foi combinado na proposta. Dá para ajustar o valor depois, no{" "}
                  <strong>Editar</strong> da cobrança.
                </p>
              )}

              {/* 1032: A REGRA DOS DEPENDENTES NA IMPLANTAÇÃO, dita junto do
                  número — sem ela, quem confere procura os dependentes na
                  conta e não sabe se faltam ou se não entram. */}
              {preview.dependentesNaImplantacao && (
                <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                  {preview.dependentesNaImplantacao.inclui ? (
                    <>
                      Combinado na proposta: a implantação cobra{" "}
                      <strong>titulares e dependentes</strong>
                      {preview.dependentesNaImplantacao.estimativaCents != null
                        ? ` — os dependentes pela estimativa da proposta (${formatBRL(preview.dependentesNaImplantacao.estimativaCents)}), já que os cadastros não estão completos.`
                        : " — os dependentes já cadastrados."}
                    </>
                  ) : (
                    <>
                      Combinado na proposta: a implantação cobra{" "}
                      <strong>só os titulares</strong>. Os dependentes entram na
                      mensalidade.
                    </>
                  )}
                </p>
              )}

              {/* OC-00090: A MENSALIDADE SAI PELO COMBINADO, mesmo sem os
                  cadastros. Sem esta frase, quem vê "7 titulares" procura os
                  nomes na lista e não acha — e ninguém cobra a empresa. */}
              {preview.cadastrosPendentes && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
                  <strong>Faltam cadastros de colaboradores.</strong> A empresa
                  contratou {preview.cadastrosPendentes.contratados} titular(es)
                  e {preview.cadastrosPendentes.cadastrados === 0
                    ? "ainda não cadastrou nenhum"
                    : `só ${preview.cadastrosPendentes.cadastrados} ${
                        preview.cadastrosPendentes.cadastrados === 1
                          ? "está cadastrado"
                          : "estão cadastrados"
                      }`}
                  .{" "}
                  {preview.valorFixo
                    ? "O valor fixo combinado é cobrado do mesmo jeito."
                    : "A mensalidade é cobrada pelo contratado — foi o que se combinou."}{" "}
                  Ao gerar, quem gerencia o programa recebe um aviso para cobrar
                  da empresa os dados{" "}
                  {preview.cadastrosPendentes.faltam === 1
                    ? "do titular que falta"
                    : `dos ${preview.cadastrosPendentes.faltam} que faltam`}
                  .
                </p>
              )}

              {/* SEGUNDA ETAPA (AP12): cada titular paga implantação UMA vez.
                  Sem esta frase, quem vê "20 titulares" numa empresa de 100
                  acha que o sistema errou a conta. */}
              {preview.jaCobertos != null && preview.baseDaImplantacao != null && (
                <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                  <strong>Implantação dos novos titulares.</strong> A empresa
                  tem hoje {preview.baseDaImplantacao} titular(es) entre
                  contratados e termos de inclusão aceitos;{" "}
                  {preview.jaCobertos} já pagaram a implantação antes. Esta
                  cobra só a diferença, pelo preço da faixa de{" "}
                  {preview.baseDaImplantacao}.
                </p>
              )}

              {/* AP18: VALOR FIXO. Sem a frase, quem vê R$ 5.000 com 60
                  titulares cadastrados procura o erro na conta por titular. */}
              {preview.valorFixo && (
                <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                  <strong>Acordo de valor fixo.</strong> Valor fixo combinado:{" "}
                  {formatBRL(preview.valorFixo.fixoCents)}
                  {preview.valorFixo.termosCents > 0 && (
                    <>
                      {" "}
                      + {formatBRL(preview.valorFixo.termosCents)} dos termos de
                      inclusão aceitos
                    </>
                  )}
                  . Não depende de quantos titulares estão cadastrados.
                  {preview.valorFixo.jaCobradoCents
                    ? ` A implantação cobra só o que ainda não foi cobrado (já foram ${formatBRL(preview.valorFixo.jaCobradoCents)}).`
                    : ""}
                </p>
              )}

              {/* Implantação antiga sem registro de quantos cobriu: a conta é
                  a de sempre e pode repetir quem já pagou — a tela avisa em
                  vez de adivinhar. */}
              {preview.avisoCobertura && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
                  {preview.avisoCobertura}
                </p>
              )}

              {/* Sem titulares e sem quantidade contratada: ninguém tem como
                  saber o valor, então a tela PERGUNTA em vez de inventar. */}
              {preview.precisaValor && (
                <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                  <Label htmlFor="valor_implantacao" className="text-xs">
                    Valor da implantação (R$)
                  </Label>
                  <Input
                    id="valor_implantacao"
                    value={valorImplantacao}
                    onChange={(e) => setValorImplantacao(e.target.value)}
                    placeholder="0,00"
                    inputMode="decimal"
                  />
                  <p className="text-xs text-muted-foreground">
                    Esta empresa ainda não tem titulares cadastrados nem
                    quantidade contratada na proposta, então não há como
                    calcular sozinho.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setPreview(null)}
                  disabled={isPending}
                >
                  Cancelar
                </Button>
                <Button
                  disabled={isPending}
                  onClick={() => {
                    const cents = preview.precisaValor
                      ? Math.round(
                          Number.parseFloat(
                            valorImplantacao
                              .replace(/\s/g, "")
                              .replace(/\./g, "")
                              .replace(",", ".")
                          ) * 100
                        )
                      : undefined;
                    if (
                      preview.precisaValor &&
                      (!Number.isFinite(cents as number) || (cents as number) <= 0)
                    ) {
                      toast.error("Informe o valor da implantação.");
                      return;
                    }
                    setPreview(null);
                    setValorImplantacao("");
                    run(
                      async () => generateBilling(companyId, previewType, cents),
                      preview.items && preview.items.length > 1
                        ? `${preview.items.length} cobranças geradas.`
                        : "Cobrança gerada."
                    );
                  }}
                >
                  Confirmar e gerar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Editar uma cobrança ainda não paga (valor, vencimento, descrição). */
function EditBillingDialog({
  companyId,
  billing,
}: {
  companyId: string;
  billing: BillingView;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updateBilling(companyId, billing.id, formData);
      if (r.ok) {
        toast.success("Cobrança atualizada.");
        setOpen(false);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => setOpen(true)}
      >
        Editar
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar cobrança</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bill_total">Valor (R$)</Label>
              <Input
                id="bill_total"
                name="total"
                required
                defaultValue={(billing.totalCents / 100)
                  .toFixed(2)
                  .replace(".", ",")}
              />
            </div>
            <div>
              <Label htmlFor="bill_due">Vencimento</Label>
              <Input
                id="bill_due"
                name="due_date"
                type="date"
                required
                defaultValue={billing.dueDate ?? ""}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="bill_desc">Refere-se a</Label>
            <Input
              id="bill_desc"
              name="description"
              defaultValue={billing.description ?? ""}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              Salvar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Excluir a cobrança de vez (Admin Master). Diferente de cancelar, que fica no
 * histórico — usar para limpar cobranças de TESTE.
 */
function DeleteBillingDialog({
  companyId,
  billing,
}: {
  companyId: string;
  billing: BillingView;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-destructive"
        title="Excluir a cobrança (Admin Master)"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-3.5" />
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Excluir esta cobrança?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            {BILLING_TYPE_LABELS[billing.billingType]} ·{" "}
            <strong>{formatBRL(billing.totalCents)}</strong> · vencimento{" "}
            {dateBR(billing.dueDate)}
          </p>
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
            A cobrança é <strong>apagada</strong> e não aparece em relatório
            nenhum. Para manter no histórico, use <strong>Cancelar</strong> em vez
            de excluir.
            {billing.status === "PAID" && (
              <span className="mt-1 block font-medium">
                Atenção: esta cobrança está PAGA — o registro do split será
                perdido junto.
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            A exclusão fica registrada na auditoria (quem, quando e o valor).
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const r = await deleteBilling(companyId, billing.id);
                  if (r.ok) {
                    toast.success("Cobrança excluída.");
                    setOpen(false);
                    router.refresh();
                  } else toast.error(r.error ?? "Erro.");
                })
              }
            >
              Excluir
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Cancelar a cobrança — motivo obrigatório. */
function CancelBillingDialog({
  companyId,
  billing,
}: {
  companyId: string;
  billing: BillingView;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-destructive"
        onClick={() => setOpen(true)}
      >
        Cancelar
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar cobrança</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {formatBRL(billing.totalCents)} · vencimento{" "}
            {dateBR(billing.dueDate)}. A cobrança fica no histórico como
            cancelada.
          </p>
          <div>
            <Label htmlFor="cancel_reason">Motivo *</Label>
            <Input
              id="cancel_reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: valor incorreto, empresa renegociou"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={isPending || !reason.trim()}
              onClick={() =>
                startTransition(async () => {
                  const r = await cancelBilling(companyId, billing.id, reason);
                  if (r.ok) {
                    toast.success("Cobrança cancelada.");
                    setOpen(false);
                    setReason("");
                    router.refresh();
                  } else toast.error(r.error ?? "Erro.");
                })
              }
            >
              Cancelar cobrança
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
