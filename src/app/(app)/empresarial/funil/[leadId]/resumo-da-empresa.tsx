"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBrDate, formatBrTime } from "@/lib/dates";
import { formatCnpj, formatPhone } from "@/lib/masks";
import { formatBRL } from "@/lib/pricing";
import { CAPTURE_CHANNEL_LABELS } from "@/lib/empresarial/constants";
import { rotuloDeDuracao } from "@/lib/empresarial/funnel";
import type { ProximaAcao } from "@/lib/empresarial/ficha-do-funil";
import { updateLead } from "../actions";
import { LeadFields, type LeadView } from "../lead-board";

/**
 * QUEM É A EMPRESA, no alto da ficha (OC-00083, 3ª volta).
 *
 * CNPJ, contato, consultor, origem, valor estimado e a próxima ação só
 * existiam na janelinha do cartão, no quadro do funil: quem abria a ficha para
 * "ver os dados" encontrava as abas de trabalho e nenhum dado.
 *
 * ⚠️ O FORMULÁRIO DE EDITAR É O MESMO DO CARTÃO (`LeadFields` + `updateLead`),
 * não uma cópia. Duas telas editando o mesmo cadastro com dois formulários
 * divergem no primeiro campo novo — e a que ficou para trás apaga o campo ao
 * salvar.
 *
 * ⚠️ `@container`: a ficha tem barra lateral ao lado, então a largura da
 * JANELA mente sobre a largura deste quadro (a lição do Bloco J, 24/09/2026).
 */
export function ResumoDaEmpresa({
  lead,
  acao,
}: {
  lead: LeadView;
  /** A próxima ação, já comparada com hoje no servidor (fuso de Brasília). */
  acao: ProximaAcao | null;
}) {
  const cnpj = (lead.cnpj ?? "").replace(/\D/g, "");
  const origem = [
    lead.captureChannel ? CAPTURE_CHANNEL_LABELS[lead.captureChannel] : null,
    lead.referralName ? `indicação de ${lead.referralName}` : null,
  ].filter(Boolean);

  return (
    <Card className="@container">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">Dados da empresa</p>
          <EditarDados lead={lead} />
        </div>

        <dl className="grid gap-x-6 gap-y-3 text-sm @md:grid-cols-2 @3xl:grid-cols-4">
          <Dado rotulo="CNPJ" vazio="não informado">
            {cnpj.length === 14 ? (
              formatCnpj(cnpj)
            ) : cnpj ? (
              <span className="text-amber-700 dark:text-amber-400">
                {lead.cnpj} (incompleto)
              </span>
            ) : null}
          </Dado>
          <Dado rotulo="Contato" vazio="não informado">
            {lead.contactName}
          </Dado>
          <Dado rotulo="Telefone" vazio="não informado">
            {lead.contactPhone ? formatPhone(lead.contactPhone) : null}
          </Dado>
          <Dado rotulo="Consultor" vazio="sem consultor definido">
            {lead.consultantName}
          </Dado>
          <Dado rotulo="Origem" vazio="não informada">
            {origem.length ? origem.join(" · ") : null}
          </Dado>
          <Dado
            rotulo={lead.valorDaPropostaCents != null ? "Valor da proposta (mês)" : "Valor estimado"}
            vazio="não informado"
          >
            {lead.valorDaPropostaCents != null
              ? formatBRL(lead.valorDaPropostaCents)
              : lead.estimatedValueCents != null
                ? formatBRL(lead.estimatedValueCents)
                : null}
          </Dado>
          <Dado rotulo="Nesta fase" vazio="sem registro">
            {lead.tempoNaFase ? (
              <>
                {rotuloDeDuracao(lead.tempoNaFase.ms) === "hoje"
                  ? "desde hoje"
                  : `há ${rotuloDeDuracao(lead.tempoNaFase.ms)}`}
                {/* Sem esta ressalva o número vira medição inventada: o
                    relógio foi ligado em 14/09/2026 (migração 1007). */}
                {lead.tempoNaFase.desdeQueORelogioLigou && (
                  <span className="text-muted-foreground">
                    {" "}
                    (sem histórico anterior)
                  </span>
                )}
              </>
            ) : null}
          </Dado>
          <Dado rotulo="Próxima ação" vazio="nenhuma agendada">
            {lead.nextActionAt && acao ? (
              <span
                className={cn(acao.atrasada && "font-medium text-destructive")}
              >
                {formatBrDate(lead.nextActionAt)} {formatBrTime(lead.nextActionAt)}{" "}
                · {acao.atrasada ? `atrasada, ${acao.quando}` : acao.quando}
                {lead.nextActionNote && (
                  <span className="block font-normal text-muted-foreground">
                    {lead.nextActionNote}
                  </span>
                )}
              </span>
            ) : null}
          </Dado>
        </dl>

        {cnpj.length !== 14 && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Sem o CNPJ completo não dá para criar o cadastro da empresa no
            fechamento.
          </p>
        )}

        {lead.notes && (
          <p className="border-t pt-3 text-sm whitespace-pre-line text-muted-foreground">
            <span className="font-medium text-foreground">Observações: </span>
            {lead.notes}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Dado({
  rotulo,
  vazio,
  children,
}: {
  rotulo: string;
  /** O que dizer quando não há valor — "em branco" também é informação. */
  vazio: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {rotulo}
      </dt>
      <dd className="break-words">
        {children || <span className="text-muted-foreground">{vazio}</span>}
      </dd>
    </div>
  );
}

function EditarDados({ lead }: { lead: LeadView }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [isPending, startTransition] = useTransition();
  // ⚠️ A JANELA TRABALHA SOBRE UMA FOTO dos dados, tirada ao abrir. Salvar
  // recarrega a ficha, e os dados novos chegavam com a janela ainda fechando:
  // os campos (não controlados) recebiam outro valor inicial no meio do
  // caminho, e o Base UI acusava erro (visto no treino, 13/10/2026).
  const [foto, setFoto] = useState(lead);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updateLead(lead.id, formData);
      if (r.ok) {
        toast.success("Dados atualizados.");
        setAberto(false);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(abrir) => {
        if (abrir) setFoto(lead);
        setAberto(abrir);
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="h-7 text-xs">
            <Pencil className="mr-1 size-3.5" />
            Editar dados
          </Button>
        }
      />
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dados de {foto.companyName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <LeadFields lead={foto} consultants={[]} showConsultant={false} />
          <Button type="submit" size="sm" disabled={isPending}>
            Salvar dados
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
