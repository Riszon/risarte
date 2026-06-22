"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatBRL, type Procedure, type UnitPrice } from "@/lib/pricing";
import {
  addProcedure,
  editProcedure,
  setProcedureActive,
  setUnitPrice,
} from "./actions";

/** cents → "150,00" for a text input (no currency symbol). */
function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

export function PriceEditor({
  procedures,
  units,
  selectedUnitId,
  overrides,
}: {
  procedures: Procedure[];
  units: { id: string; name: string }[];
  selectedUnitId: string;
  overrides: UnitPrice[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const networkMode = selectedUnitId === "";
  const overrideByProc = new Map(
    overrides.map((o) => [o.procedureId, o.priceCents])
  );

  // New procedure (network mode only).
  const [nName, setNName] = useState("");
  const [nCode, setNCode] = useState("");
  const [nCategory, setNCategory] = useState("");
  const [nPrice, setNPrice] = useState("");

  // Per-row price inputs (network default or unit override).
  const [prices, setPrices] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const p of procedures) {
      init[p.id] = networkMode
        ? centsToInput(p.defaultPriceCents)
        : overrideByProc.has(p.id)
          ? centsToInput(overrideByProc.get(p.id)!)
          : "";
    }
    return init;
  });

  // Inline name/category edit (network mode).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eName, setEName] = useState("");
  const [eCategory, setECategory] = useState("");

  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    msg: string,
    after?: () => void
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(msg);
        after?.();
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Escopo: padrão da rede ou uma unidade. */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-4">
          <form method="get" className="flex items-center gap-2">
            <Label htmlFor="unidade" className="text-sm">
              Editar preços de:
            </Label>
            <select
              id="unidade"
              name="unidade"
              defaultValue={selectedUnitId}
              className={selectClass}
            >
              <option value="">Padrão da rede</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" size="sm">
              Abrir
            </Button>
          </form>
          {!networkMode && (
            <span className="text-xs text-muted-foreground">
              Deixe o preço em branco para a unidade usar o padrão da rede.
            </span>
          )}
        </CardContent>
      </Card>

      {/* Novo procedimento (somente no padrão da rede). */}
      {networkMode && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Novo procedimento</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label htmlFor="n-name">Nome</Label>
                <Input
                  id="n-name"
                  value={nName}
                  onChange={(e) => setNName(e.target.value)}
                  placeholder="Ex.: Restauração em resina"
                />
              </div>
              <div>
                <Label htmlFor="n-category">Categoria</Label>
                <Input
                  id="n-category"
                  value={nCategory}
                  onChange={(e) => setNCategory(e.target.value)}
                  placeholder="Ex.: Dentística"
                />
              </div>
              <div>
                <Label htmlFor="n-code">Código (opcional)</Label>
                <Input
                  id="n-code"
                  value={nCode}
                  onChange={(e) => setNCode(e.target.value)}
                  placeholder="Ex.: REST"
                />
              </div>
              <div>
                <Label htmlFor="n-price">Preço padrão (R$)</Label>
                <Input
                  id="n-price"
                  value={nPrice}
                  onChange={(e) => setNPrice(e.target.value)}
                  placeholder="0,00"
                  inputMode="decimal"
                />
              </div>
            </div>
            <Button
              size="sm"
              disabled={!nName.trim() || isPending}
              onClick={() =>
                run(
                  () =>
                    addProcedure({
                      name: nName,
                      code: nCode,
                      category: nCategory,
                      price: nPrice,
                    }),
                  "Procedimento adicionado.",
                  () => {
                    setNName("");
                    setNCode("");
                    setNCategory("");
                    setNPrice("");
                  }
                )
              }
            >
              <Plus className="mr-1 size-4" />
              Adicionar procedimento
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Lista de procedimentos. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Procedimentos {networkMode ? "(padrão da rede)" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {procedures.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum procedimento cadastrado ainda.
            </p>
          ) : (
            <ul className="divide-y">
              {procedures.map((p) => (
                <li key={p.id} className="py-3">
                  {editingId === p.id ? (
                    <div className="space-y-2">
                      <Input
                        value={eName}
                        onChange={(e) => setEName(e.target.value)}
                        placeholder="Nome"
                      />
                      <Input
                        value={eCategory}
                        onChange={(e) => setECategory(e.target.value)}
                        placeholder="Categoria"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={isPending}
                          onClick={() =>
                            run(
                              () =>
                                editProcedure(p.id, {
                                  name: eName,
                                  category: eCategory,
                                  price: prices[p.id] ?? "",
                                }),
                              "Procedimento atualizado.",
                              () => setEditingId(null)
                            )
                          }
                        >
                          Salvar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingId(null)}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {p.name}
                          {!p.isActive && (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              Inativo
                            </Badge>
                          )}
                        </p>
                        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          {p.code && (
                            <span className="font-mono text-gold">{p.code}</span>
                          )}
                          {p.category && <span>{p.category}</span>}
                          {!networkMode && (
                            <span>
                              Padrão da rede: {formatBRL(p.defaultPriceCents)}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <span className="text-sm text-muted-foreground">R$</span>
                          <Input
                            value={prices[p.id] ?? ""}
                            onChange={(e) =>
                              setPrices((prev) => ({
                                ...prev,
                                [p.id]: e.target.value,
                              }))
                            }
                            placeholder={
                              networkMode
                                ? "0,00"
                                : centsToInput(p.defaultPriceCents)
                            }
                            inputMode="decimal"
                            className="w-28"
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() =>
                            run(
                              () =>
                                networkMode
                                  ? editProcedure(p.id, {
                                      name: p.name,
                                      category: p.category ?? "",
                                      price: prices[p.id] ?? "",
                                    })
                                  : setUnitPrice(
                                      selectedUnitId,
                                      p.id,
                                      prices[p.id] ?? ""
                                    ),
                              "Preço salvo."
                            )
                          }
                        >
                          Salvar
                        </Button>
                        {networkMode && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Editar nome/categoria"
                              onClick={() => {
                                setEditingId(p.id);
                                setEName(p.name);
                                setECategory(p.category ?? "");
                              }}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={isPending}
                              onClick={() =>
                                run(
                                  () => setProcedureActive(p.id, !p.isActive),
                                  p.isActive
                                    ? "Procedimento desativado."
                                    : "Procedimento reativado."
                                )
                              }
                            >
                              {p.isActive ? "Desativar" : "Reativar"}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
