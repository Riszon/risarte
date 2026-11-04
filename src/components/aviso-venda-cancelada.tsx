import { CircleSlash } from "lucide-react";
import type { PlanEvent } from "@/lib/planning";
import { vendasCanceladas } from "@/lib/venda-cancelada";

/**
 * AP63: aviso fixo de venda cancelada, no plano (prontuário) e na negociação.
 * Lê só a linha do tempo do plano; sem venda cancelada, não desenha nada.
 */
export function AvisoVendaCancelada({ events }: { events: PlanEvent[] }) {
  const vendas = vendasCanceladas(events);
  if (vendas.length === 0) return null;
  const desteP = vendas.some((v) => v.tipo === "deste_plano");

  return (
    <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100">
      <p className="flex items-center gap-1.5 font-semibold">
        <CircleSlash className="size-4 shrink-0" />
        {desteP ? "A venda deste plano foi cancelada" : "Este cliente teve uma venda cancelada"}
      </p>
      <ul className="mt-1 space-y-0.5 text-xs">
        {vendas.map((v, i) => (
          <li key={i}>{v.texto}</li>
        ))}
      </ul>
      {desteP && (
        <p className="mt-1.5 text-xs opacity-90">
          Este plano fica guardado como registro do que foi vendido. Para vender
          de novo, o Planner cria uma <b>nova versão</b>, o Coordenador aprova e
          ela vai ao Comercial com uma negociação nova.
        </p>
      )}
    </div>
  );
}
