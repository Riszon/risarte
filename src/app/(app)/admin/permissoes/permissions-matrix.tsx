"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Database, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";
import type { Capability } from "@/lib/permissions";
import { restaurarPadrao, salvarPermissao } from "./actions";

/**
 * A grade: uma linha por permissão, uma coluna por papel.
 *
 * Salva UMA permissão por vez, no clique de "Salvar" da linha — não a cada
 * marcação. Salvar a cada clique faria uma ida ao banco por caixinha e, pior,
 * deixaria a permissão passando por estados intermediários que ninguém pediu
 * (o gerente perdendo o acesso por um instante entre desmarcar e marcar).
 */
export function PermissionsMatrix({
  capacidades,
  papeis,
  atual,
  padrao,
  aindaSemTabela,
}: {
  capacidades: Capability[];
  papeis: UserRole[];
  atual: Record<string, UserRole[]>;
  padrao: Record<string, UserRole[]>;
  aindaSemTabela: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rascunho, setRascunho] = useState<Record<string, UserRole[]>>(atual);
  const [salvando, setSalvando] = useState<string | null>(null);

  const grupos = useMemo(
    () => [...new Set(capacidades.map((c) => c.grupo))],
    [capacidades]
  );

  function marcado(cap: string, papel: UserRole) {
    return (rascunho[cap] ?? []).includes(papel);
  }

  function alternar(cap: string, papel: UserRole) {
    setRascunho((prev) => {
      const atuais = prev[cap] ?? [];
      return {
        ...prev,
        [cap]: atuais.includes(papel)
          ? atuais.filter((p) => p !== papel)
          : [...atuais, papel],
      };
    });
  }

  /** Mudou em relação ao que está gravado? É o que habilita o "Salvar". */
  function alterada(cap: string) {
    const a = [...(atual[cap] ?? [])].sort().join(",");
    const b = [...(rascunho[cap] ?? [])].sort().join(",");
    return a !== b;
  }

  function noPadrao(cap: string) {
    const a = [...(padrao[cap] ?? [])].sort().join(",");
    const b = [...(rascunho[cap] ?? [])].sort().join(",");
    return a === b;
  }

  function salvar(cap: Capability) {
    setSalvando(cap.id);
    startTransition(async () => {
      const r = await salvarPermissao(cap.id, rascunho[cap.id] ?? []);
      setSalvando(null);
      if (r.ok) {
        toast.success(`"${cap.rotulo}" salvo.`);
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível salvar.");
      }
    });
  }

  function voltarAoPadrao(cap: Capability) {
    setSalvando(cap.id);
    startTransition(async () => {
      const r = await restaurarPadrao(cap.id);
      setSalvando(null);
      if (r.ok) {
        setRascunho((prev) => ({
          ...prev,
          [cap.id]: [...(padrao[cap.id] ?? [])],
        }));
        toast.success(`"${cap.rotulo}" voltou ao padrão.`);
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível restaurar.");
      }
    });
  }

  return (
    <div className="mx-auto max-w-[100rem] space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold">
          Matriz de permissões
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Quem pode o quê, por função. Marque ou desmarque e clique em{" "}
          <strong>Salvar</strong> na linha. A mudança vale para toda a rede e
          passa a valer na próxima tela que a pessoa abrir.
        </p>
      </header>

      {aindaSemTabela && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            A tabela de permissões ainda não existe neste banco — o que você vê
            abaixo é o <strong>padrão do sistema</strong>. Rode a{" "}
            <strong>migração 0246</strong> para poder salvar alterações.
          </p>
        </div>
      )}

      <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="space-y-1">
          <p>
            <strong>O Admin Master não aparece na matriz.</strong> Ele passa por
            cima de todas as permissões, sempre. Se pudesse perder acesso aqui,
            seria a porta trancada com a chave dentro.
          </p>
          <p className="text-muted-foreground">
            <strong>Desligar</strong> uma permissão sempre funciona.{" "}
            <strong>Ligar</strong> uma marcada com{" "}
            <Database className="inline size-3 align-[-2px]" /> abre a tela, mas
            os dados podem vir vazios — nessas, o banco também decide, e a regra
            dele continua a mesma até ser ajustada.
          </p>
        </div>
      </div>

      {grupos.map((grupo) => (
        <Card key={grupo}>
          <CardHeader>
            <CardTitle className="text-base">{grupo}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="sticky left-0 z-10 min-w-[22rem] bg-muted/40 p-3 text-left font-medium">
                      Permissão
                    </th>
                    {papeis.map((p) => (
                      <th
                        key={p}
                        className="p-2 text-center align-bottom font-medium"
                      >
                        {/* Vertical: 15 colunas de nome inteiro não caberiam em
                            tela nenhuma, e abreviar viraria adivinhação. */}
                        <span
                          className="inline-block whitespace-nowrap text-xs text-muted-foreground"
                          style={{
                            writingMode: "vertical-rl",
                            rotate: "180deg",
                          }}
                        >
                          {ROLE_LABELS[p]}
                        </span>
                      </th>
                    ))}
                    <th className="p-3 text-right font-medium">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {capacidades
                    .filter((c) => c.grupo === grupo)
                    .map((cap) => (
                      <tr key={cap.id} className="border-b last:border-0">
                        <td className="sticky left-0 z-10 bg-background p-3 align-top">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{cap.rotulo}</span>
                            {cap.dependeDoBanco && (
                              <Badge
                                variant="outline"
                                className="gap-1 text-[10px] font-normal"
                                title="O banco de dados também decide: ligar aqui abre a tela, mas os dados podem vir vazios."
                              >
                                <Database className="size-3" />o banco também
                                decide
                              </Badge>
                            )}
                            {!noPadrao(cap.id) && (
                              <Badge className="bg-amber-500 text-[10px] text-white">
                                fora do padrão
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 max-w-md text-xs text-muted-foreground">
                            {cap.descricao}
                          </p>
                        </td>

                        {papeis.map((p) => (
                          <td key={p} className="p-2 text-center align-middle">
                            <input
                              type="checkbox"
                              className="size-4 cursor-pointer"
                              checked={marcado(cap.id, p)}
                              disabled={isPending || aindaSemTabela}
                              onChange={() => alternar(cap.id, p)}
                              aria-label={`${ROLE_LABELS[p]} — ${cap.rotulo}`}
                            />
                          </td>
                        ))}

                        <td className="p-3 text-right align-middle">
                          <div className="flex justify-end gap-1">
                            {!noPadrao(cap.id) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Voltar ao padrão do sistema"
                                disabled={isPending || aindaSemTabela}
                                onClick={() => voltarAoPadrao(cap)}
                              >
                                <RotateCcw className="size-3.5" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              disabled={
                                !alterada(cap.id) || isPending || aindaSemTabela
                              }
                              onClick={() => salvar(cap)}
                            >
                              {salvando === cap.id ? "Salvando…" : "Salvar"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}

      <p className="text-xs text-muted-foreground">
        Toda alteração fica registrada na Auditoria, com quem mudou, quando e
        quais funções passaram a ter a permissão.
      </p>
    </div>
  );
}
