"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { salvarConfiguracaoDoSplit } from "./split-actions";

/**
 * O SPLIT DA REDE (ASA3, entrega 1; 4008): para onde vai cada taxa, a
 * tolerância da diferença a menor (S5) e a multa e os juros da cobrança mensal
 * à unidade (ASA6). Quem não edita vê os mesmos campos, travados.
 */

export type DestinoDaTaxa = { fee: string; label: string; accountId: string | null };
export type CarteiraDeRepasse = { accountId: string; label: string; ownerType: string; environment: string; temCarteira: boolean };

const reais = (centavos: number) => (centavos / 100).toFixed(2).replace(".", ",");
const numero = (s: string): number | null => {
  const t = s.trim().replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const texto = (n: number | null) => (n == null ? "" : String(n).replace(".", ","));

export function ConfiguracaoDoSplit({
  inicial,
  carteiras,
  podeEditar,
}: {
  inicial: { toleranciaCentavos: number; multaPercent: number | null; jurosPercent: number | null; destinos: DestinoDaTaxa[] };
  carteiras: CarteiraDeRepasse[];
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [pendente, start] = useTransition();
  const [destinos, setDestinos] = useState(inicial.destinos);
  const [tolerancia, setTolerancia] = useState(reais(inicial.toleranciaCentavos));
  const [multa, setMulta] = useState(texto(inicial.multaPercent));
  const [juros, setJuros] = useState(texto(inicial.jurosPercent));

  const raiz = carteiras.find((c) => c.ownerType === "franchisor");
  const recebedoras = carteiras.filter((c) => c.ownerType === "recipient" && c.temCarteira);

  const gravar = () => {
    const tol = numero(tolerancia);
    const m = numero(multa);
    const j = numero(juros);
    if (tol == null || Number.isNaN(tol) || Number.isNaN(m as number) || Number.isNaN(j as number)) {
      toast.error("Confira os números: use vírgula para os centavos.");
      return;
    }
    start(async () => {
      const r = await salvarConfiguracaoDoSplit({
        toleranciaCentavos: Math.round(tol * 100),
        multaPercent: m,
        jurosPercent: j,
        destinos: destinos.map((d) => ({ fee: d.fee, accountId: d.accountId })),
      });
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível gravar.");
        return;
      }
      toast.success("Gravado. Vale para as próximas cobranças emitidas.");
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Para onde vai cada taxa no split</h3>
        <p className="text-sm text-muted-foreground">
          As taxas percentuais saem da cobrança do paciente na hora do pagamento, direto para a carteira escolhida. Sem
          escolha, vão para a conta raiz da franqueadora{raiz ? ` (${raiz.label})` : ""}.
        </p>
        <div className="divide-y rounded-lg border">
          {destinos.map((d) => (
            <label key={d.fee} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="font-medium">{d.label}</span>
              <select
                className="h-8 min-w-56 rounded-lg border border-input bg-transparent px-2 text-sm disabled:opacity-60"
                disabled={!podeEditar || pendente}
                value={d.accountId ?? ""}
                onChange={(e) =>
                  setDestinos((ds) => ds.map((x) => (x.fee === d.fee ? { ...x, accountId: e.target.value || null } : x)))
                }
              >
                <option value="">Conta raiz (padrão)</option>
                {recebedoras.map((c) => (
                  <option key={c.accountId} value={c.accountId}>
                    {c.label}
                    {c.environment === "sandbox" ? " (teste)" : ""}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-sm font-medium">Tolerância por cobrança (R$)</span>
          <Input value={tolerancia} onChange={(e) => setTolerancia(e.target.value)} disabled={!podeEditar || pendente} inputMode="decimal" />
          <span className="block text-xs text-muted-foreground">
            Se o Asaas repassar até este valor a menos, a diferença é absorvida. Acima disso, o que faltou vira conta a
            pagar da unidade.
          </span>
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">Multa da cobrança à unidade (%)</span>
          <Input value={multa} onChange={(e) => setMulta(e.target.value)} disabled={!podeEditar || pendente} inputMode="decimal" placeholder="em branco" />
          <span className="block text-xs text-muted-foreground">Em branco = sem multa.</span>
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">Juros da cobrança à unidade (% ao mês)</span>
          <Input value={juros} onChange={(e) => setJuros(e.target.value)} disabled={!podeEditar || pendente} inputMode="decimal" placeholder="em branco" />
          <span className="block text-xs text-muted-foreground">Em branco = sem juros.</span>
        </label>
      </section>
      <p className="text-xs text-muted-foreground">
        Multa e juros valem para a cobrança mensal da franqueadora à unidade (taxas fixas e taxas que não passaram pelo
        split), paga em atraso. Os percentuais seguem o contrato de franquia. Não existe desconto por pagar em dia.
      </p>

      {podeEditar && (
        <Button onClick={gravar} disabled={pendente}>
          {pendente ? "Gravando…" : "Gravar"}
        </Button>
      )}
    </div>
  );
}
