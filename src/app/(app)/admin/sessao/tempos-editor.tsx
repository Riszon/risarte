"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  INATIVIDADE_MAX,
  INATIVIDADE_MIN,
  PAPEL_ADMIN,
  PAPEL_PADRAO,
} from "@/lib/acesso";
import { salvarTemposDeInatividade } from "./actions";

/**
 * O tempo de inatividade: o padrão e o de cada função (0287).
 * Em branco = a função segue o padrão.
 */
export function TemposEditor({
  tempos,
  papeis,
  podeSalvar,
}: {
  /** papel → minutos, só para quem tem regra própria (e o padrão, '*'). */
  tempos: Record<string, number>;
  papeis: { papel: string; rotulo: string }[];
  /** Falso quando a configuração não pôde ser lida (banco sem a 0287). */
  podeSalvar: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const padrao = tempos[PAPEL_PADRAO];

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await salvarTemposDeInatividade(formData);
      if (r.ok) {
        toast.success("Tempos de inatividade salvos.");
        router.refresh();
      } else {
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  const campo = (papel: string, rotulo: string, obrigatorio: boolean) => (
    <div key={papel} className="flex items-center justify-between gap-4">
      <Label htmlFor={`papel-${papel}`} className="flex-1">
        {rotulo}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          // O campo não é controlado: a chave o refaz quando o valor salvo
          // muda. Sem ela, depois de salvar o valor inicial mudaria com o
          // campo já montado (o navegador mantém o que foi digitado, mas a
          // biblioteca avisa — e aviso que sempre aparece ninguém lê).
          key={`${papel}:${tempos[papel] ?? ""}`}
          id={`papel-${papel}`}
          name={`papel:${papel}`}
          type="number"
          inputMode="numeric"
          min={INATIVIDADE_MIN}
          max={INATIVIDADE_MAX}
          required={obrigatorio}
          defaultValue={tempos[papel] ?? ""}
          placeholder={obrigatorio ? "" : padrao ? `${padrao} (padrão)` : "padrão"}
          className="w-32 text-right"
        />
        <span className="w-8 text-xs text-muted-foreground">min</span>
      </div>
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Padrão</CardTitle>
          <CardDescription>
            Vale para toda função que não tiver um tempo próprio abaixo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {campo(PAPEL_PADRAO, "Minutos sem uso até desconectar", true)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Por função</CardTitle>
          <CardDescription>
            Deixe em branco para a função seguir o padrão. Quem tem mais de uma
            função fica com o <strong>menor</strong> tempo entre elas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {campo(PAPEL_ADMIN, "Admin Master", false)}
          {papeis.map((p) => campo(p.papel, p.rotulo, false))}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending || !podeSalvar}>
          {isPending ? "Salvando..." : "Salvar tempos"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Entre {INATIVIDADE_MIN} e {INATIVIDADE_MAX} minutos. A mudança vale a
          partir do próximo clique de cada pessoa.
        </p>
      </div>
    </form>
  );
}
