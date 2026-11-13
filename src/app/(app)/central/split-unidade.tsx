"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { atualizarSplitAgora, confirmarSplitEmZero, salvarQuemPedeEstorno, salvarSaldoMinimo } from "./split-actions";

/** ASA3, entrega 2 (4009): os botões da aba Taxas da franquia. */

export function BotaoAtualizarAgora({ clinicId }: { clinicId: string }) {
  const router = useRouter();
  const [pendente, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pendente}
      onClick={() =>
        start(async () => {
          const r = await atualizarSplitAgora(clinicId);
          if (!r.ok) {
            toast.error(r.error ?? "Não foi possível atualizar.");
            return;
          }
          toast.success(
            r.conferidas
              ? `Conferidas ${r.conferidas} cobrança(s); ${r.alteradas ?? 0} com o split atualizado no Asaas${r.falharam ? `, ${r.falharam} com falha (tenta de novo sozinho)` : ""}.`
              : "Nenhuma cobrança precisava mudar."
          );
          router.refresh();
        })
      }
    >
      {pendente ? "Atualizando…" : "Atualizar agora"}
    </Button>
  );
}

export function ConfirmarTaxasEmZero({ clinicId, quantas }: { clinicId: string; quantas: number }) {
  const router = useRouter();
  const [pendente, start] = useTransition();
  const [motivo, setMotivo] = useState("");
  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
      <p>
        <strong>{quantas} cobrança(s)</strong> em aberto ficaram com <strong>todas as taxas em zero</strong>. O split
        delas só é retirado com a sua confirmação (isenção ou campanha registrada). Sem confirmar, o split que está fica.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          className="h-8 max-w-sm"
          placeholder="Motivo (ex.: isenção de royalty de novembro)"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          disabled={pendente}
        />
        <Button
          size="sm"
          disabled={pendente || motivo.trim().length < 5}
          onClick={() =>
            start(async () => {
              const r = await confirmarSplitEmZero(clinicId, motivo);
              if (!r.ok) {
                toast.error(r.error ?? "Não foi possível confirmar.");
                return;
              }
              toast.success("Confirmado. A fila tira o split dessas cobranças na próxima rodada.");
              router.refresh();
            })
          }
        >
          Confirmar a retirada do split
        </Button>
      </div>
    </div>
  );
}

export function SaldoMinimo({ inicialCentavos, podeEditar }: { inicialCentavos: number | null; podeEditar: boolean }) {
  const router = useRouter();
  const [pendente, start] = useTransition();
  const [valor, setValor] = useState(inicialCentavos == null ? "" : (inicialCentavos / 100).toFixed(2).replace(".", ","));
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">Saldo mínimo da conta da franqueadora (R$)</span>
      <div className="flex gap-2">
        <Input
          className="max-w-40"
          value={valor}
          placeholder="em branco"
          inputMode="decimal"
          disabled={!podeEditar || pendente}
          onChange={(e) => setValor(e.target.value)}
        />
        {podeEditar && (
          <Button
            variant="outline"
            disabled={pendente}
            onClick={() =>
              start(async () => {
                const t = valor.trim().replace(/\./g, "").replace(",", ".");
                const n = t ? Number(t) : null;
                if (n != null && !Number.isFinite(n)) {
                  toast.error("Use vírgula para os centavos.");
                  return;
                }
                const r = await salvarSaldoMinimo(n == null ? null : Math.round(n * 100));
                if (!r.ok) toast.error(r.error ?? "Não foi possível gravar.");
                else {
                  toast.success("Gravado.");
                  router.refresh();
                }
              })
            }
          >
            Gravar
          </Button>
        )}
      </div>
      <span className="block text-xs text-muted-foreground">
        Estornos devolvem o split desta conta; se ela ficar sem saldo, fica negativa. Abaixo deste valor, o Financeiro é
        avisado. Em branco = sem aviso (o saldo negativo avisa sempre).
      </span>
    </label>
  );
}

export function QuemPedeEstorno({ clinicId, gerenteTambem, podeEditar }: { clinicId: string; gerenteTambem: boolean; podeEditar: boolean }) {
  const router = useRouter();
  const [pendente, start] = useTransition();
  return (
    <div className="space-y-2 text-sm">
      <p>
        Pode pedir estorno quem tem o <strong>acesso de autorização da conta Asaas</strong> desta unidade (o código que o
        Asaas manda por SMS ou pelo aplicativo). O riSZon <strong>nunca</strong> pede, recebe nem guarda esse código.
      </p>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked disabled /> Franqueado (padrão)
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={gerenteTambem}
          disabled={!podeEditar || pendente}
          onChange={(e) =>
            start(async () => {
              const r = await salvarQuemPedeEstorno(clinicId, e.target.checked);
              if (!r.ok) toast.error(r.error ?? "Não foi possível gravar.");
              else router.refresh();
            })
          }
        />
        Gerente da unidade (só o Admin Master libera)
      </label>
    </div>
  );
}
