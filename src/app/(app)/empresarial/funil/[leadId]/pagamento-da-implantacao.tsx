"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBrDate } from "@/lib/dates";
import { formatBRL } from "@/lib/pricing";
import {
  FORMAS_DA_IMPLANTACAO,
  FORMA_DA_IMPLANTACAO_ROTULO,
  type FormaDaImplantacao,
} from "@/lib/empresarial/alteracao-da-proposta";
import {
  clearImplantationPayment,
  postImplantationToCompany,
  registerImplantationPayment,
} from "./actions";

/** O que a página monta para o cartão. */
export type PagamentoDaImplantacaoView = {
  pagoEm: string | null;
  valorCents: number | null;
  forma: FormaDaImplantacao | null;
  registradoPor: string | null;
  /** O valor que a proposta sugere (1º pagamento). */
  sugeridoCents: number | null;
  companyId: string | null;
  /** A cobrança que nasceu deste registro, nas cobranças da empresa. */
  cobranca: { status: string; pagaEm: string | null } | null;
};

const SITUACAO_DA_COBRANCA: Record<string, string> = {
  PAID: "paga",
  PENDING: "pendente (estornada)",
  OVERDUE: "em atraso (estornada)",
  CANCELLED: "cancelada",
};

/**
 * O 1º PAGAMENTO NO FUNIL (1041, pedido do dono 09/11/2026).
 *
 * Era uma caixinha "Boleto da implantação pago", sem valor, que não chegava às
 * cobranças da empresa. Agora tem data, valor e forma, e vira a cobrança de
 * Implantação JÁ PAGA quando a empresa existe (ou quando for criada).
 */
export function PagamentoDaImplantacao({
  leadId,
  hoje,
  v,
}: {
  leadId: string;
  /** "YYYY-MM-DD" no Brasil. */
  hoje: string;
  v: PagamentoDaImplantacaoView;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const registrado = Boolean(v.pagoEm);
  const noFinanceiro = v.cobranca != null && v.cobranca.status !== "CANCELLED";
  const [editando, setEditando] = useState(!registrado);

  function rodar(acao: () => Promise<{ ok: boolean; error?: string }>, sucesso: string) {
    startTransition(async () => {
      const r = await acao();
      if (r.ok) {
        toast.success(sucesso);
        setEditando(false);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    rodar(
      () => registerImplantationPayment(leadId, fd),
      v.companyId
        ? "Pagamento registrado e lançado nas cobranças da empresa."
        : "Pagamento registrado. Ele vai para as cobranças quando a empresa for criada."
    );
  }

  const valorInicial =
    v.valorCents != null
      ? (v.valorCents / 100).toFixed(2).replace(".", ",")
      : v.sugeridoCents != null
        ? (v.sugeridoCents / 100).toFixed(2).replace(".", ",")
        : "";
  const dataInicial = v.pagoEm ? v.pagoEm.slice(0, 10) : hoje;

  return (
    <div
      className={`space-y-2 rounded-md border p-2.5 ${
        registrado ? "border-emerald-600/40 bg-emerald-600/5" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm">1º pagamento (implantação)</p>
          {registrado ? (
            <p className="text-xs text-muted-foreground">
              {v.valorCents != null ? formatBRL(v.valorCents) : "valor não informado"}
              {v.forma ? ` · ${FORMA_DA_IMPLANTACAO_ROTULO[v.forma]}` : ""} · em{" "}
              {formatBrDate(v.pagoEm!)}
              {v.registradoPor ? ` · por ${v.registradoPor}` : ""}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">ainda não</p>
          )}
        </div>
        {registrado && (
          <Badge className="bg-emerald-600 text-xs text-white">
            <Check className="mr-0.5 size-3" />
            Feito
          </Badge>
        )}
      </div>

      {/* Onde ele está no financeiro da empresa. */}
      {registrado && (
        <p className="text-xs">
          {noFinanceiro ? (
            <>
              Nas cobranças da empresa:{" "}
              <strong>{SITUACAO_DA_COBRANCA[v.cobranca!.status] ?? v.cobranca!.status}</strong>
              {v.companyId && (
                <>
                  {" · "}
                  <Link
                    href={`/empresarial/${v.companyId}?aba=financeiro`}
                    className="underline"
                  >
                    ver cobranças
                  </Link>
                </>
              )}
            </>
          ) : v.companyId ? (
            <span className="text-amber-700 dark:text-amber-400">
              Ainda não está nas cobranças da empresa.
            </span>
          ) : (
            <span className="text-muted-foreground">
              Vai para as cobranças da empresa quando ela for criada (aba Fechamento).
            </span>
          )}
        </p>
      )}

      {registrado && !noFinanceiro && v.companyId && v.valorCents != null && !editando && (
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={isPending}
          onClick={() =>
            rodar(() => postImplantationToCompany(leadId), "Lançado nas cobranças da empresa.")
          }
        >
          Lançar nas cobranças da empresa
        </Button>
      )}

      {/* Selo antigo (caixinha, sem valor): falta o valor para lançar. */}
      {registrado && v.valorCents == null && !editando && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Este pagamento foi marcado antes de o funil pedir o valor. Informe o
          valor para ele ir às cobranças da empresa.
        </p>
      )}

      {editando ? (
        <form onSubmit={onSubmit} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <div>
            <Label htmlFor="pag-data" className="text-xs">
              Data do pagamento
            </Label>
            <Input id="pag-data" name="data" type="date" max={hoje} defaultValue={dataInicial} required />
          </div>
          <div>
            <Label htmlFor="pag-valor" className="text-xs">
              Valor pago (R$)
            </Label>
            <Input
              id="pag-valor"
              name="valor"
              inputMode="decimal"
              defaultValue={valorInicial}
              placeholder="0,00"
              required
            />
          </div>
          <div>
            <Label htmlFor="pag-forma" className="text-xs">
              Forma
            </Label>
            <select
              id="pag-forma"
              name="forma"
              defaultValue={v.forma ?? "BOLETO"}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              {FORMAS_DA_IMPLANTACAO.map((f) => (
                <option key={f} value={f}>
                  {FORMA_DA_IMPLANTACAO_ROTULO[f]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-1">
            <Button type="submit" size="sm" className="h-9 text-xs" disabled={isPending}>
              Registrar
            </Button>
            {registrado && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 text-xs"
                onClick={() => setEditando(false)}
              >
                Cancelar
              </Button>
            )}
          </div>
          {v.sugeridoCents != null && (
            <p className="text-xs text-muted-foreground sm:col-span-4">
              Pela proposta, o 1º pagamento é {formatBRL(v.sugeridoCents)}.
            </p>
          )}
        </form>
      ) : (
        !noFinanceiro && (
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={isPending}
              onClick={() => setEditando(true)}
            >
              {v.valorCents == null ? "Informar o valor" : "Corrigir"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={isPending}
              onClick={() =>
                rodar(() => clearImplantationPayment(leadId), "Registro do pagamento desfeito.")
              }
            >
              Desfazer
            </Button>
          </div>
        )
      )}
      {noFinanceiro && (
        <p className="text-xs text-muted-foreground">
          Para desfazer, o Financeiro estorna a cobrança nas cobranças da empresa.
        </p>
      )}
    </div>
  );
}
