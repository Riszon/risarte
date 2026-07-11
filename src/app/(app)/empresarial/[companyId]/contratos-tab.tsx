"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileSignature, Plus, Presentation } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cancelContract,
  createContract,
  generateCompanyProposal,
  getProposalStatus,
  markContractSigned,
  sendContract,
} from "./contract-actions";

export type ContractView = {
  id: string;
  title: string;
  status: "DRAFT" | "SENT" | "SIGNED" | "CANCELLED";
  signerName: string | null;
  signerEmail: string | null;
  sentAt: string | null;
  signedAt: string | null;
  zapsignUrl: string | null;
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
  zapsignConfigured,
  gammaConfigured,
}: {
  companyId: string;
  contracts: ContractView[];
  zapsignConfigured: boolean;
  gammaConfigured: boolean;
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

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {zapsignConfigured
            ? "ZapSign conectada."
            : "ZapSign não conectada — use a marcação manual para testar."}
        </p>
        <ContractFormDialog companyId={companyId} />
      </div>

      {contracts.length === 0 ? (
        <p className="rounded-lg border py-8 text-center text-sm text-muted-foreground">
          Nenhum contrato ainda.
        </p>
      ) : (
        <div className="space-y-2">
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
                    ` · assinado em ${new Date(c.signedAt).toLocaleDateString("pt-BR")}`}
                </p>
                {c.zapsignUrl && (
                  <a
                    href={c.zapsignUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-gold hover:underline"
                  >
                    Link de assinatura
                  </a>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {c.status === "DRAFT" && (
                  <Button
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={isPending}
                    onClick={() =>
                      run(
                        async () => sendContract(companyId, c.id),
                        "Contrato enviado."
                      )
                    }
                  >
                    Enviar
                  </Button>
                )}
                {(c.status === "DRAFT" || c.status === "SENT") && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={isPending}
                    onClick={() =>
                      run(
                        async () => markContractSigned(companyId, c.id),
                        "Marcado como assinado."
                      )
                    }
                  >
                    Marcar assinado
                  </Button>
                )}
                {c.status !== "SIGNED" && c.status !== "CANCELLED" && (
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ContractFormDialog({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await createContract(companyId, formData);
      if (r.ok) {
        toast.success("Contrato criado.");
        setOpen(false);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="mr-1 size-4" />
            Novo contrato
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo contrato</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="title">Título</Label>
            <Input id="title" name="title" defaultValue="Contrato Risarte Empresarial" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="signer_name">Assinante</Label>
              <Input id="signer_name" name="signer_name" />
            </div>
            <div>
              <Label htmlFor="signer_email">E-mail</Label>
              <Input id="signer_email" name="signer_email" type="email" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              Criar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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
                  className="text-sm font-medium text-gold hover:underline"
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
