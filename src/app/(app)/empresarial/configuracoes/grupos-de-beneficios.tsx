"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BENEFIT_TYPES,
  BENEFIT_TYPE_LABELS,
  type BenefitType,
} from "@/lib/empresarial/constants";
import {
  paraQuemVale,
  rotuloDaCarencia,
  rotuloDoBeneficio,
  rotuloDoUso,
  type BeneficioDaProposta,
} from "@/lib/empresarial/beneficios-da-proposta";
import {
  criarGrupoDeBeneficios,
  excluirGrupoDeBeneficios,
  salvarGrupoDeBeneficios,
  salvarItensDoGrupo,
} from "./actions";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

export type Procedimento = { id: string; name: string };

export type GrupoView = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  itens: (BeneficioDaProposta & { nome: string })[];
};

/**
 * OS GRUPOS DE BENEFÍCIOS DA REDE (OC-00083, H2 e I2).
 *
 * Existem para o consultor não configurar procedimento por procedimento em
 * toda proposta. São da REDE por decisão do dono: grupo de cada um faria as
 * propostas da rede deixarem de se parecer.
 *
 * ⚠️ O QUE MUDOU NA I2 (pedido dele, 24/09/2026: *"nas configurações deve ter
 * como criar grupos de benefícios"*): antes só dava para criar **a partir de
 * uma proposta**, o que obrigava a abrir uma negociação para montar algo que
 * é da rede. Agora o grupo nasce aqui — vazio ou copiando o padrão da rede —
 * e os benefícios dele se editam aqui também.
 */
