"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BENEFIT_TYPES,
  BENEFIT_TYPE_LABELS,
  type BenefitType,
} from "@/lib/empresarial/constants";
import {
  aplicarGrupo,
  paraQuemVale,
  rotuloDasUnidades,
  type BeneficioDaProposta,
} from "@/lib/empresarial/beneficios-da-proposta";
import { selectClass } from "./campos";
import { saveAsBenefitGroup, saveLeadBenefits } from "./actions";

export type Procedimento = { id: string; name: string };
export type GrupoDeBeneficios = {
  id: string;
  name: string;
  description: string | null;
  itens: BeneficioDaProposta[];
};

/**
 * OS BENEFÍCIOS DA PROPOSTA (OC-00083, H2).
 *
 * Pedido do dono: configurar procedimento a procedimento aqui, marcando se
 * cada um vale para o titular, para o dependente ou para os dois; e aplicar
 * um GRUPO pronto em vez de repetir tudo a cada negociação.
 *
 * ⚠️ AS DUAS CAIXAS NASCEM MARCADAS. É o padrão que ele pediu, e é o que já
 * acontecia antes de as marcas existirem: benefício valia para todo mundo.
 * Quem quiser restringir desmarca de propósito — o contrário faria um
 * benefício nascer sem alcançar ninguém.
 */
