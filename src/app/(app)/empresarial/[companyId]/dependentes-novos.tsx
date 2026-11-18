"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatBRL } from "@/lib/pricing";
import { formatIsoDateBr } from "@/lib/dates";
import {
  gerarDosDependentesNovos,
  marcarDependentesCobertos,
  previaDosDependentesNovos,
  type PreviaDosDependentesNovos,
} from "./implantacao-dependentes-actions";

/**
 * "Implantação dos dependentes novos" (1050, R7): lista quem tem dependente
 * que ainda não pagou implantação, com o valor do pacote e quem paga. Quem
 * cobra escolhe os titulares e gera; ou marca como já coberto, com motivo.
 */
export function ImplantacaoDosDependentesNovos({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [previa, setPrevia] = useState<PreviaDosDependentesNovos | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  function carregar() {
    startTransition(async () => {
      const r = await previaDosDependentesNovos(companyId);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setPrevia(r);
      setMarcados(new Set(r.titulares.map((t) => t.employeeId)));
      setOpen(true);
    });
  }

  const titulares = previa?.ok ? previa.titulares : [];
  const total = titulares.filter((t) => marcados.has(t.employeeId)).reduce((s, t) => s + t.cents, 0);

  return (
    <>
      <Button size="sm" variant="outline" disabled={isPending} onClick={carregar}>
        {isPending && !open ? "Calculando..." : "Implantação dos dependentes novos"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Implantação dos dependentes novos</DialogTitle>
          </DialogHeader>
          {titulares.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum dependente novo para cobrar: todos os dependentes de hoje já pagaram a implantação.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Cada titular paga um mês do pacote de dependentes de hoje (individual, familiar ou extras).
                Quem paga os dependentes à parte recebe a cobrança no nome dele.
              </p>
              <div className="max-h-[50vh] overflow-y-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="p-2" />
                      <th className="p-2 font-normal">Titular</th>
                      <th className="p-2 font-normal">Dependentes</th>
                      <th className="p-2 font-normal">Quem paga</th>
                      <th className="p-2 text-right font-normal">Valor</th>
                      <th className="p-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {titulares.map((t) => (
                      <tr key={t.employeeId} className="align-top">
                        <td className="p-2">
                          <input
                            type="checkbox"
                            aria-label={`Cobrar ${t.nome}`}
                            checked={marcados.has(t.employeeId)}
                            onChange={(e) => {
                              const n = new Set(marcados);
                              if (e.target.checked) n.add(t.employeeId);
                              else n.delete(t.employeeId);
                              setMarcados(n);
                            }}
                          />
                        </td>
                        <td className="p-2">{t.nome}</td>
                        <td className="p-2">
                          {t.dependentes} ({t.novos} novo{t.novos === 1 ? "" : "s"})
                        </td>
                        <td className="p-2">{t.pagadorTexto}</td>
                        <td className="p-2 text-right">{formatBRL(t.cents)}</td>
                        <td className="p-2 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            disabled={isPending}
                            onClick={() => {
                              const motivo = window.prompt(
                                `Marcar os dependentes de ${t.nome} como já cobertos (sem cobrança). Motivo:`
                              );
                              if (!motivo) return;
                              startTransition(async () => {
                                const r = await marcarDependentesCobertos(companyId, t.employeeId, motivo);
                                if (!r.ok) {
                                  toast.error(r.error ?? "Erro.");
                                  return;
                                }
                                toast.success("Marcado como já coberto.");
                                const p = await previaDosDependentesNovos(companyId);
                                if (p.ok) setPrevia(p);
                                router.refresh();
                              });
                            }}
                          >
                            Já coberto
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-sm">
                Total: <span className="font-semibold">{formatBRL(total)}</span>
                {previa?.ok && ` · vencimento ${formatIsoDateBr(previa.dueDate)}`}
              </p>
              <Button
                disabled={isPending || marcados.size === 0}
                onClick={() =>
                  startTransition(async () => {
                    const r = await gerarDosDependentesNovos(companyId, [...marcados]);
                    if (r.ok) {
                      toast.success(`${r.cobrancas} cobrança(s) gerada(s).`);
                      setOpen(false);
                      router.refresh();
                    } else toast.error(r.error ?? "Erro.");
                  })
                }
              >
                {isPending ? "Gerando..." : "Gerar a implantação dos escolhidos"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
