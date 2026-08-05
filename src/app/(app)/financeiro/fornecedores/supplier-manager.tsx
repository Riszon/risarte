"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatCnpj, formatCpf, formatPhone } from "@/lib/masks";
import { saveSupplier } from "../payables-actions";

/** CPF ou CNPJ conforme o tamanho — fornecedor pode ser pessoa física. */
function formatDoc(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length > 11 ? formatCnpj(digits) : formatCpf(digits);
}

export const SUPPLIER_KINDS = [
  { value: "laboratorio", label: "Laboratório (prótese/orto)" },
  { value: "dental", label: "Dental / materiais" },
  { value: "servicos", label: "Serviços" },
  { value: "ocupacao", label: "Ocupação (aluguel, contas)" },
  { value: "pessoal", label: "Pessoal" },
  { value: "marketing", label: "Marketing" },
  { value: "outros", label: "Outros" },
] as const;

export type SupplierRow = {
  id: string;
  name: string;
  document: string | null;
  kind: (typeof SUPPLIER_KINDS)[number]["value"];
  contactName: string | null;
  phone: string | null;
  email: string | null;
  paymentNotes: string | null;
  active: boolean;
};

const EMPTY: SupplierRow = {
  id: "",
  name: "",
  document: null,
  kind: "outros",
  contactName: null,
  phone: null,
  email: null,
  paymentNotes: null,
  active: true,
};

export function SupplierManager({
  clinicId,
  suppliers,
  canEdit,
}: {
  clinicId: string;
  suppliers: SupplierRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<SupplierRow | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const shown = suppliers.filter((s) => showInactive || s.active);

  function save() {
    if (!editing) return;
    startTransition(async () => {
      const r = await saveSupplier({
        id: editing.id || null,
        clinicId,
        name: editing.name,
        document: editing.document ?? "",
        kind: editing.kind,
        contactName: editing.contactName ?? "",
        phone: editing.phone ?? "",
        email: editing.email ?? "",
        paymentNotes: editing.paymentNotes ?? "",
        active: editing.active,
      });
      if (r.ok) {
        toast.success("Fornecedor salvo.");
        setEditing(null);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <div className={cn("space-y-3", isPending && "opacity-70")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="size-3.5 accent-primary"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Mostrar inativos
        </label>
        {canEdit && (
          <Button size="sm" onClick={() => setEditing({ ...EMPTY })}>
            <Plus className="mr-1 size-4" />
            Novo fornecedor
          </Button>
        )}
      </div>

      {shown.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhum fornecedor cadastrado.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1.5">
          {shown.map((s) => (
            <div
              key={s.id}
              className={cn(
                "flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-sm",
                !s.active && "opacity-60"
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium">{s.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {SUPPLIER_KINDS.find((k) => k.value === s.kind)?.label}
                  {s.document && ` · ${formatDoc(s.document)}`}
                  {s.phone && ` · ${formatPhone(s.phone)}`}
                </span>
                {s.paymentNotes && (
                  <span className="block text-[11px] text-muted-foreground">
                    Pagamento: {s.paymentNotes}
                  </span>
                )}
              </span>
              {!s.active && (
                <Badge variant="outline" className="text-[10px]">
                  Inativo
                </Badge>
              )}
              {canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  onClick={() => setEditing(s)}
                >
                  Editar
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? "Editar fornecedor" : "Novo fornecedor"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <Label className="text-[11px]">Nome</Label>
                <Input
                  className="h-9"
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">CNPJ / CPF</Label>
                <Input
                  className="h-9"
                  value={formatDoc(editing.document ?? "")}
                  onChange={(e) =>
                    setEditing({ ...editing, document: e.target.value })
                  }
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Tipo</Label>
                <select
                  value={editing.kind}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      kind: e.target.value as SupplierRow["kind"],
                    })
                  }
                  className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                >
                  {SUPPLIER_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <Label className="text-[11px]">Contato</Label>
                <Input
                  className="h-9"
                  value={editing.contactName ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, contactName: e.target.value })
                  }
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Telefone</Label>
                <Input
                  className="h-9"
                  value={formatPhone(editing.phone ?? "")}
                  onChange={(e) =>
                    setEditing({ ...editing, phone: e.target.value })
                  }
                />
              </label>
              <label className="block sm:col-span-2">
                <Label className="text-[11px]">E-mail</Label>
                <Input
                  className="h-9"
                  value={editing.email ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, email: e.target.value })
                  }
                />
              </label>
              <label className="block sm:col-span-2">
                <Label className="text-[11px]">
                  Como pagamos (chave PIX, banco, condição)
                </Label>
                <Input
                  className="h-9"
                  value={editing.paymentNotes ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, paymentNotes: e.target.value })
                  }
                />
              </label>
              <label className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={editing.active}
                  onChange={(e) =>
                    setEditing({ ...editing, active: e.target.checked })
                  }
                />
                <span className="text-xs">Ativo</span>
              </label>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button
              disabled={isPending || !editing?.name.trim()}
              onClick={save}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