export function BeneficiosDaProposta({
  leadId,
  procedimentos,
  grupos,
  iniciais,
  vieramDaRede,
  daRede,
  podeCriarGrupo,
  unidadesDaParceria,
}: {
  leadId: string;
  procedimentos: Procedimento[];
  grupos: GrupoDeBeneficios[];
  iniciais: BeneficioDaProposta[];
  /** A lista acima é o padrão da rede, ainda não salvo nesta proposta. */
  vieramDaRede: boolean;
  /** O padrão da rede, para poder ser reaplicado. */
  daRede: BeneficioDaProposta[];
  /** Só o gestor do programa cria grupo — ele vale para a rede inteira. */
  podeCriarGrupo: boolean;
  /** As unidades da parceria — as únicas que podem restringir um benefício. */
  unidadesDaParceria: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lista, setLista] = useState<BeneficioDaProposta[]>(iniciais);
  const [grupoEscolhido, setGrupoEscolhido] = useState("");
  const [salvandoGrupo, setSalvandoGrupo] = useState(false);

  const nomeDoProcedimento = new Map(procedimentos.map((p) => [p.id, p.name]));
  const semBeneficio = procedimentos.filter(
    (p) => !lista.some((b) => b.procedureId === p.id)
  );

  function trocar(i: number, campo: Partial<BeneficioDaProposta>) {
    setLista((atual) => atual.map((b, j) => (j === i ? { ...b, ...campo } : b)));
  }

  function aplicar() {
    // O padrão da rede é oferecido como se fosse um grupo: é a mesma
    // pergunta ("aplique esta combinação pronta"), e quem usa não precisa
    // saber que uma vem de tabela diferente da outra.
    const grupo =
      grupoEscolhido === "__rede__"
        ? { id: "__rede__", name: "Padrão da rede", description: null, itens: daRede }
        : grupos.find((g) => g.id === grupoEscolhido);
    if (!grupo) return;
    const r = aplicarGrupo(lista, grupo.itens);
    setLista(r.lista);
    // A tela diz o que o grupo fez. "Aplicado" sozinho esconderia que ele
    // trocou um desconto que o consultor tinha acabado de negociar.
    const trocou = r.trocados
      .map((id) => nomeDoProcedimento.get(id) ?? "procedimento")
      .join(", ");
    toast.success(`Grupo "${grupo.name}" aplicado.`, {
      description:
        r.trocados.length > 0
          ? `${r.incluidos} incluído(s); trocou o que já havia em: ${trocou}. Nada foi salvo ainda.`
          : `${r.incluidos} benefício(s) incluído(s). Nada foi salvo ainda.`,
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveLeadBenefits(leadId, formData);
      if (r.ok) {
        toast.success("Benefícios da proposta salvos.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  function guardarComoGrupo(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveAsBenefitGroup(leadId, formData);
      if (r.ok) {
        toast.success("Grupo criado para a rede.");
        setSalvandoGrupo(false);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-sm font-medium">Vantagens e benefícios</p>
          <p className="text-xs text-muted-foreground">
            O que esta empresa ganha, procedimento a procedimento. Vale para o
            titular, para o dependente ou para os dois — e é isto que aparece na
            proposta e passa a valer no orçamento quando o negócio fechar.
          </p>
        </div>

        {/* ⚠️ A PROPOSTA COMEÇA COM O PADRÃO DA REDE (relato do dono,
            24/09/2026). Antes disso a aba abria vazia, e o que era
            configurado em Configurações → Benefícios não chegava a negociação
            nenhuma. A tela DIZ que ainda não está salvo — senão a pessoa
            fecharia a proposta achando que já estava. */}
        {vieramDaRede && (
          <p className="rounded-md border border-gold/40 bg-gold/5 p-2 text-xs">
            Estes vieram do <strong>padrão da rede</strong> (Configurações →
            Benefícios). Confira, ajuste o que esta empresa negociou e{" "}
            <strong>salve</strong> — só então eles passam a valer nesta
            proposta.
          </p>
        )}

        {/* Aplicar um grupo pronto: fora do formulário de propósito, porque
            mexe na lista da tela e não salva nada. */}
        {(grupos.length > 0 || daRede.length > 0) && (
          <div className="flex flex-wrap items-end gap-2 rounded-md bg-muted/40 p-2">
            <div className="min-w-48 flex-1">
              <Label htmlFor="grupo">Aplicar um grupo pronto</Label>
              <select
                id="grupo"
                value={grupoEscolhido}
                onChange={(e) => setGrupoEscolhido(e.target.value)}
                className={selectClass}
              >
                <option value="">— escolher —</option>
                {daRede.length > 0 && (
                  <option value="__rede__">
                    Padrão da rede ({daRede.length})
                  </option>
                )}
                {grupos.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.itens.length})
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={aplicar}
              disabled={!grupoEscolhido || isPending}
            >
              Aplicar
            </Button>
            <p className="w-full text-xs text-muted-foreground">
              O grupo <strong>substitui</strong> o que já houver do mesmo
              procedimento e mantém o resto. Confira antes de salvar.
            </p>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-3">
          {lista.length === 0 && (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              Nenhum benefício configurado. Aplique um grupo ou inclua
              procedimento por procedimento.
            </p>
          )}

          {lista.map((b, i) => (
            <div key={b.procedureId} className="space-y-2 rounded-md border p-2">
              <input type="hidden" name={`proc_${i}`} value={b.procedureId} />
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {nomeDoProcedimento.get(b.procedureId) ?? "(procedimento)"}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  aria-label={`Tirar ${nomeDoProcedimento.get(b.procedureId) ?? "o procedimento"}`}
                  onClick={() => setLista((a) => a.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>

              <div className="grid gap-2 @xl:grid-cols-2 @4xl:grid-cols-4">
                <div>
                  <Label htmlFor={`tipo_${i}`}>Benefício</Label>
                  <select
                    id={`tipo_${i}`}
                    name={`tipo_${i}`}
                    value={b.benefitType}
                    onChange={(e) =>
                      trocar(i, { benefitType: e.target.value as BenefitType })
                    }
                    className={selectClass}
                  >
                    {BENEFIT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {BENEFIT_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>

                {/* O valor só existe onde significa algo. */}
                {(b.benefitType === "DISCOUNT_PERCENT" ||
                  b.benefitType === "DISCOUNT_AMOUNT") && (
                  <div>
                    <Label htmlFor={`valor_${i}`}>
                      {b.benefitType === "DISCOUNT_PERCENT" ? "Quanto (%)" : "Quanto (R$)"}
                    </Label>
                    <Input
                      id={`valor_${i}`}
                      name={`valor_${i}`}
                      value={
                        b.benefitValue == null
                          ? ""
                          : b.benefitType === "DISCOUNT_PERCENT"
                            ? String(b.benefitValue)
                            : (b.benefitValue / 100).toFixed(2).replace(".", ",")
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        trocar(i, {
                          benefitValue:
                            b.benefitType === "DISCOUNT_PERCENT"
                              ? Number.parseInt(v.replace(/\D/g, ""), 10) || null
                              : Math.round(
                                  (Number.parseFloat(
                                    v.replace(/\./g, "").replace(",", ".")
                                  ) || 0) * 100
                                ) || null,
                        });
                      }}
                      placeholder={b.benefitType === "DISCOUNT_PERCENT" ? "30" : "0,00"}
                    />
                  </div>
                )}

                <div>
                  <Label htmlFor={`limite_${i}`}>Quantas vezes</Label>
                  <Input
                    id={`limite_${i}`}
                    name={`limite_${i}`}
                    type="number"
                    min={0}
                    defaultValue={b.usageLimitCount ?? ""}
                    placeholder="sem limite"
                  />
                </div>
                <div>
                  <Label htmlFor={`janela_${i}`}>A cada (meses)</Label>
                  <Input
                    id={`janela_${i}`}
                    name={`janela_${i}`}
                    type="number"
                    min={0}
                    defaultValue={b.usagePeriodMonths ?? ""}
                    placeholder="—"
                  />
                </div>
                <div>
                  <Label htmlFor={`carencia_${i}`}>Carência (meses)</Label>
                  <Input
                    id={`carencia_${i}`}
                    name={`carencia_${i}`}
                    type="number"
                    min={0}
                    defaultValue={b.gracePeriodMonths || ""}
                    placeholder="0"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 border-t pt-2">
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name={`titular_${i}`}
                    checked={b.forHolder}
                    onChange={(e) => trocar(i, { forHolder: e.target.checked })}
                    className="size-4"
                  />
                  Vale para o titular
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name={`dependente_${i}`}
                    checked={b.forDependent}
                    onChange={(e) => trocar(i, { forDependent: e.target.checked })}
                    className="size-4"
                  />
                  Vale para o dependente
                </label>
                <span
                  className={`text-xs ${
                    b.forHolder || b.forDependent
                      ? "text-muted-foreground"
                      : "text-destructive"
                  }`}
                >
                  {paraQuemVale(b)}
                </span>
              </div>

              {/* ⚠️ EM QUAIS UNIDADES ESTE BENEFÍCIO VALE (I3). Só aparece
                  quando a parceria tem mais de uma unidade — com uma só, a
                  pergunta não existe. Nenhuma marcada = todas as da parceria;
                  a tela diz isso, senão a lista vazia pareceria um erro. */}
              {unidadesDaParceria.length > 1 && (
                <div className="space-y-1 border-t pt-2">
                  <p className="text-xs font-medium">Vale nestas unidades</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {unidadesDaParceria.map((u) => (
                      <label key={u.id} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          name={`unidade_${i}`}
                          value={u.id}
                          checked={(b.clinicIds ?? []).includes(u.id)}
                          onChange={(e) =>
                            trocar(i, {
                              clinicIds: e.target.checked
                                ? [...(b.clinicIds ?? []), u.id]
                                : (b.clinicIds ?? []).filter((x) => x !== u.id),
                            })
                          }
                          className="size-4"
                        />
                        {u.name}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {rotuloDasUnidades(
                      b.clinicIds,
                      new Map(unidadesDaParceria.map((u) => [u.id, u.name]))
                    )}
                  </p>
                </div>
              )}
            </div>
          ))}

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <Label htmlFor="novo-procedimento">Incluir um procedimento</Label>
              <select
                id="novo-procedimento"
                value=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) return;
                  setLista((a) => [
                    ...a,
                    {
                      procedureId: id,
                      benefitType: "DISCOUNT_PERCENT",
                      benefitValue: null,
                      usageLimitCount: null,
                      usagePeriodMonths: null,
                      gracePeriodMonths: 0,
                      maxInstallments: null,
                      forHolder: true,
                      forDependent: true,
                      clinicIds: [],
                    },
                  ]);
                }}
                className={selectClass}
                disabled={semBeneficio.length === 0}
              >
                <option value="">
                  {semBeneficio.length === 0
                    ? "— todos já estão na lista —"
                    : "— escolher procedimento —"}
                </option>
                {semBeneficio.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm" disabled={isPending}>
              <Plus className="mr-1 size-3.5" />
              Salvar os benefícios
            </Button>
          </div>
        </form>

        {/* Guardar como grupo: formulário próprio, fora do de cima. */}
        {podeCriarGrupo && lista.length > 0 && (
          <div className="border-t pt-3">
            {!salvandoGrupo ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setSalvandoGrupo(true)}
              >
                Guardar esta combinação como grupo da rede
              </Button>
            ) : (
              <form onSubmit={guardarComoGrupo} className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  O grupo passa a valer para <strong>todas as propostas</strong> da
                  rede. Guarde o que já estiver <strong>salvo</strong> — o grupo
                  copia o que está no banco, não o que está na tela.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="group_name">Nome do grupo</Label>
                    <Input id="group_name" name="group_name" required />
                  </div>
                  <div>
                    <Label htmlFor="group_description">Para que serve</Label>
                    <Input id="group_description" name="group_description" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={isPending}>
                    Criar grupo
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setSalvandoGrupo(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
