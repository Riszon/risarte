import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatBrDate } from "@/lib/dates";
import {
  ROTULO_DA_LISTA,
  diasDeEspera,
  linkDaOrigem,
  quemSegura,
  type LinhaDoPainel,
  type ListaDoPainel,
} from "@/lib/signatures/indicadores";
import { PACKAGE_STATUS_CLASS, PACKAGE_STATUS_LABEL } from "@/lib/signatures/status";
import type { PackageStatus } from "@/lib/signatures/types";

/**
 * A LISTA QUE CADA NÚMERO DO PAINEL ABRE (ZS7, pedido do dono): os pacotes
 * daquele número, cada um com o link para o pacote e para a negociação de
 * origem (`linkDaOrigem`).
 */
export function ListaDoPainelView({
  lista,
  linhas,
  hoje,
  titulo,
  fechar,
}: {
  lista: ListaDoPainel;
  linhas: LinhaDoPainel[];
  hoje: string;
  titulo?: string;
  fechar: string;
}) {
  return (
    <section className="rounded-xl border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <p className="font-medium">
          {titulo ?? ROTULO_DA_LISTA[lista]} <span className="text-muted-foreground">({linhas.length})</span>
        </p>
        <Link href={fechar} className="text-sm text-primary underline-offset-4 hover:underline">
          Fechar a lista
        </Link>
      </div>
      {linhas.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum pacote nesta lista com os filtros de agora.</p>
      ) : (
        <ul className="divide-y">
          {linhas.map((l) => {
            const origem = linkDaOrigem(l);
            const docs = l.items.map((i) => i.title).join(" + ") || "—";
            return (
              <li key={l.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    <Link href={`/assinaturas/pacotes/${l.id}`} className="font-mono text-primary underline-offset-4 hover:underline">
                      {l.number}
                    </Link>{" "}
                    · {l.client_name ?? "—"}
                    {l.audience === "company" && <span className="ml-1 text-xs text-muted-foreground">(empresa)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{docs}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.clinic_name ?? "—"} · enviado em {formatBrDate(l.sent_at)}
                    {l.sent_by_name ? ` por ${l.sent_by_name}` : ""}
                  </p>
                  <Detalhe lista={lista} l={l} hoje={hoje} />
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge className={PACKAGE_STATUS_CLASS[l.status as PackageStatus]}>{PACKAGE_STATUS_LABEL[l.status as PackageStatus] ?? l.status}</Badge>
                  <div className="flex flex-wrap justify-end gap-x-3 text-xs">
                    <Link href={`/assinaturas/pacotes/${l.id}`} className="text-primary underline-offset-4 hover:underline">
                      Abrir o pacote
                    </Link>
                    {origem && (
                      <Link href={origem.href} className="text-primary underline-offset-4 hover:underline">
                        {origem.rotulo}
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Detalhe({ lista, l, hoje }: { lista: ListaDoPainel; l: LinhaDoPainel; hoje: string }) {
  const classe = "text-xs";
  switch (lista) {
    case "assinados":
      return <p className={`${classe} text-emerald-700 dark:text-emerald-300`}>Concluído em {l.completed_at ? formatBrDate(l.completed_at) : "—"}</p>;
    case "faltam": {
      const dias = diasDeEspera(l, hoje);
      return (
        <p className={`${classe} text-amber-800 dark:text-amber-200`}>
          Esperando {quemSegura(l)} há {dias} dia{dias === 1 ? "" : "s"}
          {l.expires_at ? ` · vale até ${formatBrDate(l.expires_at)}` : ""}
        </p>
      );
    }
    case "recusados":
      return <p className={`${classe} text-destructive`}>Recusado em {l.ended_at ? formatBrDate(l.ended_at) : "—"}{l.refused_reason ? ` · motivo: ${l.refused_reason}` : ""}</p>;
    case "vencidos":
      return <p className={classe}>Prazo acabou em {formatBrDate(l.expires_at ?? l.ended_at ?? l.sent_at)}</p>;
    case "cancelados":
      return (
        <p className={classe}>
          Cancelado em {l.ended_at ? formatBrDate(l.ended_at) : "—"}
          {l.cancelled_by_name ? ` por ${l.cancelled_by_name}` : ""}
          {l.cancel_reason ? ` · motivo: ${l.cancel_reason}` : ""}
        </p>
      );
    default:
      return null;
  }
}
