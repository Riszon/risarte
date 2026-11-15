"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Circle, MinusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatIsoDateBr } from "@/lib/dates";
import {
  CLOSING_ITEM_HELP,
  CLOSING_ITEM_LABELS,
  faltamNoEncerramento,
  type ItemDoEncerramento,
} from "@/lib/finance/dividas-acordos";
import type { Anexo } from "../dados";
import { salvarItemDoEncerramento } from "../actions";
import { Campo, SELECT, useAcao } from "./comum";

// O checklist de encerramento (3.3, 0408): nasce quando a dívida fica
// quitada, só com o que se aplica a ela. Tudo feito (ou "não se aplica", com
// motivo) → Quitada — encerrada. Quem decide a situação é o banco.

type Edicao = { item: ItemDoEncerramento; modo: "feito" | "nao_aplica"; data: string; anexoId: string; texto: string };

export function Encerramento({
  debtId,
  itens,
  anexos,
  nomes,
  hoje,
  podeLancar,
}: {
  debtId: string;
  itens: ItemDoEncerramento[];
  anexos: Anexo[];
  nomes: Record<string, string>;
  hoje: string;
  podeLancar: boolean;
}) {
  const { ocupado, rodar } = useAcao();
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const faltam = faltamNoEncerramento(itens);
  const anexosVivos = anexos.filter((a) => !a.removedAt);

  if (itens.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        O checklist de encerramento aparece quando a dívida fica quitada (todos os títulos — ou todas as parcelas do acordo —
        pagos).
      </p>
    );
  }

  const salvar = () => {
    if (!edicao) return;
    if (edicao.modo === "nao_aplica" && edicao.texto.trim().length < 5) return toast.error("Escreva por que este item não se aplica.");
    rodar(
      () =>
        salvarItemDoEncerramento(debtId, {
          id: edicao.item.id,
          applicable: edicao.modo === "feito",
          done: edicao.modo === "feito",
          done_on: edicao.data || hoje,
          attachment_id: edicao.anexoId || null,
          not_applicable_reason: edicao.modo === "nao_aplica" ? edicao.texto : null,
          note: edicao.modo === "feito" ? edicao.texto : null,
        }),
      "Checklist atualizado.",
      () => setEdicao(null)
    );
  };

  return (
    <Card>
      <CardContent className="space-y-3 py-4 text-sm">
        <p className="font-medium">
          Encerramento — {faltam === 0 ? "tudo feito: dívida encerrada" : `falta${faltam === 1 ? "" : "m"} ${faltam} ${faltam === 1 ? "item" : "itens"}`}
        </p>
        <ul className="divide-y rounded-lg border">
          {itens.map((i) => (
            <li key={i.id} className="space-y-1 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                {!i.aplicavel ? (
                  <MinusCircle className="size-4 text-muted-foreground" />
                ) : i.feitoEm ? (
                  <CheckCircle2 className="size-4 text-emerald-600" />
                ) : (
                  <Circle className="size-4 text-amber-600" />
                )}
                <span className="flex-1 font-medium">{CLOSING_ITEM_LABELS[i.item]}</span>
                {i.prazo && !i.feitoEm && i.aplicavel && (
                  <span className={i.prazo < hoje ? "text-xs font-medium text-red-700 dark:text-red-300" : "text-xs text-muted-foreground"}>
                    prazo do credor: {formatIsoDateBr(i.prazo)}
                  </span>
                )}
                {podeLancar && (
                  <span className="flex gap-1">
                    {(!i.feitoEm || !i.aplicavel) && (
                      <Button size="sm" variant="outline" onClick={() => setEdicao({ item: i, modo: "feito", data: hoje, anexoId: i.anexoId ?? "", texto: "" })}>
                        Marcar feito
                      </Button>
                    )}
                    {i.aplicavel && !i.feitoEm && (
                      <Button size="sm" variant="ghost" onClick={() => setEdicao({ item: i, modo: "nao_aplica", data: hoje, anexoId: "", texto: "" })}>
                        Não se aplica
                      </Button>
                    )}
                  </span>
                )}
              </div>
              <p className="pl-6 text-xs text-muted-foreground">
                {!i.aplicavel
                  ? `Não se aplica: ${i.motivoDeNaoAplicar ?? ""}`
                  : i.feitoEm
                    ? `Feito em ${formatIsoDateBr(i.feitoEm)}${i.feitoPor && nomes[i.feitoPor] ? ` por ${nomes[i.feitoPor]}` : ""}${i.anexoId ? " · com anexo" : ""}${i.observacao ? ` — ${i.observacao}` : ""}`
                    : CLOSING_ITEM_HELP[i.item]}
              </p>
              {edicao?.item.id === i.id && (
                <div className="ml-6 space-y-2 rounded-md border bg-muted/30 p-3">
                  {edicao.modo === "feito" ? (
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label className="block">
                        <Label className="text-[11px]">Feito em</Label>
                        <Input type="date" className="h-9" max={hoje} value={edicao.data} onChange={(e) => setEdicao({ ...edicao, data: e.target.value })} />
                      </label>
                      <label className="block">
                        <Label className="text-[11px]">Comprovante (da aba Anexos)</Label>
                        <select className={SELECT} value={edicao.anexoId} onChange={(e) => setEdicao({ ...edicao, anexoId: e.target.value })}>
                          <option value="">Sem anexo</option>
                          {anexosVivos.map((a) => (
                            <option key={a.id} value={a.id}>{a.fileName}</option>
                          ))}
                        </select>
                      </label>
                      <Campo rotulo="Observação" valor={edicao.texto} onChange={(v) => setEdicao({ ...edicao, texto: v })} />
                    </div>
                  ) : (
                    <Campo rotulo="Por que não se aplica? *" valor={edicao.texto} onChange={(v) => setEdicao({ ...edicao, texto: v })} />
                  )}
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEdicao(null)}>Cancelar</Button>
                    <Button size="sm" disabled={ocupado} onClick={salvar}>Salvar</Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
