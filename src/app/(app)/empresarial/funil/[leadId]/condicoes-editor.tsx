"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  problemasDasFaixas,
  type FaixaDePreco,
} from "@/lib/empresarial/condicoes-da-proposta";
import { Campo, emReais, selectClass } from "./campos";
import { saveCommercialTerms } from "./actions";

export type CondicoesView = {
  minAdhesions: number | null;
  maxAdhesions: number | null;
  adhesionLimitTarget: "HOLDERS" | "DEPENDENTS" | "BOTH" | null;
  minProposalCents: number | null;
  implantationMode: "PER_ADHESION" | "FIXED" | null;
  implantationFixedCents: number | null;
  dependentMode: "PER_DEPENDENT" | "FAMILY_PACKAGE" | null;
  dependentFamilyFeeCents: number | null;
  dependentFamilyExtraFeeCents: number | null;
  dependentFamilySize: number | null;
  holdersWithDependents: number | null;
  faixas: FaixaDePreco[];
};

/**
 * AS CONDIÇÕES COMERCIAIS DA PROPOSTA (OC-00083, H3).
 *
 * Mínimo e máximo de adesões, valor mínimo, faixas de preço por quantidade,
 * implantação fixa ou por adesão, e a tabela de dependentes.
 *
 * ⚠️ TUDO EM BRANCO É O CASO NORMAL. Campo vazio significa "esta negociação
 * não combinou nada disso", e a conta segue sendo a de sempre — era o "poder
 * assinalar também sem regras de quantidade" do pedido.
 */
