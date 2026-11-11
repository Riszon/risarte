import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  ESTADO_DA_PRONTIDAO,
  ITENS_DE_PRONTIDAO,
  estadoDaProntidao,
  rotuloDoItem,
} from "@/lib/central/central";
import type { ProntidaoLida } from "@/lib/central/dados";
import { formatBrDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { BotaoDeAcao } from "./conta-client";

/**
 * A FAIXA DE PRONTIDÃO no topo da Central de uma unidade: "Pronta para cobrar"
 * ou a lista do que falta. O riSZon não emite cobrança de unidade que não
 * esteja pronta (`central_is_ready`, 4002).
 */
export function FaixaDeProntidao({
  clinicId,
  prontidao,
  admin,
}: {
  clinicId: string;
  prontidao: ProntidaoLida;
  admin: boolean;
}) {
  const estado = estadoDaProntidao(prontidao.itens, prontidao.marcada);
  const visual = ESTADO_DA_PRONTIDAO[estado];
  const faltam = prontidao.itens.filter((i) => !i.ok);

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-full px-2.5 py-0.5 text-sm font-medium", visual.tom)}>{visual.rotulo}</span>
        {estado === "falta_marcar" && admin && (
          <BotaoDeAcao acao="pronta" alvo={clinicId} valor rotulo="Marcar como pronta para cobrar" sucesso="Unidade marcada como pronta." variante="default" />
        )}
        {estado === "pronta" && admin && (
          <BotaoDeAcao acao="pronta" alvo={clinicId} valor={false} rotulo="Desmarcar" sucesso="Unidade desmarcada." variante="ghost" />
        )}
      </div>

      {estado === "nao_conferida" && (
        <p className="text-sm text-muted-foreground">
          O banco não devolveu a lista de prontidão desta unidade. Enquanto isso, ela é tratada como NÃO pronta.
        </p>
      )}

      {!prontidao.marcada && prontidao.desmarcadaEm && prontidao.motivoDaQueda && estado !== "pronta" && (
        <p className="flex items-start gap-1.5 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          A marcação de pronta caiu em {formatBrDateTime(prontidao.desmarcadaEm)}:{" "}
          {prontidao.motivoDaQueda
            .split(",")
            .map((i) => rotuloDoItem(i.trim()))
            .join("; ")}
          .
        </p>
      )}

      {prontidao.itens.length > 0 && (
        <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
          {prontidao.itens.map((i) => (
            <li key={i.item} className="flex items-start gap-1.5">
              {i.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              )}
              <span>
                {rotuloDoItem(i.item)}
                {!i.ok && ITENS_DE_PRONTIDAO[i.item] && (
                  <span className="block text-xs text-muted-foreground">{ITENS_DE_PRONTIDAO[i.item].comoResolver}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {faltam.length === 0 && estado === "falta_marcar" && !admin && (
        <p className="text-sm text-muted-foreground">Nada falta. O Admin Master marca a unidade como pronta.</p>
      )}
    </div>
  );
}
