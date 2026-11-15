"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { concluirOperacao, reemitirDaOperacao } from "@/app/(app)/comercial/boletos-actions";

export type OperacaoInterrompida = {
  id: string;
  client_id: string | null;
  cliente: string | null;
  operacao: string;
  parcelas: number;
  boletos_cancelados: number;
  erro: string | null;
  quando: string;
  quem: string | null;
};

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * ASA4, 1B (4015; spec 19.27 ponto 1): a OPERAÇÃO INTERROMPIDA — os boletos foram
 * cancelados no Asaas, mas a mudança não entrou no riSZon. A parcela não fica
 * sem boleto em silêncio: aparece aqui (e quem fez e o Gerente foram avisados),
 * com "Reemitir os boletos" ou "Marcar como concluída" (depois de refazer a
 * operação na ficha).
 */
export function OperacoesInterrompidas({ itens }: { itens: OperacaoInterrompida[] }) {
  const router = useRouter();
  const [ocupado, start] = useTransition();
  const [nota, setNota] = useState<Record<string, string>>({});
  if (!itens.length) return null;
  return (
    <section className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
        <AlertTriangle className="size-4" /> Operações interrompidas ({itens.length})
      </h2>
      <p className="text-xs text-muted-foreground">
        O boleto foi cancelado no Asaas e a mudança não entrou no riSZon: a parcela está sem boleto. Refaça a operação na ficha e marque como concluída, ou
        reemita os boletos das parcelas que continuam em aberto.
      </p>
      <ul className="divide-y rounded-lg border bg-background text-sm">
        {itens.map((f) => (
          <li key={f.id} className="space-y-1 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-28 text-xs text-muted-foreground">{quando(f.quando)}</span>
              {f.client_id ? (
                <Link href={`/prontuarios/${f.client_id}`} className="min-w-0 flex-1 truncate hover:underline">
                  {f.cliente ?? "—"}
                </Link>
              ) : (
                <span className="flex-1">—</span>
              )}
              <span className="text-xs">
                {f.operacao} · {f.boletos_cancelados} boleto(s) cancelado(s) · por {f.quem ?? "—"}
              </span>
            </div>
            {f.erro && <p className="text-[11px] text-muted-foreground">Erro: {f.erro}</p>}
            <div className="flex flex-wrap items-center gap-1">
              <Button
                size="sm"
                className="h-7 text-[11px]"
                disabled={ocupado}
                onClick={() =>
                  start(async () => {
                    const r = await reemitirDaOperacao(f.id);
                    if (!r.ok) toast.error(r.error);
                    else toast.success(`Reemitidos ${r.criados ?? 0} boleto(s). Pendência concluída.`);
                    router.refresh();
                  })
                }
              >
                Reemitir os boletos
              </Button>
              <input
                className="h-7 min-w-48 rounded-md border border-input bg-background px-2 text-[11px]"
                placeholder="O que foi feito (ex.: renegociação refeita)"
                value={nota[f.id] ?? ""}
                onChange={(e) => setNota({ ...nota, [f.id]: e.target.value })}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                disabled={ocupado || (nota[f.id] ?? "").trim().length < 5}
                onClick={() =>
                  start(async () => {
                    const r = await concluirOperacao({ id: f.id, nota: nota[f.id] ?? "" });
                    if (!r.ok) toast.error(r.error);
                    else toast.success("Pendência concluída.");
                    router.refresh();
                  })
                }
              >
                Marcar como concluída
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
