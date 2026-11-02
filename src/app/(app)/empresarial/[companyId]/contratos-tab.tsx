"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileSignature, Presentation } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cancelContract, generateCompanyProposal, getProposalStatus } from "./contract-actions";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";

/**
 * A ABA CONTRATOS DA EMPRESA.
 *
 * ⚠️ ZS5 (02/11/2026): o envio para assinatura passou para o módulo de
 * assinaturas digitais — o bloco `assinaturas` (montado no servidor) tem o
 * botão "Enviar para assinatura" e os pacotes. O esboço antigo (criar
 * contrato, "Enviar" sem PDF, "Marcar assinado" à mão) saiu: era um segundo
 * caminho que nunca enviou nada. A lista abaixo mostra as linhas de
 * `empresarial.contracts`; as que nasceram de um pacote (1038) acompanham a
 * situação dele sozinhas.
 */

export type ContractView = {
  id: string;
  title: string;
  status: "DRAFT" | "SENT" | "SIGNED" | "CANCELLED";
  signerName: string | null;
  signerEmail: string | null;
  sentAt: string | null;
  signedAt: string | null;
  zapsignUrl: string | null;
  /** O pacote de assinatura digital que esta linha espelha (1038). */
  packageId: string | null;
};

const STATUS_LABEL: Record<ContractView["status"], string> = {
  DRAFT: "Rascunho",
  SENT: "Enviado",
  SIGNED: "Assinado",
  CANCELLED: "Cancelado",
};
const STATUS_VARIANT: Record<
  ContractView["status"],
  "outline" | "secondary" | "destructive"
> = {
  DRAFT: "outline",
  SENT: "secondary",
  SIGNED: "secondary",
  CANCELLED: "destructive",
};

export function ContratosTab({
  companyId,
  contracts,
  gammaConfigured,
  assinaturas,
}: {
  companyId: string;
  contracts: ContractView[];
  gammaConfigured: boolean;
  /** O bloco da assinatura digital (envio + pacotes), montado no servidor. */
  assinaturas: ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string }>, msg: string) {
    startTransition(async () => {
      const r = await action();
      if (r.ok) {
        toast.success(msg);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <div className="space-y-4">
      <ProposalGenerator companyId={companyId} gammaConfigured={gammaConfigured} />

      {assinaturas}

      {contracts.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Contratos registrados</p>
          {contracts.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
            >
              <div>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <FileSignature className="size-4 text-muted-foreground" />
                  {c.title}
                  <Badge variant={STATUS_VARIANT[c.status]}>
                    {STATUS_LABEL[c.status]}
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.signerName ? `Assinante: ${c.signerName}` : "Sem assinante"}
                  {c.signedAt &&
                    ` · assinado em ${new Date(c.signedAt).toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE })}`}
                </p>
                {c.packageId ? (
                  <Link
                    href={`/assinaturas/pacotes/${c.packageId}`}
                    className="text-xs text-gold-tinta hover:underline"
                  >
                    Ver o pacote de assinatura digital
                  </Link>
                ) : c.zapsignUrl ? (
                  <a
                    href={c.zapsignUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-gold-tinta hover:underline"
                  >
                    Link de assinatura
                  </a>
                ) : null}
              </div>
              {/* Linha antiga, sem pacote: dá para encerrar. A do pacote se
                  cancela pelo pacote (cancela também na ZapSign). */}
              {!c.packageId && c.status !== "SIGNED" && c.status !== "CANCELLED" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-destructive"
                  disabled={isPending}
                  onClick={() =>
                    run(
                      async () => cancelContract(companyId, c.id),
                      "Contrato cancelado."
                    )
                  }
                >
                  Cancelar
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProposalGenerator({
  companyId,
  gammaConfigured,
}: {
  companyId: string;
  gammaConfigured: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">(
    "idle"
  );
  const [url, setUrl] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function poll(generationId: string, tries = 0) {
    if (tries > 40) {
      setStatus("error");
      toast.error("A proposta demorou demais. Tente de novo.");
      return;
    }
    timer.current = setTimeout(async () => {
      const r = await getProposalStatus(generationId);
      if (r.status === "completed" && r.gammaUrl) {
        setUrl(r.gammaUrl);
        setStatus("done");
      } else if (r.status === "error") {
        setStatus("error");
        toast.error("Falha ao gerar a proposta.");
      } else {
        poll(generationId, tries + 1);
      }
    }, 5000);
  }

  async function start() {
    setStatus("working");
    setUrl(null);
    const r = await generateCompanyProposal(companyId);
    if (r.ok) poll(r.generationId);
    else {
      setStatus("error");
      toast.error(r.error ?? "Erro.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Presentation className="size-4" />
          Proposta comercial (Gamma)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!gammaConfigured ? (
          <p className="text-sm text-muted-foreground">
            A geração de proposta usa o Gamma. Configure a chave{" "}
            <code>GAMMA_API_KEY</code> para habilitar.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Gera uma apresentação editável com os dados e o investimento da
              empresa. Consome créditos do Gamma.
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={start}
                disabled={status === "working"}
              >
                {status === "working" ? "Gerando..." : "Gerar proposta"}
              </Button>
              {status === "done" && url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-gold-tinta hover:underline"
                >
                  Abrir proposta no Gamma →
                </a>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
