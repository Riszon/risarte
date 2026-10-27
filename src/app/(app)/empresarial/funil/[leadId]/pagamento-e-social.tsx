"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  type PaymentModel,
} from "@/lib/empresarial/constants";
import { participaDoSocial, type MetaSocial } from "@/lib/empresarial/riso-social";
import { MetasDoSocial, metasParaLinhas, type LinhaDeMeta } from "../../metas-do-social";
import { savePaymentAndSocial } from "./actions";

export type PagamentoESocialView = {
  /** Nulo = não definido na proposta (vale o padrão: os três). */
  metodos: PaymentMethod[] | null;
  parcelas: number | null;
  participa: boolean | null;
  metas: MetaSocial[];
};

/**
 * PAGAMENTO DO TRATAMENTO E RISO+ SOCIAL (1034, dono em 26/10/2026).
 *
 * Fica no passo Benefícios porque é o que a empresa GANHA: condição de
 * pagamento diferenciada na clínica e a chance de indicar pessoas carentes.
 * Formulário próprio, com salvar próprio — como cada editor do passo.
 */
export function PagamentoESocial({
  leadId,
  inicial,
  modeloDePagamento,
}: {
  leadId: string;
  inicial: PagamentoESocialView;
  /** O que está escolhido no passo 1 agora — decide se o Riso+ Social existe. */
  modeloDePagamento: PaymentModel | "";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [metodos, setMetodos] = useState<PaymentMethod[]>(
    inicial.metodos ?? [...PAYMENT_METHODS]
  );
  const [participa, setParticipa] = useState(inicial.participa ?? true);
  const [linhas, setLinhas] = useState<LinhaDeMeta[]>(metasParaLinhas(inicial.metas));
  const podeSocial = participaDoSocial(modeloDePagamento || null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await savePaymentAndSocial(leadId, formData);
      if (r.ok) {
        toast.success("Pagamento e Riso+ Social salvos.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Card>
      <CardContent className="p-4">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <div>
              <p className="text-sm font-medium">Pagamento do tratamento</p>
              <p className="text-xs text-muted-foreground">
                Como o titular e o dependente pagam o tratamento na clínica. Vale
                somado à regra da unidade: o programa acrescenta meios, nunca
                tira.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              {PAYMENT_METHODS.map((m) => (
                <label key={m} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="treatment_payment_methods"
                    value={m}
                    checked={metodos.includes(m)}
                    onChange={(e) =>
                      setMetodos((a) =>
                        e.target.checked ? [...a, m] : a.filter((x) => x !== m)
                      )
                    }
                    className="size-4"
                  />
                  {PAYMENT_METHOD_LABELS[m]}
                </label>
              ))}
              <label className="text-xs">
                Parcelamento em até (x)
                <Input
                  name="treatment_max_installments"
                  type="number"
                  min={1}
                  max={24}
                  defaultValue={inicial.parcelas ?? 24}
                  className="h-8 w-24"
                />
              </label>
            </div>
            {metodos.length === 0 && (
              <p className="text-xs text-destructive">Marque ao menos um meio de pagamento.</p>
            )}
          </div>

          <div className="space-y-2 border-t pt-3">
            <div>
              <p className="text-sm font-medium">Riso+ Social</p>
              <p className="text-xs text-muted-foreground">
                A empresa indica pessoas carentes para tratamento, conforme as
                metas combinadas. Cada meta atingida rende indicações; o gestor
                do programa libera.
              </p>
            </div>
            {!podeSocial ? (
              <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                Só participa a empresa que <strong>paga pelo colaborador</strong>{" "}
                (integral ou parcial). No modelo escolhido no passo 1, o Riso+
                Social não se aplica.
              </p>
            ) : (
              <>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="social_participates"
                    checked={participa}
                    onChange={(e) => setParticipa(e.target.checked)}
                    className="size-4"
                  />
                  Esta empresa participa do Riso+ Social
                </label>
                {participa && <MetasDoSocial linhas={linhas} aoMudar={setLinhas} />}
              </>
            )}
            {/* Fora do Riso+ Social, as metas não vão no formulário: o
                servidor guarda "não participa" e não apaga as metas. */}
            <input type="hidden" name="social_no_formulario" value={podeSocial ? "1" : ""} />
          </div>

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={isPending || metodos.length === 0}>
              Salvar pagamento e Riso+ Social
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
