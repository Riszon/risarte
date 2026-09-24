"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { FileText, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL } from "@/lib/pricing";
import { formatBrDate } from "@/lib/dates";
import {
  aceitarTermoDeInclusao,
  cancelarTermoDeInclusao,
  criarTermoDeInclusao,
} from "./inclusion-actions";

export type TermoDeInclusao = {
  id: string;
  code: string;
  holders: number;
  dependents: number;
  monthlyDeltaCents: number;
  implantationCents: number;
  status: "RASCUNHO" | "ACEITO" | "CANCELADO";
  acceptedAt: string | null;
  createdAt: string;
};

/**
 * O LIMITE DE TITULARES E OS TERMOS DE INCLUSÃO (OC-00083, I4).
 *
 * Pedido do dono: *"a empresa tem 100 colaboradores, e quando foi fazer o
 * cadastro enviou 120 nomes — o sistema não pode permitir cadastrar os 120.
 * Deve ter algum botão para acrescentar mais colaboradores, para isso deve
 * gerar uma proposta para incluir os novos."*
 *
 * ⚠️ ESTE CARTÃO EXISTE PARA A TRAVA NÃO SER UMA SURPRESA. Sem ele, a pessoa
 * descobriria o limite ao ser recusada no 101º cadastro, sem saber por quê nem
 * o que fazer. Aqui o número aparece ANTES, e o caminho também.
 */
export function LimiteDeTitulares({
  companyId,
  contratado,
  limite,
  ativos,
  termos,
  podeGerenciar,
}: {
  companyId: string;
  /** O que o contrato fechou. `null` = contrato sem quantidade. */
  contratado: number | null;
  /** Contratado + termos aceitos. `null` = sem trava. */
  limite: number | null;
  ativos: number;
  termos: TermoDeInclusao[];
  /** Só o gestor do programa gera e aceita termo. */
  podeGerenciar: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [gerando, setGerando] = useState(false);

  // ⚠️ SEM QUANTIDADE CONTRATADA, O CARTÃO NÃO APARECE. Mostrar "sem limite"
  // em toda empresa antiga seria ruído — e sugeriria que falta configurar algo
  // que ninguém precisa configurar.
  if (contratado == null || limite == null) return null;

  const vagas = Math.max(0, limite - ativos);
  const acrescentado = limite - contratado;

  function gerar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await criarTermoDeInclusao(companyId, formData);
      if (r.ok) {
        // O aviso vem junto com o sucesso: o termo existe e nasceu sem valor.
        if (r.error) toast.warning(r.error, { duration: 12000 });
        else toast.success(`Termo ${r.code} gerado.`);
        setGerando(false);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  function aceitar(id: string) {
    startTransition(async () => {
      const r = await aceitarTermoDeInclusao(companyId, id);
      if (r.ok) {
        toast.success("Termo aceito — os cadastros estão liberados.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.", { duration: 10000 });
    });
  }

  function cancelar(id: string) {
    startTransition(async () => {
      const r = await cancelarTermoDeInclusao(companyId, id);
      if (r.ok) {
        toast.success("Termo cancelado.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Card className={vagas === 0 ? "border-amber-500/50" : undefined}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Quantidade contratada</p>
            <p className="text-xs text-muted-foreground">
              O contrato fechou <strong>{contratado}</strong> titular(es)
              {acrescentado > 0 && (
                <>
                  , e os termos de inclusão aceitos acrescentaram{" "}
                  <strong>{acrescentado}</strong>
                </>
              )}
              . Cadastrados hoje: <strong>{ativos}</strong>.
            </p>
          </div>
          <p
            className={`text-sm font-semibold ${
              vagas === 0 ? "text-amber-700 dark:text-amber-400" : "text-foreground"
            }`}
          >
            {vagas === 0 ? "Sem vagas" : `${vagas} vaga(s)`}
          </p>
        </div>

        {vagas === 0 && (
          <p className="rounded-md bg-amber-500/10 p-2 text-xs">
            Novos cadastros estão <strong>bloqueados</strong>. Para incluir mais
            titulares, gere um termo de inclusão: ele calcula a diferença e,
            depois de aceito pela empresa, libera os cadastros.
          </p>
        )}

        {podeGerenciar &&
          (gerando ? (
            <form onSubmit={gerar} className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Termo de inclusão</p>
              <p className="text-xs text-muted-foreground">
                Documento curto, referente ao acordo que já existe: ele não
                renegocia benefício, carência nem unidade — só acrescenta gente.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label htmlFor="holders">Titulares a mais</Label>
                  <Input id="holders" name="holders" type="number" min={0} defaultValue={0} />
                </div>
                <div>
                  <Label htmlFor="dependents">Dependentes a mais</Label>
                  <Input
                    id="dependents"
                    name="dependents"
                    type="number"
                    min={0}
                    defaultValue={0}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="notes">Observação (opcional)</Label>
                <Input id="notes" name="notes" placeholder="o que motivou a inclusão" />
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={isPending}>
                  Gerar termo
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setGerando(false)}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setGerando(true)}>
              <UserPlus className="mr-1.5 size-4" />
              Incluir mais titulares
            </Button>
          ))}

        {termos.length > 0 && (
          <ul className="divide-y rounded-md border text-sm">
            {termos.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2">
                {/* O CÓDIGO NUNCA SOME (regra do dono, 07/08/2026): é ele que
                    amarra o termo à cobrança e ao histórico. */}
                <span className="font-mono text-xs">{t.code}</span>
                <span className="flex-1">
                  {t.holders > 0 && `${t.holders} titular(es)`}
                  {t.holders > 0 && t.dependents > 0 && " e "}
                  {t.dependents > 0 && `${t.dependents} dependente(s)`}
                  {t.monthlyDeltaCents > 0 ? (
                    <> · +{formatBRL(t.monthlyDeltaCents)}/mês</>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-400">
                      {" "}
                      · sem valor combinado
                    </span>
                  )}
                  {t.implantationCents > 0 && (
                    <> · implantação {formatBRL(t.implantationCents)}</>
                  )}
                </span>
                <span
                  className={`text-xs ${
                    t.status === "ACEITO"
                      ? "text-emerald-700 dark:text-emerald-400"
                      : t.status === "CANCELADO"
                        ? "text-muted-foreground line-through"
                        : "text-amber-700 dark:text-amber-400"
                  }`}
                >
                  {t.status === "ACEITO"
                    ? `aceito em ${formatBrDate(t.acceptedAt ?? t.createdAt)}`
                    : t.status === "CANCELADO"
                      ? "cancelado"
                      : "aguardando aceite"}
                </span>
                <span className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    nativeButton={false}
                    render={
                      <Link
                        href={`/empresarial/${companyId}/termo/${t.id}`}
                        target="_blank"
                      />
                    }
                  >
                    <FileText className="mr-1 size-3.5" />
                    Abrir
                  </Button>
                  {podeGerenciar && t.status === "RASCUNHO" && (
                    <>
                      <Button
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={isPending}
                        onClick={() => aceitar(t.id)}
                      >
                        Aceitar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive"
                        disabled={isPending}
                        onClick={() => cancelar(t.id)}
                      >
                        Cancelar
                      </Button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
