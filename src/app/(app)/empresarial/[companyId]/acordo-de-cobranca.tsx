"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/pricing";
import { Campo, emReais, selectClass } from "../funil/[leadId]/campos";
import { salvarAcordoDeCobranca } from "./acordo-actions";

export type AcordoView = {
  base: "PER_EMPLOYEE" | "FIXED_PER_COMPANY";
  fixoCents: number | null;
  titularesContratados: number | null;
  dependentesContratados: number | null;
  modoDoExcedente: "NEW_FIXED" | "PER_ADHESION" | null;
  excedenteFixoCents: number | null;
  excedenteTitularCents: number | null;
  excedenteDependenteCents: number | null;
  /** O que os termos aceitos do valor fixo somam hoje ao fixo. */
  termosCents: number;
};

/**
 * O ACORDO DE COBRANÇA (AP19 — dono, 27/09/2026): como a mensalidade é
 * cobrada, a quantidade contratada e o que acontece se passar dela. Vem da
 * proposta no fechamento; a empresa cadastrada direto define aqui.
 */
export function AcordoDeCobranca({
  companyId,
  acordo,
  podeEditar,
}: {
  companyId: string;
  /** `null` = não foi possível ler agora: a tela não oferece editar às cegas. */
  acordo: AcordoView | null;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [base, setBase] = useState(acordo?.base ?? "PER_EMPLOYEE");
  const [modo, setModo] = useState<string>(acordo?.modoDoExcedente ?? "");

  if (!acordo) {
    return (
      <Card className="sm:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Acordo de cobrança</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Não foi possível ler o acordo agora. Recarregue a página em instantes.
        </CardContent>
      </Card>
    );
  }

  const fixo = acordo.base === "FIXED_PER_COMPANY";
  const qtd = (n: number | null) => (n == null ? "sem limite (sem trava)" : String(n));
  const regra = !fixo
    ? "entra pelo preço da tabela da empresa, com a faixa"
    : acordo.modoDoExcedente === "NEW_FIXED"
      ? `novo valor fixo do pacote: ${formatBRL(acordo.excedenteFixoCents ?? 0)}`
      : acordo.modoDoExcedente === "PER_ADHESION"
        ? `por adesão: ${formatBRL(acordo.excedenteTitularCents ?? 0)} por titular${
            acordo.excedenteDependenteCents != null
              ? ` e ${formatBRL(acordo.excedenteDependenteCents)} por dependente`
              : ""
          }`
        : "não combinado — o termo de inclusão nasce sem valor";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await salvarAcordoDeCobranca(companyId, formData);
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível salvar.");
        return;
      }
      toast.success("Acordo de cobrança salvo.");
      setEditando(false);
      router.refresh();
    });
  }

  return (
    <Card className="sm:col-span-2">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">Acordo de cobrança</CardTitle>
        {podeEditar && !editando && (
          <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
            Editar
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!editando ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Como a mensalidade é cobrada</p>
              <p className="font-medium">
                {fixo
                  ? `Valor fixo: ${formatBRL(acordo.fixoCents ?? 0)} por mês`
                  : "Por titular (tabela da empresa)"}
              </p>
              {fixo && acordo.termosCents > 0 && (
                <p className="text-xs text-muted-foreground">
                  + {formatBRL(acordo.termosCents)} dos termos de inclusão aceitos
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Quantidade contratada</p>
              <p className="font-medium">
                Titulares: {qtd(acordo.titularesContratados)} · Dependentes:{" "}
                {qtd(acordo.dependentesContratados)}
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground">Se passar do contratado</p>
              <p className="font-medium">{regra}</p>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo id="billing_basis" rotulo="Como a mensalidade é cobrada">
                <select
                  id="billing_basis"
                  name="billing_basis"
                  value={base}
                  onChange={(e) => setBase(e.target.value as AcordoView["base"])}
                  className={selectClass}
                >
                  <option value="PER_EMPLOYEE">Por titular (tabela da empresa)</option>
                  <option value="FIXED_PER_COMPANY">Valor fixo pela empresa</option>
                </select>
              </Campo>
              {base === "FIXED_PER_COMPANY" && (
                <Campo id="fixed_monthly" rotulo="Valor fixo mensal (R$)">
                  <Input
                    id="fixed_monthly"
                    name="fixed_monthly"
                    defaultValue={emReais(acordo.fixoCents)}
                    placeholder="0,00"
                  />
                </Campo>
              )}
              <Campo id="contracted_holders" rotulo="Titulares contratados">
                <Input
                  id="contracted_holders"
                  name="contracted_holders"
                  inputMode="numeric"
                  defaultValue={acordo.titularesContratados ?? ""}
                  placeholder="em branco = sem trava"
                />
              </Campo>
              <Campo id="contracted_dependents" rotulo="Dependentes contratados">
                <Input
                  id="contracted_dependents"
                  name="contracted_dependents"
                  inputMode="numeric"
                  defaultValue={acordo.dependentesContratados ?? ""}
                  placeholder="em branco = sem trava"
                />
              </Campo>
            </div>

            {base === "FIXED_PER_COMPANY" && acordo.termosCents > 0 && (
              <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                Os termos de inclusão já aceitos continuam somando{" "}
                <strong>{formatBRL(acordo.termosCents)}</strong> a este valor fixo.
              </p>
            )}

            {base === "FIXED_PER_COMPANY" ? (
              <div className="space-y-2 rounded-md border p-2">
                <p className="text-sm font-medium">Se passar do contratado</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Campo id="excess_mode" rotulo="Como cobrar o excedente">
                    <select
                      id="excess_mode"
                      name="excess_mode"
                      value={modo}
                      onChange={(e) => setModo(e.target.value)}
                      className={selectClass}
                    >
                      <option value="">— não combinado —</option>
                      <option value="PER_ADHESION">Por adesão (preço por pessoa)</option>
                      <option value="NEW_FIXED">Novo valor fixo do pacote</option>
                    </select>
                  </Campo>
                  {modo === "NEW_FIXED" && (
                    <Campo id="excess_fixed" rotulo="Novo valor fixo (R$)">
                      <Input
                        id="excess_fixed"
                        name="excess_fixed"
                        defaultValue={emReais(acordo.excedenteFixoCents)}
                        placeholder="0,00"
                      />
                    </Campo>
                  )}
                  {modo === "PER_ADHESION" && (
                    <>
                      <Campo id="excess_holder_fee" rotulo="Titular a mais (R$)">
                        <Input
                          id="excess_holder_fee"
                          name="excess_holder_fee"
                          defaultValue={emReais(acordo.excedenteTitularCents)}
                          placeholder="0,00"
                        />
                      </Campo>
                      <Campo id="excess_dependent_fee" rotulo="Dependente a mais (R$)">
                        <Input
                          id="excess_dependent_fee"
                          name="excess_dependent_fee"
                          defaultValue={emReais(acordo.excedenteDependenteCents)}
                          placeholder="0,00"
                        />
                      </Campo>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Por titular, quem passar do contratado entra pelo{" "}
                <strong>preço da tabela</strong> da empresa, com a faixa — não há
                regra a combinar.
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              A mudança vale para as próximas cobranças e fica registrada na
              Auditoria, com o antes e o depois. Cobranças já geradas não mudam.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditando(false);
                  setBase(acordo.base);
                  setModo(acordo.modoDoExcedente ?? "");
                }}
              >
                Voltar sem salvar
              </Button>
              <Button type="submit" size="sm" disabled={isPending}>
                Salvar acordo
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
