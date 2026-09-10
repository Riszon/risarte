"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCheck, Printer, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBRL } from "@/lib/pricing";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";
import {
  BILLING_STATUS_LABELS,
  BILLING_TYPE_LABELS,
  type BillingStatus,
  type BillingType,
} from "@/lib/empresarial/constants";
import { cn } from "@/lib/utils";
import {
  baixarCobrancasEmLote,
  gerarMensalidadesEmLote,
  type ResultadoEmLote,
} from "./actions";

export type LinhaDeCobranca = {
  id: string;
  companyId: string;
  empresa: string;
  tipo: BillingType;
  mesReferencia: string | null;
  totalCents: number;
  status: BillingStatus;
  vencimento: string | null;
  pagoEm: string | null;
  descricao: string | null;
};

const VARIANTE: Record<BillingStatus, "secondary" | "destructive" | "outline"> = {
  PENDING: "outline",
  PAID: "secondary",
  OVERDUE: "destructive",
  CANCELLED: "outline",
};

function dataBR(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso.slice(0, 10) + "T00:00:00").toLocaleDateString("pt-BR", {
    timeZone: BRAZIL_TIME_ZONE,
  });
}

function mesBR(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso.slice(0, 10) + "T00:00:00").toLocaleDateString("pt-BR", {
    timeZone: BRAZIL_TIME_ZONE,
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * ⚠️ O RESULTADO DO LOTE APARECE INTEIRO, inclusive o que NÃO foi feito.
 *
 * Um lote que responde "pronto" e engole os pulados é o jeito de alguém
 * descobrir semanas depois que a empresa X ficou sem cobrança. Aqui cada
 * empresa pulada volta com o motivo, e o aviso fica na tela até ser fechado —
 * um toast que some em cinco segundos não serve para uma lista que precisa ser
 * lida.
 */
function AvisoDoLote({
  resultado,
  onClose,
}: {
  resultado: ResultadoEmLote;
  onClose: () => void;
}) {
  const pulados = resultado.pulados ?? [];
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {resultado.feitas
              ? `${resultado.feitas} cobrança(s) processada(s)`
              : "Nada foi processado"}
          </DialogTitle>
        </DialogHeader>
        {pulados.length > 0 ? (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              {pulados.length} não {pulados.length === 1 ? "entrou" : "entraram"}, e
              o motivo de cada uma:
            </p>
            <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
              {pulados.map((p, i) => (
                <li key={`${p.empresa}-${i}`} className="flex justify-between gap-3">
                  <span className="font-medium">{p.empresa}</span>
                  <span className="text-muted-foreground">{p.motivo}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Tudo o que foi selecionado entrou.
          </p>
        )}
        <div className="flex justify-end">
          <Button size="sm" onClick={onClose}>
            Entendi
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TabelaDeCobrancas({
  linhas,
  empresas,
  hoje,
}: {
  linhas: LinhaDeCobranca[];
  empresas: { id: string; nome: string }[];
  /** Data civil brasileira, vinda do servidor — o navegador não decide o "hoje". */
  hoje: string;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [escolhidas, setEscolhidas] = useState<Set<string>>(new Set());
  const [resultado, setResultado] = useState<ResultadoEmLote | null>(null);
  const [gerar, setGerar] = useState(false);
  const [empresasParaGerar, setEmpresasParaGerar] = useState<Set<string>>(
    new Set()
  );

  // Só o que ainda pode receber baixa entra na seleção — marcar uma cobrança
  // paga e mandar baixar de novo reescreveria a data do pagamento.
  const selecionaveis = useMemo(
    () => linhas.filter((l) => l.status === "PENDING" || l.status === "OVERDUE"),
    [linhas]
  );

  const totalEscolhido = linhas
    .filter((l) => escolhidas.has(l.id))
    .reduce((s, l) => s + l.totalCents, 0);

  function alternar(id: string) {
    setEscolhidas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  function alternarTodas() {
    setEscolhidas((atual) =>
      atual.size === selecionaveis.length
        ? new Set()
        : new Set(selecionaveis.map((l) => l.id))
    );
  }

  function baixar() {
    startTransition(async () => {
      const r = await baixarCobrancasEmLote([...escolhidas]);
      if (!r.ok && r.error) {
        toast.error(r.error);
        return;
      }
      setEscolhidas(new Set());
      setResultado(r);
      router.refresh();
    });
  }

  function gerarMensalidades() {
    startTransition(async () => {
      const r = await gerarMensalidadesEmLote([...empresasParaGerar]);
      if (!r.ok && r.error) {
        toast.error(r.error);
        return;
      }
      setGerar(false);
      setEmpresasParaGerar(new Set());
      setResultado(r);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setGerar(true)}
          disabled={pendente || empresas.length === 0}
        >
          <Plus className="mr-1 size-4" />
          Gerar mensalidades
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => window.print()}
          disabled={linhas.length === 0}
        >
          <Printer className="mr-1 size-4" />
          Imprimir a lista
        </Button>

        {escolhidas.size > 0 && (
          <>
            <span className="ml-auto text-sm text-muted-foreground">
              {escolhidas.size} escolhida(s) · {formatBRL(totalEscolhido)}
            </span>
            <Button size="sm" onClick={baixar} disabled={pendente}>
              <CheckCheck className="mr-1 size-4" />
              Dar baixa
            </Button>
          </>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              {/* `data-moldura` sai na impressão: a coluna de escolher não faz
                  sentido no papel. */}
              <th data-moldura className="w-8 px-2 py-2">
                <input
                  type="checkbox"
                  aria-label="Escolher todas"
                  checked={
                    selecionaveis.length > 0 &&
                    escolhidas.size === selecionaveis.length
                  }
                  onChange={alternarTodas}
                  disabled={selecionaveis.length === 0}
                />
              </th>
              <th className="px-2 py-2 font-medium">Empresa</th>
              <th className="px-2 py-2 font-medium">Tipo</th>
              <th className="px-2 py-2 font-medium">Referência</th>
              <th className="px-2 py-2 font-medium">Vencimento</th>
              <th className="px-2 py-2 text-right font-medium">Valor</th>
              <th className="px-2 py-2 font-medium">Situação</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const podeBaixar = l.status === "PENDING" || l.status === "OVERDUE";
              const atrasada =
                podeBaixar && !!l.vencimento && l.vencimento < hoje;
              return (
                <tr key={l.id} className="border-b last:border-0">
                  <td data-moldura className="px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Escolher a cobrança de ${l.empresa}`}
                      checked={escolhidas.has(l.id)}
                      onChange={() => alternar(l.id)}
                      disabled={!podeBaixar}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Link
                      href={`/empresarial/${l.companyId}`}
                      className="hover:underline"
                    >
                      {l.empresa}
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {BILLING_TYPE_LABELS[l.tipo]}
                  </td>
                  <td className="px-2 py-2 tabular-nums">
                    {mesBR(l.mesReferencia)}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2 tabular-nums",
                      atrasada && "font-semibold text-destructive"
                    )}
                  >
                    {dataBR(l.vencimento)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatBRL(l.totalCents)}
                  </td>
                  <td className="px-2 py-2">
                    <Badge variant={VARIANTE[l.status]}>
                      {/* Atrasada mas ainda "Pendente" no banco: a situação
                          "Em atraso" só é gravada quando alguém roda a checagem
                          de inadimplência. Mostrar "Pendente" numa linha
                          vencida faria a tela discordar do próprio vencimento
                          que está ao lado. */}
                      {atrasada && l.status === "PENDING"
                        ? BILLING_STATUS_LABELS.OVERDUE
                        : BILLING_STATUS_LABELS[l.status]}
                    </Badge>
                  </td>
                </tr>
              );
            })}
            {linhas.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted-foreground">
                  Nenhuma cobrança com esses filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Os totais acima somam <strong>o que está nesta lista</strong>, com os
        filtros aplicados.
      </p>

      {gerar && (
        <Dialog open onOpenChange={() => setGerar(false)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Gerar mensalidades</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Escolha as empresas. O valor, o vencimento e o pagador saem do
              mesmo cálculo da tela de cada empresa. Quem{" "}
              <strong className="text-foreground">
                já tem cobrança do mês
              </strong>{" "}
              é pulada, e o aviso do fim diz quais.
            </p>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
              {empresas.map((e) => (
                <label
                  key={e.id}
                  className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    checked={empresasParaGerar.has(e.id)}
                    onChange={() =>
                      setEmpresasParaGerar((atual) => {
                        const proximo = new Set(atual);
                        if (proximo.has(e.id)) proximo.delete(e.id);
                        else proximo.add(e.id);
                        return proximo;
                      })
                    }
                  />
                  {e.nome}
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setEmpresasParaGerar(
                    empresasParaGerar.size === empresas.length
                      ? new Set()
                      : new Set(empresas.map((e) => e.id))
                  )
                }
              >
                {empresasParaGerar.size === empresas.length
                  ? "Limpar"
                  : "Escolher todas"}
              </Button>
              <Button
                size="sm"
                onClick={gerarMensalidades}
                disabled={pendente || empresasParaGerar.size === 0}
              >
                Gerar {empresasParaGerar.size > 0 && `(${empresasParaGerar.size})`}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {resultado && (
        <AvisoDoLote resultado={resultado} onClose={() => setResultado(null)} />
      )}
    </div>
  );
}
