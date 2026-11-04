"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ESPECIALIDADE_DA_ORTODONTIA, ONDE_A_ORTODONTIA_E_USADA } from "@/lib/metas/receita";
import {
  addSpecialty,
  deleteSpecialty,
  moveSpecialty,
  renameSpecialty,
  setSpecialtyActive,
} from "./actions";

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

export type SpecialtyItem = {
  id: string;
  name: string;
  isActive: boolean;
  procedureCount: number;
};

/**
 * P5 (0365): a especialidade que as Metas usam para achar a Ortodontia.
 * Renomear ou excluir faz essas contas pararem de achar os procedimentos —
 * desativar não (o procedimento continua com o nome).
 */
function AvisoDaOrtodontia({ acao }: { acao: "renomear" | "excluir" }) {
  return (
    <div className="mt-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
      <p className="font-medium">
        Atenção: {acao === "renomear" ? "renomear" : "excluir"} a especialidade &quot;{ESPECIALIDADE_DA_ORTODONTIA}&quot; faz o
        sistema parar de achar os procedimentos de ortodontia em:
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {ONDE_A_ORTODONTIA_E_USADA.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      <p className="mt-1">
        Os novos casos, os pacientes em tratamento e as mensalidades de ortodontia continuam funcionando: vêm do módulo de
        Ortodontia, não do nome da especialidade. Desativar não afeta nada disso.
      </p>
    </div>
  );
}

export function SpecialtiesEditor({ items }: { items: SpecialtyItem[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  // Exclusão: qual está sendo excluída e para onde mover os procedimentos.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reassignTo, setReassignTo] = useState("");

  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    msg: string,
    after?: () => void
  ) {
    startTransition(async () => {
      const r = await action();
      if (r.ok) {
        toast.success(msg);
        after?.();
        router.refresh();
      } else {
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 pt-6">
          <div className="flex-1">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nova especialidade (ex.: Odontogeriatria)"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) {
                  run(() => addSpecialty(newName), "Especialidade adicionada.", () =>
                    setNewName("")
                  );
                }
              }}
            />
          </div>
          <Button
            disabled={!newName.trim() || isPending}
            onClick={() =>
              run(() => addSpecialty(newName), "Especialidade adicionada.", () =>
                setNewName("")
              )
            }
          >
            <Plus className="mr-1 size-4" />
            Adicionar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nenhuma especialidade cadastrada.
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((sp, i) => (
                <li
                  key={sp.id}
                  className={cn("p-3", !sp.isActive && "opacity-60")}
                >
                  <div className="flex flex-wrap items-center gap-2">
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      aria-label="Subir"
                      disabled={i === 0 || isPending}
                      onClick={() =>
                        run(() => moveSpecialty(sp.id, "up"), "Reordenado.")
                      }
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Descer"
                      disabled={i === items.length - 1 || isPending}
                      onClick={() =>
                        run(() => moveSpecialty(sp.id, "down"), "Reordenado.")
                      }
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronDown className="size-4" />
                    </button>
                  </div>

                  {editingId === sp.id ? (
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="max-w-xs"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && editName.trim()) {
                            run(
                              () => renameSpecialty(sp.id, editName),
                              "Especialidade renomeada.",
                              () => setEditingId(null)
                            );
                          } else if (e.key === "Escape") {
                            setEditingId(null);
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        disabled={!editName.trim() || isPending}
                        onClick={() =>
                          run(
                            () => renameSpecialty(sp.id, editName),
                            "Especialidade renomeada.",
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
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{sp.name}</span>
                        {sp.name === ESPECIALIDADE_DA_ORTODONTIA && (
                          <Badge variant="outline" className="ml-2 text-[10px]" title="Renomear ou excluir afeta as Metas de ortodontia">
                            usada pelas Metas
                          </Badge>
                        )}
                        {!sp.isActive && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            Inativa
                          </Badge>
                        )}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {sp.procedureCount} procedimento
                          {sp.procedureCount === 1 ? "" : "s"}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Renomear"
                        onClick={() => {
                          setEditingId(sp.id);
                          setEditName(sp.name);
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
                            () => setSpecialtyActive(sp.id, !sp.isActive),
                            sp.isActive ? "Desativada." : "Reativada."
                          )
                        }
                      >
                        {sp.isActive ? "Desativar" : "Reativar"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Excluir"
                        disabled={isPending}
                        onClick={() => {
                          setDeletingId(sp.id);
                          setReassignTo("");
                        }}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </>
                  )}
                  </div>
                  {editingId === sp.id && sp.name === ESPECIALIDADE_DA_ORTODONTIA && <AvisoDaOrtodontia acao="renomear" />}
                  {deletingId === sp.id && sp.name === ESPECIALIDADE_DA_ORTODONTIA && <AvisoDaOrtodontia acao="excluir" />}
                  {deletingId === sp.id && (
                    <div className="mt-2 space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
                      <p>
                        Excluir <strong>{sp.name}</strong>? Os procedimentos e
                        Risartanos que a usam vão para:
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={reassignTo}
                          onChange={(e) => setReassignTo(e.target.value)}
                          className={selectClass}
                        >
                          <option value="">Sem especialidade</option>
                          {items
                            .filter((x) => x.id !== sp.id)
                            .map((x) => (
                              <option key={x.id} value={x.name}>
                                Mover para: {x.name}
                              </option>
                            ))}
                        </select>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={isPending}
                          onClick={() =>
                            run(
                              () => deleteSpecialty(sp.id, reassignTo || null),
                              "Especialidade excluída.",
                              () => setDeletingId(null)
                            )
                          }
                        >
                          Excluir
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDeletingId(null)}
                        >
                          Cancelar
                        </Button>
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
