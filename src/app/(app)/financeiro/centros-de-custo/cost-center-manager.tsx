"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  buildCostCenterTree,
  COST_CENTER_SCOPE_LABELS,
  type CostCenter,
  type CostCenterNode,
} from "@/lib/finance/accounts";
import { createCostCenter, updateCostCenter } from "../actions";

const fieldClass =
  "h-9 w-full rounded-lg border border-input bg-background px-2 text-sm";

export function CostCenterManager({
  centers,
  clinics,
  activeClinicId,
  canManageNetwork,
}: {
  centers: CostCenter[];
  clinics: { id: string; name: string }[];
  activeClinicId: string | null;
  /** Só a Franqueadora configura a árvore — a unidade apenas consulta. */
  canManageNetwork: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showNew, setShowNew] = useState(false);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [scope, setScope] = useState<"network" | "unit" | "franchisor">(
    canManageNetwork ? "network" : "unit"
  );
  const [clinicId, setClinicId] = useState(activeClinicId ?? "");

  const tree = useMemo(() => buildCostCenterTree(centers), [centers]);
  const networkCenters = useMemo(
    () => centers.filter((c) => c.scope === "network" && c.active),
    [centers]
  );
  const clinicName = (id: string | null) =>
    id ? (clinics.find((c) => c.id === id)?.name ?? "—") : null;

  function save() {
    startTransition(async () => {
      const r = await createCostCenter({
        code,
        name,
        parentId: scope === "unit" ? parentId || null : null,
        scope,
        clinicId: scope === "unit" ? clinicId || null : null,
      });
      if (r.ok) {
        toast.success("Centro de custo criado.");
        setCode("");
        setName("");
        setParentId("");
        setShowNew(false);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function rename(id: string) {
    startTransition(async () => {
      const r = await updateCostCenter({ id, name: editName });
      if (r.ok) {
        toast.success("Centro renomeado.");
        setEditingId(null);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function toggleActive(c: CostCenter) {
    startTransition(async () => {
      const r = await updateCostCenter({ id: c.id, active: !c.active });
      if (r.ok) {
        toast.success(c.active ? "Centro desativado." : "Centro reativado.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  // Só a Franqueadora edita a árvore — vale para centro de rede e de unidade.
  const canEdit = canManageNetwork;

  function renderNode(node: CostCenterNode, level = 0) {
    const editing = editingId === node.id;
    return (
      <div key={node.id}>
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 border-b py-2 text-sm last:border-b-0",
            !node.active && "opacity-50"
          )}
          style={{ paddingLeft: `${level * 1.25}rem` }}
        >
          <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
            {node.code}
          </span>
          {editing ? (
            <>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className={cn(fieldClass, "max-w-xs flex-1")}
                autoFocus
              />
              <Button size="sm" className="h-8" onClick={() => rename(node.id)}>
                <Check className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={() => setEditingId(null)}
              >
                <X className="size-3.5" />
              </Button>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 font-medium">{node.name}</span>
              <Badge variant="outline" className="text-[10px]">
                {COST_CENTER_SCOPE_LABELS[node.scope]}
              </Badge>
              {node.clinicId && (
                <span className="text-[11px] text-muted-foreground">
                  {clinicName(node.clinicId)}
                </span>
              )}
              {!node.active && (
                <Badge variant="outline" className="text-[10px]">
                  Inativo
                </Badge>
              )}
              {canEdit && (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    onClick={() => {
                      setEditingId(node.id);
                      setEditName(node.name);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-muted-foreground"
                    onClick={() => toggleActive(node)}
                  >
                    {node.active ? "Desativar" : "Reativar"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
        {node.children.map((child) => renderNode(child, level + 1))}
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", isPending && "opacity-70")}>
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Árvore de centros</CardTitle>
          {canManageNetwork && (
            <Button size="sm" onClick={() => setShowNew((v) => !v)}>
              <Plus className="mr-1 size-3.5" />
              Novo centro
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {showNew && (
            <div className="mb-4 space-y-2 rounded-lg border bg-muted/20 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-xs">
                  <span className="font-medium text-muted-foreground">
                    Código (não muda depois)
                  </span>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="CLI-ORT"
                    className={cn(fieldClass, "mt-0.5")}
                  />
                </label>
                <label className="block text-xs">
                  <span className="font-medium text-muted-foreground">Nome</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Sala de ortodontia"
                    className={cn(fieldClass, "mt-0.5")}
                  />
                </label>
                <label className="block text-xs">
                  <span className="font-medium text-muted-foreground">Tipo</span>
                  <select
                    value={scope}
                    onChange={(e) =>
                      setScope(e.target.value as "network" | "unit" | "franchisor")
                    }
                    className={cn(fieldClass, "mt-0.5")}
                  >
                    {canManageNetwork && (
                      <option value="network">Padrão da rede</option>
                    )}
                    {canManageNetwork && (
                      <option value="franchisor">Da franqueadora</option>
                    )}
                    <option value="unit">Da unidade</option>
                  </select>
                </label>
                {scope === "unit" && (
                  <>
                    <label className="block text-xs">
                      <span className="font-medium text-muted-foreground">
                        Unidade
                      </span>
                      <select
                        value={clinicId}
                        onChange={(e) => setClinicId(e.target.value)}
                        className={cn(fieldClass, "mt-0.5")}
                      >
                        <option value="">Escolher...</option>
                        {clinics.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-xs sm:col-span-2">
                      <span className="font-medium text-muted-foreground">
                        Dentro de qual centro da rede
                      </span>
                      <select
                        value={parentId}
                        onChange={(e) => setParentId(e.target.value)}
                        className={cn(fieldClass, "mt-0.5")}
                      >
                        <option value="">Escolher...</option>
                        {networkCenters.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code} — {c.name}
                          </option>
                        ))}
                      </select>
                      <span className="text-[10px] text-muted-foreground">
                        Centro da unidade sempre pendura num centro da rede — é
                        o que deixa as unidades comparáveis no consolidado.
                      </span>
                    </label>
                  </>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={save}>
                  Criar centro
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowNew(false)}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {tree.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum centro de custo cadastrado.
            </p>
          ) : (
            <div>{tree.map((node) => renderNode(node))}</div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        {canManageNetwork
          ? "Centro com lançamento não pode ser excluído nem trocar de código — só desativado. Isso preserva o histórico e a comparação entre períodos."
          : "A árvore de centros é definida pela Franqueadora e vale para toda a rede — é o que permite comparar unidades no consolidado. Precisa de um centro novo? Peça à Franqueadora."}
      </p>
    </div>
  );
}
