"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  PAGADOR_LABELS,
  PAGADORES,
  documentoLegivel,
  type Pagador,
} from "@/lib/empresarial/pagador-dos-dependentes";
import { salvarPagadorDosDependentes } from "./employee-actions";

/**
 * 1049 — QUEM PAGA OS DEPENDENTES do titular (pedido do dono, 18/11/2026).
 * A linha fica no alto do bloco de dependentes; "Alterar" abre a escolha.
 */
export function PagadorDosDependentes({
  companyId,
  employeeId,
  titular,
  pagador,
  nome,
  documento,
  email = null,
  celular = null,
  canManage,
}: {
  companyId: string;
  employeeId: string;
  titular: string;
  pagador: Pagador;
  nome: string | null;
  documento: string | null;
  email?: string | null;
  celular?: string | null;
  canManage: boolean;
}) {
  const quem =
    pagador === "OUTRO" && nome
      ? `${nome}${documento ? ` (${documentoLegivel(documento)})` : ""}`
      : PAGADOR_LABELS[pagador];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs">
      <span>
        <span className="text-muted-foreground">Quem paga os dependentes: </span>
        <span className="font-medium">{quem}</span>
        {pagador !== "EMPRESA" && (
          <span className="text-muted-foreground"> — cobrança à parte, fora da cobrança da empresa</span>
        )}
      </span>
      {canManage && (
        <EscolherPagador
          companyId={companyId}
          employeeId={employeeId}
          titular={titular}
          pagador={pagador}
          nome={nome}
          documento={documento}
          email={email}
          celular={celular}
        />
      )}
    </div>
  );
}

function EscolherPagador({
  companyId,
  employeeId,
  titular,
  pagador,
  nome,
  documento,
  email,
  celular,
}: {
  companyId: string;
  employeeId: string;
  titular: string;
  pagador: Pagador;
  nome: string | null;
  documento: string | null;
  email: string | null;
  celular: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [escolha, setEscolha] = useState<Pagador>(pagador);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="h-6 px-2 text-xs">
            Alterar
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quem paga os dependentes de {titular}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              const r = await salvarPagadorDosDependentes(companyId, employeeId, fd);
              if (r.ok) {
                toast.success("Salvo. Vale a partir da próxima mensalidade gerada.");
                setOpen(false);
                router.refresh();
              } else toast.error(r.error ?? "Erro.");
            });
          }}
        >
          <fieldset className="space-y-1.5">
            {PAGADORES.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="dependents_payer"
                  value={p}
                  checked={escolha === p}
                  onChange={() => setEscolha(p)}
                />
                {PAGADOR_LABELS[p]}
              </label>
            ))}
          </fieldset>
          {escolha === "OUTRO" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="dependents_payer_name">Nome de quem paga</Label>
                <Input id="dependents_payer_name" name="dependents_payer_name" defaultValue={nome ?? ""} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="dependents_payer_document">CPF ou CNPJ</Label>
                <Input
                  id="dependents_payer_document"
                  name="dependents_payer_document"
                  defaultValue={documento ?? ""}
                  inputMode="numeric"
                  required
                />
              </div>
              {/* ASA5 (4023, decisão 12a): para onde o Asaas manda a cobrança. */}
              <div className="space-y-1">
                <Label htmlFor="dependents_payer_email">E-mail de quem paga</Label>
                <Input id="dependents_payer_email" name="dependents_payer_email" type="email" defaultValue={email ?? ""} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="dependents_payer_phone">Celular de quem paga</Label>
                <Input
                  id="dependents_payer_phone"
                  name="dependents_payer_phone"
                  defaultValue={celular ?? ""}
                  inputMode="tel"
                  placeholder="(43) 99999-0000"
                />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Informe o e-mail ou o celular (pelo menos um): é para lá que o Asaas manda a cobrança e os lembretes.
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {escolha === "EMPRESA"
              ? "Os dependentes entram na cobrança da empresa, junto com o titular."
              : "Os dependentes saem da cobrança da empresa e ganham uma cobrança própria, no nome de quem paga, gerada junto com a mensalidade da empresa. A implantação dos dependentes, quando combinada com a empresa, segue o mesmo pagador."}
          </p>
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Salvando..." : "Salvar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
