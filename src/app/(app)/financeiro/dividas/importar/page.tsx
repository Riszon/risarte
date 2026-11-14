import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, FileUp } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { podeImportarDividas, podeVerDividas } from "@/lib/finance/dividas-acesso";
import { formatInBrazil } from "@/lib/dates";
import { LINK_DA_PLANILHA_MODELO, ROTULO_DO_LOTE } from "@/lib/finance/dividas-importacao";
import { carregarLotes, carregarModelos } from "./dados";
import { EnviarPlanilha } from "./enviar-planilha";

/**
 * IMPORTAR PLANILHA (0407, fase 4): enviar o arquivo → conferência → gravar o
 * lote. Só o Financeiro da Franqueadora (e o Admin Master).
 */
export default async function ImportarPage() {
  const session = await getSessionContext();
  if (!podeVerDividas(session)) redirect("/financeiro");
  const pode = podeImportarDividas(session);
  const [lotes, modelos] = await Promise.all([carregarLotes(), carregarModelos()]);

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-8">
      <div>
        <Link href="/financeiro/dividas" className="text-sm text-muted-foreground underline">
          ← Levantamento de Dívidas
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <FileUp className="size-6 text-primary" />
          Importar planilha de dívidas
        </h1>
        <p className="text-sm text-muted-foreground">
          A planilha é conferida linha a linha antes de qualquer gravação: erros, avisos, duplicidade (no arquivo, nas
          dívidas já cadastradas e no Contas a Pagar), credores e categorias novos. Gravar é um lote só — e dá para
          desfazer enquanto nada foi pago.
        </p>
        <a href={LINK_DA_PLANILHA_MODELO} download className="mt-1 inline-flex items-center gap-1 text-sm underline">
          <Download className="size-4" />
          Baixar a planilha-modelo
        </a>
      </div>

      {lotes === null ? (
        <p className="rounded-lg border border-amber-500/50 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          A importação precisa de uma atualização do banco de dados (migração 0407) que ainda não foi aplicada aqui.
        </p>
      ) : (
        <>
          {pode ? (
            <EnviarPlanilha modelos={modelos} />
          ) : (
            <p className="text-sm text-muted-foreground">Você pode ver as importações, mas não importar.</p>
          )}

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Importações</h2>
            {lotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma importação ainda.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="p-2">Lote</th>
                      <th className="p-2">Arquivo</th>
                      <th className="p-2">Linhas</th>
                      <th className="p-2">Situação</th>
                      <th className="p-2">Quem</th>
                      <th className="p-2">Quando</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lotes.map((l) => (
                      <tr key={l.id} className="border-t">
                        <td className="p-2">
                          <Link href={`/financeiro/dividas/importar/${l.id}`} className="font-medium underline">
                            {l.code}
                          </Link>
                        </td>
                        <td className="p-2">{l.arquivo}</td>
                        <td className="p-2">{l.linhas}</td>
                        <td className="p-2">
                          {ROTULO_DO_LOTE[l.status]}
                          {l.resultado ? ` · ${l.resultado.debts} dívidas` : ""}
                        </td>
                        <td className="p-2">{l.criadoPor ?? "—"}</td>
                        <td className="p-2">{formatInBrazil(l.criadoEm, { dateStyle: "short", timeStyle: "short" })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
