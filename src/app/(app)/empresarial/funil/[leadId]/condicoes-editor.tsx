"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/pricing";
import {
  precoDaFaixa,
  problemasDasFaixas,
  totalDaFaixa,
  type FaixaDePreco,
} from "@/lib/empresarial/condicoes-da-proposta";
import type { LinhaDoQuadro } from "@/lib/empresarial/dependentes-da-proposta";
import { Campo, emReais, paraCentavos, selectClass } from "./campos";
import { saveCommercialTerms } from "./actions";

export type CondicoesView = {
  minAdhesions: number | null;
  maxAdhesions: number | null;
  adhesionLimitTarget: "HOLDERS" | "DEPENDENTS" | "BOTH" | null;
  minProposalCents: number | null;
  dependentMode: "PER_DEPENDENT" | "FAMILY_PACKAGE" | null;
  dependentFamilyFeeCents: number | null;
  dependentFamilyExtraFeeCents: number | null;
  dependentFamilySize: number | null;
  // 1032: como os dependentes entram na conta, o quadro e a implantação.
  dependentsCalcMode: "DISTRIBUTION" | "AS_INDIVIDUAL" | "NONE" | null;
  dependentsDistribution: LinhaDoQuadro[];
  implantationIncludesDependents: boolean | null;
  faixas: FaixaDePreco[];
  // I4 (1020): o que acontece se a empresa passar do contratado.
  excessMode: "NEW_FIXED" | "PER_ADHESION" | null;
  excessFixedCents: number | null;
  excessHolderFeeCents: number | null;
  excessDependentFeeCents: number | null;
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
  titulares,
  aoIrParaDependentes,
}: {
  leadId: string;
  condicoes: CondicoesView;
  /** A base da cobrança muda o que a faixa significa. */
  porTitular: boolean;
  /** Os titulares que estão sendo digitados no passo 1 — só para a conta da faixa. */
  titulares: number;
  /** Os valores dos dependentes moram no passo 1; este botão leva até lá. */
  aoIrParaDependentes: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [faixas, setFaixas] = useState<FaixaDePreco[]>(condicoes.faixas);
  // O preço da faixa virou estado (era só `defaultValue`) para o total
  // acompanhar a digitação. Texto, não centavos: "29," no meio da digitação
  // não pode virar "29,00" no campo.
  const [precos, setPrecos] = useState<string[]>(
    condicoes.faixas.map((f) => emReais(f.priceCents))
  );
  const [modoExc, setModoExc] = useState(condicoes.excessMode ?? "");

  const faixasDigitadas: FaixaDePreco[] = faixas.map((f, i) => ({
    minQuantity: f.minQuantity,
    priceCents: paraCentavos(precos[i] ?? ""),
  }));
  const avisosDasFaixas = problemasDasFaixas(faixasDigitadas);
  // Qual faixa vale para os titulares desta proposta — a mesma régua da conta.
  const faixaDaProposta =
    titulares > 0 ? precoDaFaixa(faixasDigitadas, titulares, 0).faixa : null;

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
            Limites, valor mínimo e faixas por quantidade. Deixe em
            branco o que esta negociação não combinou — em branco, vale o que já
            está acima.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {/* ---- limites de adesão ---- */}
          <div className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-4">
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
                      value={precos[i] ?? ""}
                      onChange={(e) =>
                        setPrecos((a) =>
                          a.map((x, j) => (j === i ? e.target.value : x))
                        )
                      }
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
                  onClick={() => {
                    setFaixas((a) => a.filter((_, j) => j !== i));
                    setPrecos((a) => a.filter((_, j) => j !== i));
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
                {/* O TOTAL DA FAIXA — só para quem monta (dono, 26/10/2026).
                    Não vai para o documento: lá continua o preço unitário. */}
                <TotalDaFaixa
                  faixa={faixasDigitadas[i]}
                  porTitular={porTitular}
                  titulares={titulares}
                  valendo={
                    faixaDaProposta != null &&
                    faixaDaProposta.minQuantity === f.minQuantity
                  }
                />
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
              onClick={() => {
                setFaixas((a) => [...a, { minQuantity: 0, priceCents: 0 }]);
                setPrecos((a) => [...a, ""]);
              }}
            >
              <Plus className="mr-1 size-3.5" />
              Nova faixa
            </Button>
          </div>

          {/* AP18 (27/09/2026): a implantação saiu daqui — é sempre o 1º
              pagamento, e a cobrança nunca leu estes campos. */}

          {/* ---- dependentes ---- */}
          {/* 26/10/2026: os valores dos dependentes saíram daqui e foram para
              o passo 1, junto da pergunta "dependentes entram?". Dois lugares
              para o mesmo preço eram o que confundia o dono. */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
            <div>
              <p className="text-sm font-medium">Preço dos dependentes</p>
              <p className="text-xs text-muted-foreground">
                Individual ou plano familiar, com os valores, ficam no passo{" "}
                <strong>Quem paga e quanto</strong> — abrem quando você marca que
                os dependentes entram nesta fase.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={aoIrParaDependentes}
            >
              Configurar dependentes
            </Button>
          </div>

          {/* ---- o excedente ---- */}
          {/* AP19 (dono, 27/09/2026): na proposta POR TITULAR quem passa do
              contratado paga a tabela da empresa — não há regra a combinar, e
              "novo valor fixo" não existe. Os campos somem; o que estiver
              gravado fica no banco, sem uso. */}
          {porTitular ? (
          <div className="space-y-1 rounded-md border p-2">
            <p className="text-sm font-medium">Se passar do contratado</p>
            <p className="text-xs text-muted-foreground">
              Quem passar do contratado entra pelo <strong>preço da tabela</strong>{" "}
              desta empresa, com a faixa — o termo de inclusão e o boleto dão o
              mesmo número. Não há nada a combinar aqui.
            </p>
          </div>
          ) : (
          <div className="space-y-2 rounded-md border p-2">
            <div>
              <p className="text-sm font-medium">Se passar do contratado</p>
              <p className="text-xs text-muted-foreground">
                O cadastro de titulares trava na quantidade fechada. Combinar
                isto <strong>aqui</strong> é o que faz o termo de inclusão
                nascer com o valor pronto — sem isso, cada pessoa a mais vira
                uma renegociação do zero.
              </p>
            </div>
            <div className="grid gap-3 @xl:grid-cols-3">
              <Campo id="excess_mode" rotulo="Como cobrar o excedente">
                <select
                  id="excess_mode"
                  name="excess_mode"
                  value={modoExc}
                  onChange={(e) => setModoExc(e.target.value)}
                  className={selectClass}
                >
                  <option value="">— não combinado —</option>
                  <option value="PER_ADHESION">Por adesão (preço por pessoa)</option>
                  <option value="NEW_FIXED">Novo valor fixo do pacote</option>
                </select>
              </Campo>
              {modoExc === "NEW_FIXED" && (
                <Campo
                  id="excess_fixed"
                  rotulo="Novo valor fixo (R$)"
                  ajuda="O termo cobra só a DIFERENÇA para a mensalidade atual."
                >
                  <Input
                    id="excess_fixed"
                    name="excess_fixed"
                    defaultValue={emReais(condicoes.excessFixedCents)}
                    placeholder="0,00"
                  />
                </Campo>
              )}
              {modoExc === "PER_ADHESION" && (
                <>
                  <Campo id="excess_holder_fee" rotulo="Titular a mais (R$)">
                    <Input
                      id="excess_holder_fee"
                      name="excess_holder_fee"
                      defaultValue={emReais(condicoes.excessHolderFeeCents)}
                      placeholder="0,00"
                    />
                  </Campo>
                  <Campo id="excess_dependent_fee" rotulo="Dependente a mais (R$)">
                    <Input
                      id="excess_dependent_fee"
                      name="excess_dependent_fee"
                      defaultValue={emReais(condicoes.excessDependentFeeCents)}
                      placeholder="0,00"
                    />
                  </Campo>
                </>
              )}
            </div>
          </div>
          )}

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

/** O total de uma faixa, ao lado dela. Só tela — o documento não mostra. */
function TotalDaFaixa({
  faixa,
  porTitular,
  titulares,
  valendo,
}: {
  faixa: FaixaDePreco;
  porTitular: boolean;
  titulares: number;
  /** É a faixa que vale para os titulares desta proposta. */
  valendo: boolean;
}) {
  if (faixa.minQuantity < 1 || faixa.priceCents <= 0) {
    return (
      <p className="basis-full text-xs text-muted-foreground">
        Preencha a quantidade e o preço para ver o total.
      </p>
    );
  }
  return (
    <div className="basis-full rounded-md bg-muted/40 px-2 py-1 text-xs">
      {porTitular ? (
        <>
          Total no início da faixa: {faixa.minQuantity} ×{" "}
          {formatBRL(faixa.priceCents)} ={" "}
          <strong>{formatBRL(totalDaFaixa(faixa, true))}</strong>/mês
        </>
      ) : (
        <>
          Total da empresa nesta faixa:{" "}
          <strong>{formatBRL(totalDaFaixa(faixa, false))}</strong>/mês
        </>
      )}
      {valendo && (
        <span className="block text-emerald-700 dark:text-emerald-400">
          ✓ Faixa desta proposta
          {porTitular
            ? ` — com ${titulares} titulares: ${formatBRL(titulares * faixa.priceCents)}/mês`
            : ` (${titulares} titulares)`}
        </span>
      )}
    </div>
  );
}
