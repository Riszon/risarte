"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CircleDashed, MinusCircle, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBrDate } from "@/lib/dates";
import {
  IMPLEMENTATION_STEPS,
  IMPLEMENTATION_STEP_HELP,
  IMPLEMENTATION_STEP_LABELS,
  impedimentosDaConferencia,
  podeNaoSeAplicar,
  progressoDaImplantacao,
  type ImplementationStep,
  type PassoRegistrado,
} from "@/lib/empresarial/implantacao";
import { confirmClosing, setImplementationStep } from "./actions";

export type ConferenciaView = {
  confirmedAt: string;
  confirmedByName: string | null;
  everythingOk: boolean;
  considerations: string | null;
  specialAgreements: string | null;
};

export function FechamentoEImplantacao({
  leadId,
  stage,
  companyId,
  conferencia,
  passos,
}: {
  leadId: string;
  stage: string;
  companyId: string | null;
  conferencia: ConferenciaView | null;
  passos: PassoRegistrado[];
}) {
  // A conferência só faz sentido a partir do fechamento; antes disso, mostrá-la
  // convidaria a confirmar um negócio que ainda não foi ganho.
  const noFechamento = stage === "CLOSED_WON" || stage === "IMPLEMENTATION";
  if (!noFechamento) return null;

  return (
    <>
      <Conferencia
        leadId={leadId}
        companyId={companyId}
        conferencia={conferencia}
      />
      {stage === "IMPLEMENTATION" && (
        <Implantacao leadId={leadId} companyId={companyId} passos={passos} />
      )}
    </>
  );
}