export function CondicoesComerciais({
  leadId,
  condicoes,
  porTitular,
}: {
  leadId: string;
  condicoes: CondicoesView;
  /** A base da cobrança muda o que a faixa significa. */
  porTitular: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [faixas, setFaixas] = useState<FaixaDePreco[]>(condicoes.faixas);
  const [modoDep, setModoDep] = useState(condicoes.dependentMode ?? "PER_DEPENDENT");
  const [modoImp, setModoImp] = useState(
    condicoes.implantationMode ?? "PER_ADHESION"
  );

  const avisosDasFaixas = problemasDasFaixas(faixas);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveCommercialTerms(leadId, formData);
      if (r.ok) {
        toast.success("Condições comerciais salvas.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-sm font-medium">Condições comerciais</p>
          <p className="text-xs text-muted-foreground">
            Limites, valor mínimo, faixas por quantidade e implantação. Deixe em
            branco o que esta negociação não combinou — em branco, vale o que já
            está acima.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {/* ---- limites de adesão ---- */}
          <div className="grid gap-3 sm:grid-cols-4">
            <Campo id="min_adhesions" rotulo="Mínimo de adesões">
              <Input
                id="min_adhesions"
                name="min_adhesions"
                type="number"
                min={0}
                defaultValue={condicoes.minAdhesions ?? ""}
                placeholder="—"
              />
            </Campo>
            <Campo id="max_adhesions" rotulo="Máximo de adesões">
              <Input
                id="max_adhesions"
                name="max_adhesions"
                type="number"
                min={0}
                defaultValue={condicoes.maxAdhesions ?? ""}
                placeholder="—"
              />
            </Campo>
            <Campo
              id="adhesion_limit_target"
              rotulo="O limite conta"
              ajuda="Abaixo do mínimo o sistema avisa; acima do máximo, impede."
            >
              <select
                id="adhesion_limit_target"
                name="adhesion_limit_target"
                defaultValue={condicoes.adhesionLimitTarget ?? ""}
                className={selectClass}
              >
                <option value="">— sem limite —</option>
                <option value="HOLDERS">Só titulares</option>
                <option value="DEPENDENTS">Só dependentes</option>
                <option value="BOTH">Titulares e dependentes</option>
              </select>
            </Campo>
            <Campo
              id="min_proposal"
              rotulo="Valor mínimo da proposta (R$)"
              ajuda="Mensalidade abaixo disso gera aviso — nunca trava."
            >
              <Input
                id="min_proposal"
                name="min_proposal"
                defaultValue={emReais(condicoes.minProposalCents)}
                placeholder="0,00"
              />
            </Campo>
          </div>

          {/* ---- faixas de preço ---- */}
          <div className="space-y-2 rounded-md border p-2">
            <div>
              <p className="text-sm font-medium">Faixas de preço por quantidade</p>
              <p className="text-xs text-muted-foreground">
                {porTitular
                  ? "A partir da quantidade de titulares, TODOS passam a pagar o valor da faixa."
                  : "A partir da quantidade de titulares, a empresa inteira passa a pagar o valor da faixa."}{" "}
                Sem faixa nenhuma, vale o valor combinado acima.
              </p>
            </div>

            {faixas.map((f, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <div className="w-32">
                  <Campo id={`faixa_qtd_${i}`} rotulo="A partir de">
                    <Input
                      id={`faixa_qtd_${i}`}
                      name={`faixa_qtd_${i}`}
                      type="number"
                      min={1}
                      value={f.minQuantity || ""}
                      onChange={(e) =>
                        setFaixas((a) =>
                          a.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  minQuantity:
                                    Number.parseInt(e.target.value, 10) || 0,
                                }
                              : x
                          )
                        )
                      }
                    />
                  </Campo>
                </div>
                <div className="w-40">
                  <Campo
                    id={`faixa_preco_${i}`}
                    rotulo={porTitular ? "Por titular (R$)" : "Da empresa (R$)"}
                  >
                    <Input
                      id={`faixa_preco_${i}`}
                      name={`faixa_preco_${i}`}
                      defaultValue={emReais(f.priceCents)}
                      placeholder="0,00"
                    />
                  </Campo>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 px-2"
                  aria-label={`Tirar a faixa ${i + 1}`}
                  onClick={() => setFaixas((a) => a.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}

            {/* O aviso aparece na tela mas NÃO impede salvar: existe
                negociação em que o volume custa mais. */}
            {avisosDasFaixas.map((a) => (
              <p key={a} className="text-xs text-amber-700 dark:text-amber-400">
                ⚠️ {a}
              </p>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() =>
                setFaixas((a) => [...a, { minQuantity: 0, priceCents: 0 }])
              }
            >
              <Plus className="mr-1 size-3.5" />
              Nova faixa
            </Button>
          </div>

          {/* ---- implantação ---- */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id="implantation_mode" rotulo="Implantação">
              <select
                id="implantation_mode"
                name="implantation_mode"
                value={modoImp}
                onChange={(e) =>
                  setModoImp(e.target.value as "PER_ADHESION" | "FIXED")
                }
                className={selectClass}
              >
                <option value="PER_ADHESION">Por adesão (valor × titulares)</option>
                <option value="FIXED">Valor fixo pela empresa</option>
              </select>
            </Campo>
            {modoImp === "FIXED" && (
              <Campo id="implantation_fixed" rotulo="Implantação fixa (R$)">
                <Input
                  id="implantation_fixed"
                  name="implantation_fixed"
                  defaultValue={emReais(condicoes.implantationFixedCents)}
                  placeholder="0,00"
                />
              </Campo>
            )}
          </div>

          {/* ---- dependentes ---- */}
          <div className="space-y-2 rounded-md border p-2">
            <p className="text-sm font-medium">Preço dos dependentes</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo id="dependent_mode" rotulo="Como cobrar">
                <select
                  id="dependent_mode"
                  name="dependent_mode"
                  value={modoDep}
                  onChange={(e) =>
                    setModoDep(
                      e.target.value as "PER_DEPENDENT" | "FAMILY_PACKAGE"
                    )
                  }
                  className={selectClass}
                >
                  <option value="PER_DEPENDENT">Um valor por dependente</option>
                  <option value="FAMILY_PACKAGE">Pacote familiar</option>
                </select>
              </Campo>
              {modoDep === "FAMILY_PACKAGE" && (
                <>
                  <Campo id="dependent_family_fee" rotulo="Pacote familiar (R$)">
                    <Input
                      id="dependent_family_fee"
                      name="dependent_family_fee"
                      defaultValue={emReais(condicoes.dependentFamilyFeeCents)}
                      placeholder="59,90"
                    />
                  </Campo>
                  <Campo
                    id="dependent_family_size"
                    rotulo="O pacote cobre até"
                    ajuda="Quantos dependentes de um mesmo titular."
                  >
                    <Input
                      id="dependent_family_size"
                      name="dependent_family_size"
                      type="number"
                      min={1}
                      defaultValue={condicoes.dependentFamilySize ?? ""}
                      placeholder="3"
                    />
                  </Campo>
                  <Campo id="dependent_family_extra_fee" rotulo="Cada extra (R$)">
                    <Input
                      id="dependent_family_extra_fee"
                      name="dependent_family_extra_fee"
                      defaultValue={emReais(condicoes.dependentFamilyExtraFeeCents)}
                      placeholder="19,90"
                    />
                  </Campo>
                  <Campo
                    id="holders_with_dependents"
                    rotulo="Titulares com dependentes"
                    ajuda="Só a estimativa usa. Sem isso, a conta cai no valor individual e diz que caiu."
                  >
                    <Input
                      id="holders_with_dependents"
                      name="holders_with_dependents"
                      type="number"
                      min={0}
                      defaultValue={condicoes.holdersWithDependents ?? ""}
                      placeholder="—"
                    />
                  </Campo>
                </>
              )}
            </div>
            {modoDep === "FAMILY_PACKAGE" && (
              <p className="text-xs text-muted-foreground">
                ⚠️ O pacote é <strong>por titular</strong>, e na hora da proposta
                ninguém sabe como os dependentes vão se distribuir. A simulação
                supõe que eles se dividem por igual e <strong>declara que é
                estimativa</strong> — a fatura real é calculada família a família.
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={isPending}>
              Salvar as condições
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