export function GruposDeBeneficios({
  grupos,
  procedimentos,
}: {
  grupos: GrupoView[];
  procedimentos: Procedimento[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);

  function salvar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await salvarGrupoDeBeneficios(formData);
      if (r.ok) {
        toast.success("Grupo salvo.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  function criar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await criarGrupoDeBeneficios(formData);
      if (r.ok) {
        // O erro vem junto com o sucesso quando o grupo nasceu mas os itens
        // não entraram: as duas coisas são verdade.
        if (r.error) toast.warning(r.error);
        else toast.success("Grupo criado.");
        setCriando(false);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  function excluir(id: string) {
    startTransition(async () => {
      const r = await excluirGrupoDeBeneficios(id);
      if (r.ok) {
        toast.success("Grupo excluído.");
        setConfirmando(null);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Grupos de benefícios</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Combinações prontas para aplicar numa proposta sem configurar
          procedimento por procedimento. Elas são <strong>da rede</strong>: o
          que se muda aqui vale para toda proposta daqui em diante — as que já
          aplicaram o grupo guardaram os benefícios na linha delas e não mudam.
        </p>

        {/* ---- criar um grupo novo ---- */}
        {!criando ? (
          <Button size="sm" variant="outline" onClick={() => setCriando(true)}>
            <Plus className="mr-1 size-3.5" />
            Novo grupo
          </Button>
        ) : (
          <form onSubmit={criar} className="space-y-2 rounded-md border p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label htmlFor="novo_nome">Nome do grupo</Label>
                <Input id="novo_nome" name="name" required placeholder="Básico" />
              </div>
              <div>
                <Label htmlFor="novo_desc">Para que serve</Label>
                <Input
                  id="novo_desc"
                  name="description"
                  placeholder="o que entra nesta combinação"
                />
              </div>
            </div>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                name="copiar_da_rede"
                defaultChecked
                className="size-4"
              />
              Começar com os benefícios do padrão da rede
            </label>
            <p className="text-xs text-muted-foreground">
              Começar do padrão é o caminho útil: é o que a Risarte já pratica,
              e você tira ou ajusta o que este grupo precisa mudar. Desmarque
              para começar em branco.
            </p>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={isPending}>
                Criar grupo
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setCriando(false)}
              >
                Cancelar
              </Button>
            </div>
          </form>
        )}

        {grupos.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            Ainda não há grupo nenhum. Crie um acima, ou monte os benefícios na
            aba <strong>Proposta</strong> de uma empresa e use{" "}
            <em>Guardar esta combinação como grupo da rede</em>.
          </p>
        ) : (
          grupos.map((g) => (
            <div key={g.id} className="space-y-2 rounded-md border p-3">
              <form onSubmit={salvar} className="space-y-2">
                <input type="hidden" name="group_id" value={g.id} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={`name_${g.id}`}>Nome</Label>
                    <Input id={`name_${g.id}`} name="name" defaultValue={g.name} required />
                  </div>
                  <div>
                    <Label htmlFor={`desc_${g.id}`}>Para que serve</Label>
                    <Input
                      id={`desc_${g.id}`}
                      name="description"
                      defaultValue={g.description ?? ""}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      name="is_active"
                      defaultChecked={g.isActive}
                      className="size-4"
                    />
                    Disponível para aplicar
                  </label>
                  <Button type="submit" size="sm" disabled={isPending}>
                    Salvar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setEditando(editando === g.id ? null : g.id)}
                  >
                    {editando === g.id ? "Fechar os benefícios" : "Editar os benefícios"}
                  </Button>
                  {confirmando === g.id ? (
                    <>
                      <span className="text-xs text-destructive">
                        Apagar de vez? As propostas que já usaram não mudam.
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={isPending}
                        onClick={() => excluir(g.id)}
                      >
                        Apagar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmando(null)}
                      >
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2"
                      aria-label={`Excluir o grupo ${g.name}`}
                      onClick={() => setConfirmando(g.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </form>

              {editando === g.id ? (
                <ItensDoGrupo
                  grupo={g}
                  procedimentos={procedimentos}
                  aoSalvar={() => setEditando(null)}
                />
              ) : (
                <ul className="divide-y rounded-md bg-muted/30 text-sm">
                  {g.itens.length === 0 ? (
                    <li className="p-2 text-muted-foreground">
                      Grupo sem benefício nenhum — aplicar não faria nada.
                    </li>
                  ) : (
                    g.itens.map((b) => {
                      const uso = rotuloDoUso(b);
                      const carencia = rotuloDaCarencia(b);
                      return (
                        <li key={b.procedureId} className="flex flex-wrap gap-x-2 p-2">
                          <span className="min-w-40 flex-1 font-medium">{b.nome}</span>
                          <span>{rotuloDoBeneficio(b)}</span>
                          <span className="w-full text-xs text-muted-foreground">
                            {paraQuemVale(b)}
                            {uso ? ` · ${uso}` : ""}
                            {carencia ? ` · ${carencia}` : ""}
                          </span>
                        </li>
                      );
                    })
                  )}
                </ul>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Os benefícios de um grupo, editáveis (I2).
 *
 * ⚠️ SALVAR SUBSTITUI O CONJUNTO INTEIRO — o que sumiu da tela sumiu do banco.
 * Mesma regra da proposta: um upsert sem a limpeza deixaria para sempre o item
 * que alguém tirou, e ele voltaria a ser aplicado sem ninguém entender.
 */
function ItensDoGrupo({
  grupo,
  procedimentos,
  aoSalvar,
}: {
  grupo: GrupoView;
  procedimentos: Procedimento[];
  aoSalvar: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lista, setLista] = useState(grupo.itens);

  const nomePorId = new Map(procedimentos.map((p) => [p.id, p.name]));
  const disponiveis = procedimentos.filter(
    (p) => !lista.some((b) => b.procedureId === p.id)
  );

  function trocar(i: number, campo: Partial<BeneficioDaProposta>) {
    setLista((a) => a.map((b, j) => (j === i ? { ...b, ...campo } : b)));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await salvarItensDoGrupo(grupo.id, formData);
      if (r.ok) {
        toast.success("Benefícios do grupo salvos.");
        aoSalvar();
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2 rounded-md bg-muted/30 p-2">
      {lista.length === 0 && (
        <p className="p-2 text-center text-sm text-muted-foreground">
          Grupo vazio. Inclua ao menos um procedimento — grupo sem benefício,
          aplicado numa proposta, não faz nada.
        </p>
      )}

      {lista.map((b, i) => (
        <div key={b.procedureId} className="space-y-2 rounded-md border bg-background p-2">
          <input type="hidden" name={`proc_${i}`} value={b.procedureId} />
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {b.nome || nomePorId.get(b.procedureId) || "(procedimento)"}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              aria-label={`Tirar ${b.nome}`}
              onClick={() => setLista((a) => a.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
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
            {(b.benefitType === "DISCOUNT_PERCENT" ||
              b.benefitType === "DISCOUNT_AMOUNT") && (
              <div>
                <Label htmlFor={`valor_${i}`}>
                  {b.benefitType === "DISCOUNT_PERCENT" ? "Quanto (%)" : "Quanto (R$)"}
                </Label>
                <Input
                  id={`valor_${i}`}
                  name={`valor_${i}`}
                  defaultValue={
                    b.benefitValue == null
                      ? ""
                      : b.benefitType === "DISCOUNT_PERCENT"
                        ? String(b.benefitValue)
                        : (b.benefitValue / 100).toFixed(2).replace(".", ",")
                  }
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
        </div>
      ))}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <Label htmlFor={`novo_${grupo.id}`}>Incluir um procedimento</Label>
          <select
            id={`novo_${grupo.id}`}
            value=""
            onChange={(e) => {
              const id = e.target.value;
              if (!id) return;
              setLista((a) => [
                ...a,
                {
                  nome: nomePorId.get(id) ?? "(procedimento)",
                  procedureId: id,
                  benefitType: "DISCOUNT_PERCENT",
                  benefitValue: null,
                  usageLimitCount: null,
                  usagePeriodMonths: null,
                  gracePeriodMonths: 0,
                  maxInstallments: null,
                  forHolder: true,
                  forDependent: true,
                },
              ]);
            }}
            className={selectClass}
            disabled={disponiveis.length === 0}
          >
            <option value="">
              {disponiveis.length === 0
                ? "— todos já estão no grupo —"
                : "— escolher procedimento —"}
            </option>
            {disponiveis.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" disabled={isPending}>
          Salvar os benefícios do grupo
        </Button>
      </div>
    </form>
  );
}
