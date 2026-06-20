"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatCpf } from "@/lib/masks";
import { shareClientByCpf } from "./actions";

const REASONS = [
  { value: "urgency", label: "Urgência" },
  { value: "emergency", label: "Emergência" },
  { value: "procedure", label: "Procedimento não disponível na unidade" },
  { value: "other", label: "Outro" },
];

export function ShareByCpf() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [cpf, setCpf] = useState("");
  const [reason, setReason] = useState("urgency");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await shareClientByCpf(cpf, reason);
      if (result.ok && result.clientId) {
        toast.success("Cliente compartilhado com a sua unidade.");
        setOpen(false);
        setCpf("");
        router.push(`/clientes/${result.clientId}`);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Share2 className="mr-1 size-4" />
            Compartilhar cliente
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Compartilhar cliente de outra unidade</DialogTitle>
          <DialogDescription>
            Traga temporariamente um cliente de outra unidade para atender aqui
            (urgência, procedimento...). Informe o CPF.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="share-cpf">CPF do cliente *</Label>
            <Input
              id="share-cpf"
              inputMode="numeric"
              required
              value={cpf}
              onChange={(e) => setCpf(formatCpf(e.target.value))}
              placeholder="000.000.000-00"
            />
          </div>
          <div className="space-y-2">
            <Label>Motivo</Label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={isPending || cpf.replace(/\D/g, "").length !== 11}
            >
              {isPending ? "Compartilhando..." : "Compartilhar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
