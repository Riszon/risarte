import Link from "next/link";
import { HandCoins } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatBRL } from "@/lib/pricing";
import { formatBrDateTime, formatIsoDateBr, formatIsoMonthBr } from "@/lib/dates";
import {
  MY_STATUS_LABEL,
  REPORT_STATUS_LABEL,
  myReportFromDb,
  type MyReportDb,
} from "@/lib/finance/payout-report";

type ParaAprovar = {
  id: string;
  code: string;
  clinic_name: string;
  provider_name: string | null;
  period_month: string;
  status: string;
  total_cents: number | string;
  item_count: number;
  contested_count: number;
  sent_at: string | null;
  missing_note: string | null;
};

/**
 * Repasse, Etapa 3 (0391) — a porta de quem NÃO é do Financeiro:
 *
 *  • MEUS REPASSES: o dentista vê os relatórios dele, um por unidade, depois
 *    que o aprovador enviou;
 *  • PARA EU APROVAR: o Gerente (ou o Coordenador, na unidade sem Gerente)
 *    confere os relatórios da equipe dele, um por vez.
 *
 * Fica fora do Financeiro de propósito: dentista e coordenador não entram lá.
 * Não há lista de funções aqui — as duas funções do banco respondem pela
 * pessoa logada, em todas as unidades dela, e devolvem vazio para quem não
 * tem nada.
 */
export default async function RepassesPage() {
  await getSessionContext();
  const supabase = await createClient();

  const [aprovar, meus] = await Promise.all([
    supabase.rpc("payout_reports_to_approve"),
    supabase.rpc("my_payout_reports"),
  ]);
  if (aprovar.error) console.error("payout_reports_to_approve failed:", aprovar.error.message);
  if (meus.error) console.error("my_payout_reports failed:", meus.error.message);

  const fila = (aprovar.data ?? []) as ParaAprovar[];
  const comigo = fila.filter((r) => ["com_gerente", "em_contestacao"].includes(r.status));
  const andando = fila.filter((r) => !["com_gerente", "em_contestacao"].includes(r.status));
  const relatorios = ((meus.data ?? []) as MyReportDb[]).map(myReportFromDb);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <HandCoins className="size-6 text-primary" />
          Repasses
        </h1>
        <p className="text-sm text-muted-foreground">
          O repasse só é pago depois de conferido por quem responde pela equipe{" "}
          <strong>e</strong> aprovado pelo dentista.
        </p>
      </div>

      {(aprovar.error || meus.error) && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          Não foi possível carregar os repasses. Tente de novo; se continuar,
          avise o suporte.
        </p>
      )}

      {fila.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">
            Para eu aprovar{" "}
            <span className="text-xs font-normal text-muted-foreground">
              ({comigo.length} esperando você)
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">
            Abra um relatório por vez. Não existe aprovação em lote.
          </p>
          <ul className="divide-y divide-dashed rounded-lg border text-sm">
            {[...comigo, ...andando].map((r) => {
              const minhaVez = ["com_gerente", "em_contestacao"].includes(r.status);
              return (
                <li key={r.id}>
                  <Link
                    href={`/repasses/${r.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 p-2 hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p>
                        <span className="font-mono text-xs">{r.code}</span>
                        <span className="ml-2 font-medium">{r.provider_name ?? "—"}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {r.clinic_name} · {formatIsoMonthBr(r.period_month)}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.item_count} procedimento{r.item_count === 1 ? "" : "s"}
                        {r.contested_count > 0 &&
                          ` · ${r.contested_count} contestado${r.contested_count === 1 ? "" : "s"}`}
                        {r.missing_note ? " · o dentista avisou que falta procedimento" : ""}
                        {r.sent_at ? ` · recebido em ${formatBrDateTime(r.sent_at)}` : ""}
                      </p>
                    </div>
                    <span className="flex items-center gap-2">
                      <strong className="tabular-nums">{formatBRL(Number(r.total_cents))}</strong>
                      <span
                        className={
                          minhaVez
                            ? "rounded-md bg-primary px-2 py-0.5 text-[11px] text-primary-foreground"
                            : "rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground"
                        }
                      >
                        {minhaVez
                          ? r.status === "com_gerente"
                            ? "Conferir"
                            : "Responder contestação"
                          : (REPORT_STATUS_LABEL[r.status] ?? r.status)}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-medium">
          Meus repasses{" "}
          <span className="text-xs font-normal text-muted-foreground">
            ({relatorios.length})
          </span>
        </h2>
        {relatorios.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">
            Nenhum relatório de repasse para você no momento. Ele aparece aqui
            quando o responsável pela equipe conferir e enviar.
          </p>
        ) : (
          <ul className="divide-y divide-dashed rounded-lg border text-sm">
            {relatorios.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/repasses/${r.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 p-2 hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <p>
                      <span className="font-mono text-xs">{r.code}</span>
                      <span className="ml-2 font-medium">{r.clinicName}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {formatIsoMonthBr(r.periodMonth)} · nível{" "}
                        {r.levelName ?? "não definido"}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.itemCount} procedimento{r.itemCount === 1 ? "" : "s"}
                      {r.status === "com_dentista" && r.dentistDueOn
                        ? ` · responda até ${formatIsoDateBr(r.dentistDueOn)}`
                        : ""}
                      {r.releasedCents > 0 && r.status !== "aprovado"
                        ? ` · ${formatBRL(r.releasedCents)} já aprovado`
                        : ""}
                    </p>
                  </div>
                  <span className="flex items-center gap-2">
                    <strong className="tabular-nums">{formatBRL(r.totalCents)}</strong>
                    <span
                      className={
                        r.status === "com_dentista"
                          ? "rounded-md bg-primary px-2 py-0.5 text-[11px] text-primary-foreground"
                          : "rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground"
                      }
                    >
                      {MY_STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