function Conferencia({
  leadId,
  companyId,
  conferencia,
}: {
  leadId: string;
  companyId: string | null;
  conferencia: ConferenciaView | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tudoCerto, setTudoCerto] = useState(
    conferencia ? (conferencia.everythingOk ? "SIM" : "NAO") : "SIM"
  );
  const [consideracoes, setConsideracoes] = useState(
    conferencia?.considerations ?? ""
  );

  const impedimentos = impedimentosDaConferencia({
    companyId,
    everythingOk: tudoCerto === "SIM",
    considerations: consideracoes,
  });

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await confirmClosing(leadId, formData);
      if (r.ok) {
        toast.success(
          tudoCerto === "SIM"
            ? "Conferido. A empresa foi para Implantação."
            : "Conferência registrada com a pendência."
        );
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Card className={conferencia ? "border-emerald-600/40" : "border-gold/40"}>
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-sm font-medium">
            Conferência do consultor responsável
          </p>
          <p className="text-xs text-muted-foreground">
            Antes de a empresa entrar em implantação: está tudo certo? há
            consideração a fazer? houve <strong>combinado específico</strong>{" "}
            que não podemos esquecer?
          </p>
        </div>

        {conferencia && (
          <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
            Conferido em {formatBrDate(conferencia.confirmedAt)}
            {conferencia.confirmedByName
              ? ` por ${conferencia.confirmedByName}`
              : ""}
            . Salvar de novo atualiza o registro.
          </p>
        )}

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="everything_ok">Está tudo certo?</Label>
              <select
                id="everything_ok"
                name="everything_ok"
                value={tudoCerto}
                onChange={(e) => setTudoCerto(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                <option value="SIM">Sim, pode implantar</option>
                <option value="NAO">Não — tem pendência</option>
              </select>
            </div>
            <div>
              <Label htmlFor="considerations">
                Considerações{tudoCerto === "NAO" ? " *" : ""}
              </Label>
              <Input
                id="considerations"
                name="considerations"
                value={consideracoes}
                onChange={(e) => setConsideracoes(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="special_agreements">
              Combinado específico com a empresa
            </Label>
            <textarea
              id="special_agreements"
              name="special_agreements"
              rows={3}
              defaultValue={conferencia?.specialAgreements ?? ""}
              placeholder="Ex.: os dependentes entram só no segundo mês; a cobrança vai para o RH, não para a diretoria."
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Isto fica gravado <strong>no cadastro da empresa</strong>, não só
              aqui — quem vendeu não é quem vai atender.
            </p>
          </div>

          {impedimentos.length > 0 && (
            <p className="text-xs text-destructive">
              Antes de confirmar: {impedimentos.join("; ")}.
            </p>
          )}

          <Button
            type="submit"
            size="sm"
            disabled={isPending || impedimentos.length > 0}
          >
            {conferencia ? "Atualizar conferência" : "Confirmar e implantar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Implantacao({
  leadId,
  companyId,
  passos,
}: {
  leadId: string;
  companyId: string | null;
  passos: PassoRegistrado[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const progresso = progressoDaImplantacao(passos);
  const porPasso = new Map(passos.map((p) => [p.step, p]));

  function marcar(
    step: ImplementationStep,
    estado: "DONE" | "NOT_APPLICABLE" | "PENDING"
  ) {
    startTransition(async () => {
      const r = await setImplementationStep(leadId, step, estado);
      if (r.ok) router.refresh();
      else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Card className={progresso.completa ? "border-emerald-600/40" : undefined}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Implantação</p>
            <p className="text-xs text-muted-foreground">
              {progresso.concluidos} de {progresso.total} passos ·{" "}
              {progresso.percentual}%
              {progresso.completa ? " — implantação concluída" : ""}
            </p>
          </div>
          {companyId && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              nativeButton={false}
              render={<Link href={`/empresarial/${companyId}`} />}
            >
              <Upload className="mr-1 size-3.5" />
              Abrir a empresa (importar a lista)
            </Button>
          )}
        </div>

        {/* Barra simples: o número já está escrito acima, isto é só o relance. */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-emerald-600 transition-all"
            style={{ width: `${progresso.percentual}%` }}
          />
        </div>

        <ul className="space-y-2">
          {IMPLEMENTATION_STEPS.map((step) => {
            const r = porPasso.get(step);
            const feito = Boolean(r?.doneAt);
            const dispensado = Boolean(r?.notApplicable);
            return (
              <li
                key={step}
                className={`rounded-md border p-2.5 ${
                  feito ? "border-emerald-600/40 bg-emerald-600/5" : ""
                } ${dispensado ? "opacity-70" : ""}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm">
                      {feito ? (
                        <Check className="size-3.5 text-emerald-600" />
                      ) : dispensado ? (
                        <MinusCircle className="size-3.5 text-muted-foreground" />
                      ) : (
                        <CircleDashed className="size-3.5 text-muted-foreground" />
                      )}
                      {IMPLEMENTATION_STEP_LABELS[step]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {IMPLEMENTATION_STEP_HELP[step]}
                    </p>
                    {feito && r?.doneAt && (
                      <p className="text-xs text-muted-foreground">
                        Feito em {formatBrDate(r.doneAt)}
                        {r.doneByName ? ` por ${r.doneByName}` : ""}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    {dispensado && (
                      <Badge variant="secondary" className="text-xs">
                        não se aplica
                      </Badge>
                    )}
                    {feito || dispensado ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={isPending}
                        onClick={() => marcar(step, "PENDING")}
                      >
                        Desfazer
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          disabled={isPending}
                          onClick={() => marcar(step, "DONE")}
                        >
                          Feito
                        </Button>
                        {podeNaoSeAplicar(step) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={isPending}
                            onClick={() => marcar(step, "NOT_APPLICABLE")}
                          >
                            Não se aplica
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {companyId && (
          <p className="text-xs text-muted-foreground">
            A lista de titulares é importada na tela da empresa (planilha com
            nome, CPF, telefone e e-mail), e a fila de ligação fica em{" "}
            <Link
              href={`/empresarial/${companyId}/boas-vindas`}
              className="underline"
            >
              Boas-vindas
            </Link>
            .
          </p>
        )}
      </CardContent>
    </Card>
  );
}
