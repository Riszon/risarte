"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  SITUACOES_DO_COMPROMISSO,
  SITUACAO_ROTULO,
  resumoDosCompromissos,
  type SituacaoDoCompromisso,
  type Vantagem,
} from "@/lib/empresarial/vantagens";
import { formatBrDate } from "@/lib/dates";
import { atualizarCompromisso, incluirCompromisso, removerCompromisso } from "./vantagens-actions";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

export type CompromissoView = {
  id: string;
  name: string;
  detail: string | null;
  status: SituacaoDoCompromisso;
  statusNote: string | null;
  statusChangedAt: string | null;
};

const COR: Record<SituacaoDoCompromisso, string> = {
  PENDING: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  IN_PROGRESS: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  DELIVERED: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
};

/**
 * AS VANTAGENS COMBINADAS — e se foram entregues (1033, dono em 26/10/2026).
 *
 * Vieram da proposta no fechamento (nome e detalhe copiados). Palestra que
 * ainda não aconteceu fica "Pendente" à vista — promessa esquecida é o tipo de
 * coisa que a empresa lembra na renovação.
 */
export function VantagensDaEmpresa({
  companyId,
  compromissos,
  catalogo,
  podeEditar,
}: {
  companyId: string;
  compromissos: CompromissoView[];
  catalogo: Vantagem[];
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [incluindo, setIncluindo] = useState(false);

  function executar(acao: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    startTransition(async () => {
      const r = await acao();
      if (r.ok) {
        toast.success(ok);
        setIncluindo(false);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Outras vantagens combinadas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          O que a empresa ganhou além dos procedimentos, e se já foi entregue:{" "}
          <strong>{resumoDosCompromissos(compromissos)}</strong>.
        </p>

        {compromissos.length === 0 && (
          <p className="rounded-md border border-dashed p-3 text-center text-sm text-muted-foreground">
            Nenhuma vantagem combinada além dos procedimentos.
          </p>
        )}

        <ul className="space-y-2">
          {compromissos.map((c) => (
            <li key={c.id} className="rounded-md border p-2">
              {podeEditar ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    executar(() => atualizarCompromisso(companyId, c.id, fd), "Vantagem atualizada.");
                  }}
                  className="space-y-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-40 flex-1 text-sm font-medium">{c.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${COR[c.status]}`}>
                      {SITUACAO_ROTULO[c.status]}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
                      aria-label={`Tirar ${c.name}`}
                      disabled={isPending}
                      onClick={() =>
                        executar(() => removerCompromisso(companyId, c.id), "Vantagem retirada.")
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
                    <Input
                      name="detail"
                      defaultValue={c.detail ?? ""}
                      aria-label={`Detalhe de ${c.name}`}
                      placeholder="O que foi combinado"
                      className="h-8 text-sm"
                    />
                    <select
                      name="status"
                      defaultValue={c.status}
                      aria-label={`Situação de ${c.name}`}
                      className={selectClass}
                    >
                      {SITUACOES_DO_COMPROMISSO.map((s) => (
                        <option key={s} value={s}>
                          {SITUACAO_ROTULO[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      name="status_note"
                      defaultValue={c.statusNote ?? ""}
                      aria-label={`Anotação de ${c.name}`}
                      placeholder="Anotação (ex.: palestra marcada para 12/11)"
                      className="h-8 min-w-56 flex-1 text-sm"
                    />
                    <Button type="submit" size="sm" variant="outline" disabled={isPending}>
                      Salvar
                    </Button>
                  </div>
                  {c.statusChangedAt && (
                    <p className="text-xs text-muted-foreground">
                      Atualizada em {formatBrDate(c.statusChangedAt)}.
                    </p>
                  )}
                </form>
              ) : (
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="flex-1 text-sm font-medium">{c.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${COR[c.status]}`}>
                      {SITUACAO_ROTULO[c.status]}
                    </span>
                  </div>
                  {c.detail && <p className="text-xs text-muted-foreground">{c.detail}</p>}
                  {c.statusNote && <p className="text-xs">{c.statusNote}</p>}
                </div>
              )}
            </li>
          ))}
        </ul>

        {podeEditar &&
          (incluindo ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                executar(() => incluirCompromisso(companyId, fd), "Vantagem incluída.");
              }}
              className="grid gap-2 rounded-md border p-2 sm:grid-cols-[14rem_1fr_auto]"
            >
              <select name="perk_id" required aria-label="Vantagem" className={selectClass}>
                <option value="">— escolher vantagem —</option>
                {catalogo
                  .filter((v) => v.isActive)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
              </select>
              <Input name="detail" placeholder="O que foi combinado" className="h-8 text-sm" />
              <div className="flex gap-1">
                <Button type="submit" size="sm" disabled={isPending}>
                  Incluir
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setIncluindo(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setIncluindo(true)}>
              <Plus className="mr-1 size-3.5" />
              Incluir vantagem
            </Button>
          ))}
      </CardContent>
    </Card>
  );
}
