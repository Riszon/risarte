"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Vantagem } from "@/lib/empresarial/vantagens";
import { excluirVantagem, salvarVantagem } from "./actions";

/**
 * AS OUTRAS VANTAGENS DA REDE (1033, dono em 26/10/2026).
 *
 * O que o programa oferece além dos procedimentos: desconto em parceiros,
 * palestras, publicidade nas TVs, unidade exclusiva… Aqui se cadastra a
 * vantagem; o detalhe de cada empresa ("2 palestras por ano") se escreve na
 * proposta.
 */
export function VantagensDaRede({ vantagens }: { vantagens: Vantagem[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editando, setEditando] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  function salvar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await salvarVantagem(formData);
      if (r.ok) {
        toast.success("Vantagem salva.");
        setEditando(null);
        setCriando(false);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  function excluir(id: string) {
    startTransition(async () => {
      const r = await excluirVantagem(id);
      if (r.ok) {
        toast.success("Vantagem excluída.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
      setConfirmando(null);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Outras vantagens</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          O que o programa oferece <strong>além dos procedimentos</strong> —
          desconto em parceiros, palestras na empresa, publicidade nas TVs da
          unidade, unidade exclusiva. Na proposta, escolhe-se quais entram e
          escreve-se o detalhe de cada empresa. Depois do fechamento, cada uma
          vira um <strong>compromisso</strong> acompanhado na ficha da empresa.
        </p>

        <ul className="divide-y rounded-md border">
          {vantagens.length === 0 && (
            <li className="p-3 text-sm text-muted-foreground">
              Nenhuma vantagem cadastrada.
            </li>
          )}
          {vantagens.map((v) =>
            editando === v.id ? (
              <li key={v.id} className="p-2">
                <FormularioDaVantagem
                  vantagem={v}
                  aoSalvar={salvar}
                  aoCancelar={() => setEditando(null)}
                  ocupado={isPending}
                />
              </li>
            ) : (
              <li key={v.id} className="flex items-center gap-2 p-2">
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${v.isActive ? "" : "text-muted-foreground line-through"}`}>
                    {v.name}
                    {!v.isActive && (
                      <span className="ml-2 text-xs font-normal no-underline">
                        (indisponível)
                      </span>
                    )}
                  </p>
                  {v.description && (
                    <p className="text-xs text-muted-foreground">{v.description}</p>
                  )}
                </div>
                {confirmando === v.id ? (
                  <>
                    <span className="text-xs text-destructive">Excluir de vez?</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={isPending}
                      onClick={() => excluir(v.id)}
                    >
                      Excluir
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmando(null)}>
                      Cancelar
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
                      aria-label={`Editar ${v.name}`}
                      onClick={() => setEditando(v.id)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
                      aria-label={`Excluir ${v.name}`}
                      onClick={() => setConfirmando(v.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                )}
              </li>
            )
          )}
        </ul>

        {criando ? (
          <div className="rounded-md border p-2">
            <FormularioDaVantagem
              vantagem={null}
              aoSalvar={salvar}
              aoCancelar={() => setCriando(false)}
              ocupado={isPending}
            />
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setCriando(true)}>
            <Plus className="mr-1 size-3.5" />
            Nova vantagem
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function FormularioDaVantagem({
  vantagem,
  aoSalvar,
  aoCancelar,
  ocupado,
}: {
  vantagem: Vantagem | null;
  aoSalvar: (e: React.FormEvent<HTMLFormElement>) => void;
  aoCancelar: () => void;
  ocupado: boolean;
}) {
  const id = vantagem?.id ?? "nova";
  return (
    <form onSubmit={aoSalvar} className="space-y-2">
      {vantagem && <input type="hidden" name="perk_id" value={vantagem.id} />}
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor={`vant_nome_${id}`}>Nome</Label>
          <Input
            id={`vant_nome_${id}`}
            name="name"
            required
            maxLength={120}
            defaultValue={vantagem?.name ?? ""}
            placeholder="Palestras na empresa"
          />
        </div>
        <div>
          <Label htmlFor={`vant_desc_${id}`}>O que é</Label>
          <Input
            id={`vant_desc_${id}`}
            name="description"
            defaultValue={vantagem?.description ?? ""}
            placeholder="Aparece na proposta quando não houver detalhe"
          />
        </div>
      </div>
      {vantagem && (
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={vantagem.isActive}
            className="size-4"
          />
          Disponível para novas propostas e grupos
        </label>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={ocupado}>
          {vantagem ? "Salvar" : "Criar vantagem"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={aoCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
