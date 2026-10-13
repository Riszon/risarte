"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCep } from "@/lib/masks";
import type { CompanyAddress } from "@/lib/empresarial/types";
import { saveContractData } from "../actions";

/**
 * O QUE O CONTRATO PEDE E A PROPOSTA NÃO GUARDAVA (1027): o endereço da sede,
 * o RG e a nacionalidade de quem assina, e o dia de vencimento.
 *
 * Razão social, CNPJ, quem assina, cargo e CPF continuam no passo 6 da
 * proposta — é de lá que o contrato os lê. Pedir os mesmos campos aqui seria
 * abrir um segundo lugar para o mesmo dado, e os dois divergiriam.
 */
export function DadosDoContrato({
  leadId,
  endereco,
  rg,
  nacionalidade,
  diaDeVencimento,
}: {
  leadId: string;
  endereco: CompanyAddress | null;
  rg: string | null;
  nacionalidade: string | null;
  diaDeVencimento: number | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveContractData(leadId, formData);
      if (r.ok) {
        toast.success("Dados do contrato salvos.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    // A CHAVE refaz o formulário quando o que está SALVO muda. Os campos não
    // são controlados: sem ela, depois de salvar eles receberiam outro valor
    // inicial ainda montados, e o Base UI acusa erro (visto no treino).
    <form
      key={JSON.stringify([endereco, rg, nacionalidade, diaDeVencimento])}
      onSubmit={onSubmit}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <Label htmlFor="ct-zip_code">CEP</Label>
          <Input
            id="ct-zip_code"
            name="zip_code"
            defaultValue={endereco?.zipCode ?? ""}
            onChange={(e) => (e.target.value = formatCep(e.target.value))}
            placeholder="00000-000"
          />
        </div>
        <div className="sm:col-span-4">
          <Label htmlFor="ct-street">Endereço da sede (rua, avenida…)</Label>
          <Input id="ct-street" name="street" defaultValue={endereco?.street ?? ""} />
        </div>
        <div className="sm:col-span-1">
          <Label htmlFor="ct-number">Número</Label>
          <Input id="ct-number" name="number" defaultValue={endereco?.number ?? ""} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="ct-complement">Complemento</Label>
          <Input
            id="ct-complement"
            name="complement"
            defaultValue={endereco?.complement ?? ""}
          />
        </div>
        <div className="sm:col-span-3">
          <Label htmlFor="ct-neighborhood">Bairro</Label>
          <Input
            id="ct-neighborhood"
            name="neighborhood"
            defaultValue={endereco?.neighborhood ?? ""}
          />
        </div>
        <div className="sm:col-span-4">
          <Label htmlFor="ct-city">Cidade</Label>
          <Input id="ct-city" name="city" defaultValue={endereco?.city ?? ""} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="ct-state">Estado (sigla)</Label>
          <Input
            id="ct-state"
            name="state"
            maxLength={2}
            defaultValue={endereco?.state ?? ""}
            onChange={(e) => (e.target.value = e.target.value.toUpperCase())}
            placeholder="PR"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="ct-responsible_rg">RG de quem assina</Label>
          <Input id="ct-responsible_rg" name="responsible_rg" defaultValue={rg ?? ""} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="ct-responsible_nationality">Nacionalidade</Label>
          <Input
            id="ct-responsible_nationality"
            name="responsible_nationality"
            defaultValue={nacionalidade ?? ""}
            placeholder="brasileiro"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="ct-due_day">Dia de vencimento (1–28)</Label>
          <Input
            id="ct-due_day"
            name="due_day"
            type="number"
            min={1}
            max={28}
            defaultValue={diaDeVencimento ?? ""}
            placeholder="5"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        RG e nacionalidade são opcionais: em branco, o contrato sai com a linha
        para preencher à mão. Sem dia de vencimento, vale o dia 5. O endereço e
        o dia de vencimento seguem para o cadastro da empresa no fechamento.
      </p>
      <Button type="submit" size="sm" disabled={isPending}>
        Salvar os dados do contrato
      </Button>
    </form>
  );
}
