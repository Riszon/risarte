"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CircleDashed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBrDate } from "@/lib/dates";
import { faltaParaFechar } from "@/lib/empresarial/envio";
import { convertLeadToCompany, moveLeadStage } from "../actions";
import { BotaoIrParaAba } from "./abas-da-ficha";

/**
 * A ABA FECHAMENTO ANTES DE FECHAR (OC-00083, 3ª volta).
 *
 * ⚠️ ESTA ABA ABRIA EM BRANCO. A conferência só faz sentido depois do ganho —
 * e a regra continua —, mas "não mostrar a conferência" tinha virado "não
 * mostrar nada": toda empresa em negociação, e toda empresa PERDIDA (que abre
 * justamente nesta aba), via uma tela vazia. Tela vazia não diz "ainda não é
 * hora"; diz "quebrou".
 *
 * Aqui a aba passa a responder o que a pessoa veio perguntar: o que falta para
 * fechar, e onde se resolve.
 */
export function FechamentoEmAberto({
  leadId,
  contractSignedAt,
  implantationPaidAt,
}: {
  leadId: string;
  contractSignedAt: string | null;
  implantationPaidAt: string | null;
}) {
  // A MESMA régua da aba Envio — a regra de ouro tem um lugar só.
  const falta = faltaParaFechar({ contractSignedAt, implantationPaidAt });

  return (
    <>
      <Card className={falta.length === 0 ? "border-emerald-600/40" : "border-gold/40"}>
        <CardContent className="space-y-3 p-4">
          <div>
            <p className="text-sm font-medium">O que falta para fechar</p>
            <p className="text-xs text-muted-foreground">
              Só é ganho com <strong>contrato assinado E pagamento da
              implantação confirmado</strong>. Quando os dois estiverem
              marcados, a empresa passa sozinha para Fechamento (ganho) e a
              conferência do consultor aparece nesta aba.
            </p>
          </div>

          <ul className="grid gap-2 sm:grid-cols-2">
            <Selo rotulo="Contrato assinado" em={contractSignedAt} />
            <Selo rotulo="Boleto da implantação pago" em={implantationPaidAt} />
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              {falta.length > 0
                ? `Falta: ${falta.join(" e ")}.`
                : "Os dois selos estão marcados."}
            </p>
            <BotaoIrParaAba aba="envio">Marcar em Envio e selos</BotaoIrParaAba>
          </div>
        </CardContent>
      </Card>

      <MarcarComoPerdido leadId={leadId} />
    </>
  );
}

function Selo({ rotulo, em }: { rotulo: string; em: string | null }) {
  return (
    <li
      className={`flex items-center gap-2 rounded-md border p-2.5 text-sm ${
        em ? "border-emerald-600/40 bg-emerald-600/5" : ""
      }`}
    >
      {em ? (
        <Check className="size-4 shrink-0 text-emerald-600" />
      ) : (
        <CircleDashed className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0">
        {rotulo}
        <span className="block text-xs text-muted-foreground">
          {em ? `marcado em ${formatBrDate(em)}` : "pendente"}
        </span>
      </span>
    </li>
  );
}

function MarcarComoPerdido({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [motivo, setMotivo] = useState("");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const r = await moveLeadStage(leadId, "CLOSED_LOST", motivo);
      if (r.ok) {
        toast.success("Empresa marcada como perdida.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div>
          <p className="text-sm font-medium">O negócio não vai acontecer?</p>
          <p className="text-xs text-muted-foreground">
            Marque como perdido e escreva o motivo — é essa lista que mostra o
            que corrigir na oferta. A empresa sai do funil, e a tela não tem
            botão para trazê-la de volta: confira antes de marcar.
          </p>
        </div>
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <Label htmlFor="motivo-da-perda" className="text-xs">
              Motivo da perda *
            </Label>
            <Input
              id="motivo-da-perda"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={isPending || !motivo.trim()}
          >
            Marcar como perdido
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** A empresa foi perdida: a aba diz isso, e por quê. */
export function NegocioPerdido({ motivo }: { motivo: string | null }) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <p className="text-sm font-medium">Negócio perdido</p>
        <p className="text-sm">
          <span className="text-muted-foreground">Motivo registrado: </span>
          {motivo || "nenhum motivo foi registrado."}
        </p>
        <p className="text-xs text-muted-foreground">
          O levantamento, a proposta e o histórico desta empresa continuam nas
          outras abas, para consulta.
        </p>
        <BotaoIrParaAba aba="historico">Ver o histórico</BotaoIrParaAba>
      </CardContent>
    </Card>
  );
}

/**
 * Ganho SEM empresa criada. A conferência recusa nesse estado ("criar a
 * empresa a partir do lead"), e o botão que cria só existia no cartão do
 * quadro — a aba mandava a pessoa embora para resolver o que ela mesma cobra.
 */
export function CriarEmpresaDoLead({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function criar() {
    startTransition(async () => {
      const r = await convertLeadToCompany(leadId);
      if (!r.ok) {
        toast.error(r.error ?? "Erro.");
        return;
      }
      // A action devolve `ok` COM aviso quando a empresa nasceu mas algo da
      // proposta não foi copiado. As duas metades são verdade; dizer só a
      // primeira faria alguém descobrir a segunda na primeira fatura.
      if (r.error) toast.warning(r.error);
      else toast.success("Empresa criada.");
      router.refresh();
    });
  }

  return (
    <Card className="border-gold/40">
      <CardContent className="space-y-2 p-4">
        <p className="text-sm font-medium">Criar o cadastro da empresa</p>
        <p className="text-xs text-muted-foreground">
          O negócio está ganho, mas a empresa ainda não tem cadastro — e é nele
          que a implantação cadastra os titulares. O cadastro nasce com os
          preços, as faixas e os benefícios desta proposta. Exige o CNPJ
          completo.
        </p>
        <Button type="button" size="sm" disabled={isPending} onClick={criar}>
          Criar empresa
        </Button>
      </CardContent>
    </Card>
  );
}
